/**
 * Drives Gmail's own page, hidden under the app, for what its sync endpoints can't do: delete forever, emptying Trash or Spam, and scheduled send. Neither InboxSDK nor gmail.js records a sync request for these, so this works as a person would: open the folder, tick the rows, press Gmail's button, confirm, wait.
 * Selectors are Gmail's long-standing ones (rows are `tr.zA` with `[data-thread-id]`); button names are English, so other languages fail cleanly. The caller re-reads through the sync API; nothing here is proof.
 */

import { composeUrlId } from './ids';

export type Folder = 'trash' | 'spam';

const DELETE_FOREVER = ['Delete forever'];
const EMPTY_LINK: Record<Folder, RegExp> = {
  trash: /^empty trash now$/i,
  spam: /^delete all spam messages now$/i,
};
const STEP_TIMEOUT_MS = 10_000;
/** The app shows "Scheduling..." meanwhile. */
const SCHEDULE_BUDGET_MS = 45_000;
/** Then Schedule send is pressed where it sits, as InboxSDK does. */
const MENU_WAIT_MS = 3_000;
const CONFIRM_WAIT_MS = 5_000;
/** For Gmail's page to fetch changes after Refresh, and to fill recipient chips. */
const DRAFT_SYNC_MS = 1_500;
const RECIPIENTS_WAIT_MS = 3_000;
const DRAFT_SYNC_TRIES = 3;
const REFRESH = /^refresh$/i;
const FIELD_CHECK_MS = 300;
/** How long Gmail gets to reopen a cancelled send as a draft, so its window can be closed. */
const DRAFT_REOPEN_MS = 3_000;
const MAX_PAGES = 50;

/** From InboxSDK (`[selector="scheduledSend"]`) and gmail.js (`.J-N.yr`), then English. */
const SCHEDULE_ITEM = '[selector="scheduledSend"], .J-N.yr';
const SCHEDULE_SEND = /^schedule send$/i;
const PICK_DATE = /^pick date (&|and) time$/i;
const CANCEL_SEND = /^cancel send$/i;
const DISCARD_DRAFT = /^discard draft/i;
const CLICKABLE = '[role="menuitem"], [role="option"], [role="button"], [role="link"], button, [tabindex]';
const DIALOGS = '[role="dialog"], [role="alertdialog"]';
const OK_BUTTON = 'button[name="ok"], [role="button"][name="ok"], [data-mdc-dialog-action="ok"], [data-mdc-dialog-action="accept"]';

export interface ScheduleRequest {
  threadId: string;
  messageId: string;
  /** Epoch ms, whole minutes. */
  sendAt: number;
  /** So a stale copy of the draft in Gmail's page is caught before it's scheduled. */
  recipients?: string[];
}

export class GmailPageError extends Error {
  /** Words that finish "before it could ..." ("open Schedule send"). */
  readonly step?: string;
  /** What Gmail itself said in a dialog. */
  readonly said?: string;
  constructor(message: string, step?: string, said?: string) {
    super(message);
    this.name = 'GmailPageError';
    if (step) this.step = step;
    if (said) this.said = said;
  }
}

/** What another driver gets while it holds the page (see exclusive). */
export interface PageControl {
  navigate(hash: string): void;
  claim(): void;
}

export interface GmailPageOptions {
  window?: Window;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  stepTimeoutMs?: number;
  /** Overridable for tests (jsdom has no layout). */
  shown?: (el: Element) => boolean;
  /** Lets Gmail's page lay itself out while an action steers it (it rests unrendered under the app). Returns the way back to rest. */
  wake?: () => () => void;
}

/** What the sync API says is in the folder, so the page can tell when Gmail shows it. */
export interface FolderView {
  /** Thread ids on the folder's first page, as the sync API listed them. */
  landmarks: string[];
  /** Bounds the page walk. */
  total?: number;
}

export class GmailPage {
  private readonly win: Window;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly stepTimeoutMs: number;
  private readonly shown: (el: Element) => boolean;
  private readonly wake?: () => () => void;
  /** One action at a time: they all steer the same page. */
  private queue: Promise<unknown> = Promise.resolve();
  /** The address the running action last sent Gmail to. */
  private navigatedTo: string | undefined;
  private budgetEnd = Infinity;

  constructor(options: GmailPageOptions = {}) {
    this.win = options.window ?? window;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? (() => Date.now());
    this.stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    this.shown = options.shown ?? laidOut;
    this.wake = options.wake;
  }

  /** Walks Gmail's list pages until each is found. Resolves with the ids it never saw. */
  deleteForever(threadIds: string[], folder: Folder, view: FolderView = { landmarks: [] }): Promise<string[]> {
    return this.serial(async () => {
      const remaining = new Set(threadIds);
      await this.open(folder, 1, (ids) => ids.some((id) => remaining.has(id) || view.landmarks.includes(id)));
      let page = 1;
      let perPage = 0;
      while (remaining.size) {
        const shown = this.shownIds();
        perPage = Math.max(perPage, shown.length);
        const here = shown.filter((id) => remaining.has(id));
        if (here.length) {
          await this.deleteRows(here);
          here.forEach((id) => remaining.delete(id));
          continue;
        }
        if (!shown.length || page >= MAX_PAGES || (view.total !== undefined && page * perPage >= view.total)) break;
        const before = new Set(shown);
        page += 1;
        const turned = await this.open(folder, page, (ids) => ids.some((id) => !before.has(id))).then(
          () => true,
          () => false,
        );
        if (!turned) break;
      }
      return [...remaining];
    });
  }

  emptyFolder(folder: Folder, view: FolderView): Promise<void> {
    return this.serial(async () => {
      // The sync API saw nothing there: nothing to press.
      if (!view.landmarks.length) return;
      await this.open(folder, 1, (ids) => ids.some((id) => view.landmarks.includes(id)));
      const name = folder === 'trash' ? 'Empty Trash now' : 'Delete all spam messages now';
      this.press(await this.until(() => this.textControl(EMPTY_LINK[folder]), `find ${name}`));
      if (!(await this.confirm())) throw new GmailPageError(`Gmail didn't ask to confirm ${name}.`);
      await this.until(() => !this.shownIds().some((id) => view.landmarks.includes(id)), 'empty the folder');
    });
  }

  /** The way InboxSDK drives it: open the draft (`#drafts?compose=`), More send options, Schedule send, then the preset with exactly this time or Pick date & time, and Schedule send. Never presses Send. The caller re-reads through the sync API. */
  scheduleDraft(request: ScheduleRequest): Promise<void> {
    return this.serial(async () => {
      const opened = new Set(this.composes());
      let done = false;
      let pressed: HTMLElement | undefined;
      let toast: string | undefined;
      this.budgetEnd = this.now() + Math.max(SCHEDULE_BUDGET_MS, this.stepTimeoutMs);
      try {
        const compose = await this.openCurrentDraft(request);
        // Gmail can have other dialogs up (or left over behind the app); the one that opens now is Schedule send's.
        const shownBefore = new Set(this.shownDialogs());
        this.press(await this.openScheduleMenu(compose));
        const dialog = await this.until(
          () =>
            this.refused(shownBefore) ??
            this.dialog((d) => !d.contains(compose) && !shownBefore.has(d) && !!this.choices(d).length) ??
            this.dialog((d) => !d.contains(compose) && !!this.choices(d).some((el) => PICK_DATE.test(text(el)))),
          'open Schedule send',
        );
        toast = this.toastText();
        const preset = this.preset(dialog, request.sendAt);
        if (preset) pressed = preset;
        else {
          const menuBefore = new Set(this.shownDialogs());
          this.press(await this.until(() => this.refused(shownBefore) ?? this.pickDateItem(dialog), 'find Pick date & time'));
          const isPicker = (d: HTMLElement) => !d.contains(compose) && this.textInputs(d).length >= 2;
          const picker = await this.until(() => this.dialog((d) => isPicker(d) && !menuBefore.has(d)) ?? this.dialog(isPicker), 'open Pick date & time');
          const [date, time] = this.dateTimeInputs(picker);
          const lang = this.doc.documentElement.lang || undefined;
          const day = new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric' }).format(request.sendAt);
          const clock = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(request.sendAt);
          const clock24 = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(request.sendAt);
          await this.fillAccepted(picker, date!, [spaced(day), day]);
          await this.fillAccepted(picker, time!, [spaced(clock), clock, spaced(clock).toLowerCase(), spaced(clock).replace(' ', ''), clock24]);
          pressed = await this.until(() => enabledEl(this.confirmButton(picker)), 'accept the date and time');
        }
        // Dialogs that show from here on are Gmail's answer to this press.
        const before = new Set(this.shownDialogs());
        this.press(pressed);
        await this.settleSchedule(request.messageId, pressed, toast, before);
        done = true;
      } catch (err) {
        if (err instanceof GmailPageError && err.step) throw new GmailPageError(`${err.message} ${this.scheduleSnapshot(request.messageId, pressed, toast)}`, err.step);
        throw err;
      } finally {
        this.budgetEnd = Infinity;
        // Gmail saves a compose window as it closes.
        if (!done) this.tidy(opened);
      }
    });
  }

  /** Done when Gmail closes the draft or shows "Send scheduled for ...". Answers Gmail's own questions ("Send without a subject?") with OK, stops with its words on a problem ("Please specify at least one recipient"), and presses once more if a press was ignored. */
  private async settleSchedule(messageId: string, pressed: HTMLElement, toast: string, before: Set<HTMLElement>) {
    const repressAt = this.now() + this.stepTimeoutMs / 2;
    let answered = false;
    let repressed = false;
    await this.until(() => {
      if (!this.compose(messageId) || this.toastText() !== toast) return true;
      this.refused(before);
      const asked = this.dialog((d) => !before.has(d) && !!this.dialogOk(d));
      if (asked) {
        if (!answered) this.press(this.dialogOk(asked)!);
        answered = true;
        return false;
      }
      if (!repressed && !answered && this.now() >= repressAt && pressed.isConnected && this.shown(pressed)) {
        this.press(pressed);
        repressed = true;
      }
      return false;
    }, 'schedule the message');
  }

  /** The button pressed, the draft, the notice and any dialogs with their fields and choices. Gmail's own words only, never the message. */
  private scheduleSnapshot(messageId: string, pressed?: HTMLElement, toast?: string): string {
    const clip = (t: string, n = 80) => JSON.stringify(spaced(t).slice(0, n));
    const dialogs = this.shownDialogs()
      .filter((d) => !d.querySelector('input[name="draft"]'))
      .map((d) => {
        const fields = this.textInputs(d).map((i) => {
          const error = i.getAttribute('aria-invalid') === 'true' ? ` invalid ${clip(this.fieldError(d, i), 60)}` : '';
          return `${i.getAttribute('aria-label') ?? 'field'}=${clip(i.value)}${error}`;
        });
        const choices = innermost(this.choices(d)).slice(0, 8).map((el) => `${el.getAttribute('role') ?? el.tagName.toLowerCase()} ${clip(text(el), 40)}`);
        return `${d.getAttribute('role')} ${clip(d.getAttribute('aria-label') || text(d))}${fields.length ? ` (${fields.join(', ')})` : ''}${choices.length ? ` [${choices.join(', ')}]` : ''}`;
      });
    const lines: string[] = [];
    if (pressed) {
      const state = !pressed.isConnected ? 'gone' : !this.shown(pressed) ? 'hidden' : enabledEl(pressed) ? 'shown' : 'disabled';
      lines.push(`pressed ${pressed.tagName.toLowerCase()} ${clip(text(pressed) || pressed.getAttribute('aria-label') || '')}, now ${state}`);
    }
    lines.push(`draft ${this.compose(messageId) ? 'still open' : 'closed'}`);
    lines.push(`notice ${clip(this.toastText())}${toast !== undefined && this.toastText() === toast ? ' (unchanged)' : ''}`);
    lines.push(`dialogs: ${dialogs.join('; ') || 'none'}`);
    return lines.join('; ');
  }

  /** A new dialog with nothing to choose but OK. Closes it and throws its words; returns null otherwise, so it fits an until(). */
  private refused(before: Set<HTMLElement>): null {
    const asked = this.dialog((d) => !before.has(d) && !!this.dialogOk(d));
    if (!asked) return null;
    const buttons = [...asked.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((el) => this.shown(el) && text(el));
    if (buttons.length >= 2) return null;
    const said = words(asked, buttons).replace(/^error\s+/i, '');
    this.press(this.dialogOk(asked)!);
    throw new GmailPageError(`Gmail said: ${said}`, undefined, said);
  }

  private shownDialogs(): HTMLElement[] {
    return [...this.doc.querySelectorAll<HTMLElement>(DIALOGS)].filter((d) => this.shown(d));
  }

  private dialogOk(dialog: HTMLElement): HTMLElement | null {
    return [...dialog.querySelectorAll<HTMLElement>(`${OK_BUTTON}, button, [role="button"]`)].find((el) => this.shown(el) && (el.matches(OK_BUTTON) || /^ok$/i.test(text(el)))) ?? null;
  }

  /** Gmail's page can hold the copy of a draft it saw first (before the recipients were added) until it syncs. So Drafts is refreshed first, and a window still missing a recipient is closed, refreshed and reopened. */
  private async openCurrentDraft(request: ScheduleRequest): Promise<HTMLElement> {
    const want = [...new Set((request.recipients ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean))];
    const url = `#drafts?compose=${composeUrlId(request.threadId, request.messageId)}`;
    for (let attempt = 1; ; attempt++) {
      await this.syncDrafts(request.threadId);
      const compose = await this.go(url, () => this.compose(request.messageId), 'open the draft');
      if (!want.length) return compose;
      // Gmail fills in the recipient chips a beat after the window opens.
      const missing = () => want.filter((a) => !this.composeRecipients(compose).has(a));
      if (await this.wait(() => !missing().length, Math.min(RECIPIENTS_WAIT_MS, this.stepTimeoutMs))) return compose;
      if (attempt >= DRAFT_SYNC_TRIES) {
        // No chips at all may mean Gmail draws them differently: let Gmail judge (it says if it has nobody).
        if (!this.composeRecipients(compose).size) return compose;
        const said = "Gmail's page hasn't caught up with this draft's recipients yet. Wait a moment and send again";
        throw new GmailPageError(`${said} (missing ${missing().join(', ')}).`, undefined, said);
      }
      const close = this.closeButton(compose);
      if (close) this.press(close);
      await this.wait(() => !this.compose(request.messageId), Math.min(RECIPIENTS_WAIT_MS, this.stepTimeoutMs));
    }
  }

  /** Gmail's Refresh in Drafts, so its page fetches what changed. Waits for Drafts first (a draft Gmail hasn't seen won't be listed), then for the draft's row. */
  private async syncDrafts(threadId: string) {
    const listed = () => this.shownIds().includes(threadId);
    const ms = Math.min(DRAFT_SYNC_MS, this.stepTimeoutMs / 2);
    if (!(await this.go('#drafts', () => this.named(REFRESH), 'open Drafts').catch(() => null))) return;
    await this.wait(listed, ms);
    const refresh = this.named(REFRESH);
    if (refresh) this.press(refresh);
    await this.sleep(ms / 3);
    await this.wait(listed, ms);
  }

  /** Chips (`email` / `data-hovercard-id`), or the plain fields. */
  private composeRecipients(compose: HTMLElement): Set<string> {
    const out = new Set<string>();
    for (const el of compose.querySelectorAll('[email], [data-hovercard-id]')) {
      const a = (el.getAttribute('email') ?? el.getAttribute('data-hovercard-id') ?? '').trim().toLowerCase();
      if (a.includes('@')) out.add(a);
    }
    // Only real fields: Gmail also names other elements "to".
    for (const field of compose.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(':is(input, textarea):is([name="to"], [name="cc"], [name="bcc"])')) {
      for (const a of (field.value ?? '').match(/[^\s,;<>"]+@[^\s,;<>"]+/g) ?? []) out.add(a.toLowerCase());
    }
    return out;
  }

  /** Opens the arrow beside Send first, like a person; when that menu doesn't show (Gmail renders it lazily), presses Schedule send where it sits, as InboxSDK's openScheduleSendMenu does. */
  private async openScheduleMenu(compose: HTMLElement): Promise<HTMLElement> {
    const more = this.moreSendOptions(compose);
    if (more) this.press(more);
    const shown = await this.wait(() => !!this.scheduleItem(compose), Math.min(MENU_WAIT_MS, this.stepTimeoutMs / 2));
    const item = shown ? this.scheduleItem(compose) : this.composeScheduleItem(compose);
    if (item) return item;
    // A menu Gmail only builds once it opens: give it the rest of the step.
    return this.until(() => this.scheduleItem(compose), more ? 'find Schedule send in the send options' : 'find More send options');
  }

  /** Open the draft and press the bin in its compose window, as a person would. */
  discardDraft(request: { threadId: string; messageId: string }): Promise<void> {
    return this.serial(async () => {
      const opened = new Set(this.composes());
      let done = false;
      try {
        const compose = await this.go(`#drafts?compose=${composeUrlId(request.threadId, request.messageId)}`, () => this.compose(request.messageId), 'open the draft');
        this.press(await this.until(() => this.discardButton(compose), 'find Discard draft'));
        await this.until(() => !this.compose(request.messageId), 'discard the draft');
        done = true;
      } finally {
        if (!done) this.tidy(opened);
      }
    });
  }

  /** By English name or tooltip, or InboxSDK's `.og` when unnamed. */
  private discardButton(compose: HTMLElement): HTMLElement | null {
    const buttons = [...compose.querySelectorAll<HTMLElement>('[role="button"], button')].filter((el) => this.shown(el));
    return (
      buttons.find((el) => DISCARD_DRAFT.test((el.getAttribute('aria-label') ?? el.getAttribute('data-tooltip') ?? '').trim())) ??
      buttons.find((el) => el.matches('.og')) ??
      null
    );
  }

  /** Open it from Scheduled and press Cancel send; the message goes back to Drafts. */
  cancelSend(threadId: string, view: FolderView = { landmarks: [] }): Promise<void> {
    return this.serial(async () => {
      const opened = new Set(this.composes());
      if (!(await this.findRow('scheduled', threadId, view))) throw new GmailPageError("Couldn't find the message in Gmail's Scheduled folder.");
      this.press(this.row(threadId)!);
      const button = await this.until(() => this.named(CANCEL_SEND), 'find Cancel send');
      const toast = this.toastText();
      this.press(button);
      await this.until(() => !button.isConnected || !this.shown(button) || this.toastText() !== toast, 'cancel the send');
      // Gmail opens the returned draft; close it so it can't save over edits made in the app.
      await this.wait(() => this.composes().some((c) => !opened.has(c)), DRAFT_REOPEN_MS);
      this.tidy(opened);
    });
  }

  private async deleteRows(ids: string[]) {
    const rows = ids.map((id) => this.row(id)).filter((r): r is HTMLElement => !!r);
    const ticked: HTMLElement[] = [];
    try {
      for (const row of rows) {
        const box = row.querySelector<HTMLElement>('[role="checkbox"]');
        if (!box) throw new GmailPageError("Couldn't select a conversation in Gmail.");
        if (box.getAttribute('aria-checked') !== 'true') {
          this.press(box);
          ticked.push(box);
        }
      }
      await this.until(() => rows.every((r) => r.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true'), 'select the conversations');
      // Nothing else may be selected: a row left ticked by an earlier try would be deleted forever too.
      const extra = [...this.doc.querySelectorAll<HTMLElement>('tr.zA')].filter(
        (r) => this.shown(r) && !rows.includes(r) && r.querySelector('[role="checkbox"]')?.getAttribute('aria-checked') === 'true',
      );
      if (extra.length) {
        extra.forEach((r) => this.press(r.querySelector<HTMLElement>('[role="checkbox"]')!));
        throw new GmailPageError('Gmail had other conversations selected, so nothing was deleted.');
      }
      this.press(await this.until(() => this.button(DELETE_FOREVER), 'find Delete forever'));
    } catch (err) {
      ticked.filter((box) => box.isConnected && box.getAttribute('aria-checked') === 'true').forEach((box) => this.press(box));
      throw err;
    }
    // Gmail asks to confirm some permanent deletes and not others.
    let asked = false;
    await this.until(() => {
      const ok = asked ? null : this.okButton();
      if (ok) {
        this.press(ok);
        asked = true;
      }
      return ids.every((id) => !this.row(id));
    }, 'delete the conversations');
  }

  /** Runs another driver's action (Gemini's) in this page's queue, awake. `navigate` sends Gmail to a hash; `claim` marks wherever Gmail went on its own as this action's. Either way the address is put back afterwards. */
  exclusive<T>(run: (control: PageControl) => Promise<T>): Promise<T> {
    return this.serial(() =>
      run({
        navigate: (hash) => this.navigate(hash),
        claim: () => {
          this.navigatedTo = this.win.location.href;
        },
      }),
    );
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const awake = async () => {
      const rest = this.wake?.();
      const href = this.win.location.href;
      this.navigatedTo = undefined;
      try {
        return await run();
      } finally {
        rest?.();
        // So a reload doesn't reopen a draft or folder, but only while it's still this action's address: the app keeps writing its own route here, and that wins.
        if (this.navigatedTo && this.win.location.href === this.navigatedTo) this.win.history.replaceState(this.win.history.state, '', href);
        this.navigatedTo = undefined;
      }
    };
    const next = this.queue.then(awake, awake);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private get doc(): Document {
    return this.win.document;
  }

  /** Waits until the list shows rows that belong there. The hash proves nothing: the app mirrors its route into this URL with replaceState, which Gmail never sees. */
  private async open(folder: Folder | 'scheduled', page: number, ready: (ids: string[]) => boolean) {
    await this.go(page > 1 ? `#${folder}/p${page}` : `#${folder}`, () => {
      const ids = this.shownIds();
      return ids.length > 0 && ready(ids);
    }, `open ${folder === 'trash' ? 'Trash' : folder === 'spam' ? 'Spam' : 'Scheduled'}`);
  }

  private go<T>(hash: string, ready: () => T | null | undefined | false, step: string): Promise<T> {
    this.navigate(hash);
    return this.until(ready, step);
  }

  /** A real navigation Gmail sees, even when the app already mirrored this hash into the URL. */
  private navigate(hash: string) {
    if (this.win.location.hash === hash) this.win.history.replaceState(this.win.history.state, '', '#');
    const url = new URL(this.win.location.href);
    url.hash = hash;
    this.win.location.replace(url.toString());
    this.navigatedTo = this.win.location.href;
  }

  /** Opens the folder's list page that shows this thread. */
  private async findRow(folder: Folder | 'scheduled', threadId: string, view: FolderView): Promise<boolean> {
    await this.open(folder, 1, (ids) => ids.includes(threadId) || view.landmarks.some((id) => ids.includes(id)));
    let perPage = 0;
    for (let page = 1; ; page++) {
      const shown = this.shownIds();
      if (shown.includes(threadId)) return true;
      perPage = Math.max(perPage, shown.length);
      if (!shown.length || page >= MAX_PAGES || (view.total !== undefined && page * perPage >= view.total)) return false;
      const before = new Set(shown);
      const turned = await this.open(folder, page + 1, (ids) => ids.some((id) => !before.has(id))).then(
        () => true,
        () => false,
      );
      if (!turned) return false;
    }
  }

  /** By the hidden draft field InboxSDK reads (`input[name="draft"]`, "#msg-a:r..."). */
  private composes(): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const input of this.doc.querySelectorAll<HTMLInputElement>('input[name="draft"]')) {
      const root = this.composeRoot(input);
      if (root && this.shown(root) && !out.includes(root)) out.push(root);
    }
    return out;
  }

  private compose(messageId: string): HTMLElement | null {
    const want = draftKey(messageId);
    for (const input of this.doc.querySelectorAll<HTMLInputElement>('input[name="draft"]')) {
      if (draftKey(input.value) !== want) continue;
      const root = this.composeRoot(input);
      if (root && this.shown(root)) return root;
    }
    return null;
  }

  /** The smallest ancestor holding both the draft field and the send buttons. */
  private composeRoot(input: Element): HTMLElement | null {
    for (let el = input.parentElement; el && el !== this.doc.body; el = el.parentElement) {
      if (this.moreSendOptions(el, true)) return el;
    }
    return null;
  }

  /** InboxSDK: `.hG`, or the send group's `aria-haspopup` button. Never Send itself. */
  private moreSendOptions(root: Element, any = false): HTMLElement | null {
    const found = [
      ...root.querySelectorAll<HTMLElement>('.hG[role="button"], .IZ [role="button"][aria-haspopup="true"]'),
      ...[...root.querySelectorAll<HTMLElement>('[role="button"][aria-haspopup="true"]')].filter((el) => /^more send options$/i.test(el.getAttribute('aria-label')?.trim() ?? '')),
    ];
    return found.find((el) => any || this.shown(el)) ?? null;
  }

  private scheduleItem(compose: HTMLElement): HTMLElement | null {
    const shown = (list: Iterable<HTMLElement>) => [...list].find((el) => this.shown(el)) ?? null;
    return (
      shown(compose.querySelectorAll<HTMLElement>(SCHEDULE_ITEM)) ??
      shown(this.doc.querySelectorAll<HTMLElement>(SCHEDULE_ITEM)) ??
      shown([...this.doc.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((el) => SCHEDULE_SEND.test(text(el))))
    );
  }

  /** Within its own window, never another draft's. */
  private composeScheduleItem(compose: HTMLElement): HTMLElement | null {
    for (let el: HTMLElement | null = compose, up = 0; el && el !== this.doc.body && up < 6; el = el.parentElement, up++) {
      if (el.querySelectorAll('input[name="draft"]').length > 1) break;
      const item = el.querySelector<HTMLElement>(SCHEDULE_ITEM);
      if (item) return item;
    }
    return null;
  }

  /** A shown dialog other than a compose window. */
  private dialog(match: (d: HTMLElement) => boolean): HTMLElement | null {
    for (const d of this.doc.querySelectorAll<HTMLElement>(DIALOGS)) {
      if (this.shown(d) && !d.querySelector('input[name="draft"]') && match(d)) return d;
    }
    return null;
  }

  private choices(dialog: HTMLElement, selector = CLICKABLE): HTMLElement[] {
    return [...dialog.querySelectorAll<HTMLElement>(selector)].filter((el) => text(el) && this.shown(el));
  }

  /** Gmail's preset ("Tomorrow morning  Oct 14, 8:00 AM") when it names exactly this day and minute. */
  private preset(dialog: HTMLElement, at: number): HTMLElement | null {
    const lang = this.doc.documentElement.lang || undefined;
    const day = spaced(new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(at));
    const time = spaced(new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(at));
    const hits = innermost(
      this.choices(dialog).filter((el) => {
        const t = spaced(text(el));
        return hasToken(t, day) && hasToken(t, time);
      }),
    );
    return hits.length === 1 ? hits[0]! : null;
  }

  /** Pick date & time is the one entry with no digits. */
  private pickDateItem(dialog: HTMLElement): HTMLElement | null {
    const plain = innermost(this.choices(dialog, '[role="menuitem"], [role="option"]').filter((el) => !/\d/.test(text(el))));
    if (plain.length === 1) return plain[0]!;
    return innermost(this.choices(dialog).filter((el) => PICK_DATE.test(text(el))))[0] ?? null;
  }

  private textInputs(dialog: HTMLElement): HTMLInputElement[] {
    return [...dialog.querySelectorAll<HTMLInputElement>('input')].filter((i) => (i.type === 'text' || !i.getAttribute('type')) && this.shown(i));
  }

  /** By English label when there is one, else in Gmail's order. */
  private dateTimeInputs(dialog: HTMLElement): HTMLInputElement[] {
    const inputs = this.textInputs(dialog);
    const by = (re: RegExp) => inputs.find((i) => re.test(i.getAttribute('aria-label') ?? ''));
    const date = by(/^date$/i);
    const time = by(/^time$/i);
    return date && time ? [date, time] : inputs.slice(0, 2);
  }

  private confirmButton(dialog: HTMLElement): HTMLElement | null {
    const ok = [...dialog.querySelectorAll<HTMLElement>(OK_BUTTON)].find((el) => this.shown(el));
    if (ok) return ok;
    return [...dialog.querySelectorAll<HTMLElement>('button, [role="button"]')].find((el) => this.shown(el) && SCHEDULE_SEND.test(text(el))) ?? null;
  }

  /** Gmail marks a field it can't read (aria-invalid) and then ignores Schedule send, so try each spelling; stop with Gmail's words if none takes. */
  private async fillAccepted(dialog: HTMLElement, input: HTMLInputElement, values: string[]) {
    // Gmail's own value shows how it writes a date or time; that shape goes first.
    const own = input.value;
    for (const value of new Set([...values.map((v) => shapedLike(own, v)), ...values])) {
      this.fill(input, value);
      // Gmail checks the field a beat after it changes.
      await this.sleep(FIELD_CHECK_MS);
      if (input.getAttribute('aria-invalid') !== 'true') return;
    }
    const said = this.fieldError(dialog, input) || `${input.getAttribute('aria-label') || 'A field'} "${input.value}" wasn't accepted`;
    throw new GmailPageError(`Gmail said: ${said} (its own value was ${JSON.stringify(own)}; tried ${[...new Set(values)].map((v) => JSON.stringify(v)).join(', ')})`, undefined, said);
  }

  /** Its described-by text, or an alert in the dialog. */
  private fieldError(dialog: HTMLElement, input: HTMLInputElement): string {
    const ids = input.getAttribute('aria-describedby')?.split(/\s+/) ?? [];
    const described = ids.map((id) => this.doc.getElementById(id)).filter((el): el is HTMLElement => !!el && this.shown(el));
    const alert = [...dialog.querySelectorAll<HTMLElement>('[role="alert"], [aria-live]')].filter((el) => this.shown(el));
    return spaced([...described, ...alert].map(text).filter(Boolean).join(' '));
  }

  /** The way a person would, so Gmail's parsing runs. */
  private fill(input: HTMLInputElement, value: string) {
    input.focus();
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    input.blur();
  }

  /** A shown button or link by its English name, label or tooltip. */
  private named(name: RegExp): HTMLElement | null {
    for (const el of this.doc.querySelectorAll<HTMLElement>('[role="button"], button, [role="link"]')) {
      const label = el.getAttribute('aria-label') ?? el.getAttribute('data-tooltip') ?? '';
      if ((name.test(label.trim()) || name.test(text(el))) && this.shown(el)) return el;
    }
    return null;
  }

  /** The "butter bar", as InboxSDK finds it. */
  private toastText(): string {
    const bar = this.doc.querySelector('div.b8[role="alert"] .vh') ?? this.doc.querySelector('[role="alert"]');
    return bar?.textContent?.trim() ?? '';
  }

  /** Closes dialogs this left open and compose windows it opened (Gmail saves them). */
  private tidy(before: Set<HTMLElement>) {
    for (const d of this.doc.querySelectorAll<HTMLElement>(DIALOGS)) {
      if (!this.shown(d) || d.querySelector('input[name="draft"]')) continue;
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    }
    for (const compose of this.composes()) {
      if (before.has(compose)) continue;
      const close = this.closeButton(compose);
      if (close) this.press(close);
    }
  }

  /** InboxSDK's getCloseButton: the title bar's third image, or its `.Ha` button. */
  private closeButton(compose: HTMLElement): HTMLElement | null {
    for (let el: HTMLElement | null = compose, up = 0; el && up < 6; el = el.parentElement, up++) {
      const found = el.querySelectorAll<HTMLElement>('.Hm > img')[2] ?? el.querySelector<HTMLElement>('.Hm .Ha');
      if (found) return found;
    }
    return null;
  }

  /** Gmail keeps earlier lists in the page, hidden, so only laid-out rows count. */
  private shownIds(): string[] {
    const ids: string[] = [];
    for (const row of this.doc.querySelectorAll<HTMLElement>('tr.zA')) {
      const id = row.querySelector('[data-thread-id]')?.getAttribute('data-thread-id')?.replace(/^#/, '');
      if (id && this.shown(row)) ids.push(id);
    }
    return ids;
  }

  private row(threadId: string): HTMLElement | null {
    for (const el of this.doc.querySelectorAll<HTMLElement>(`[data-thread-id="#${CSS.escape(threadId)}"]`)) {
      const row = el.closest<HTMLElement>('tr');
      if (row && this.shown(row)) return row;
    }
    return null;
  }

  /** Gmail keeps hidden copies of toolbars for other views. */
  private button(names: string[]): HTMLElement | null {
    for (const el of this.doc.querySelectorAll<HTMLElement>('[role="button"][aria-label], [role="button"][data-tooltip]')) {
      const name = el.getAttribute('aria-label') ?? el.getAttribute('data-tooltip') ?? '';
      if (names.includes(name.trim()) && this.shown(el)) return el;
    }
    return null;
  }

  private textControl(text: RegExp): HTMLElement | null {
    for (const el of this.doc.querySelectorAll<HTMLElement>('[role="button"], [role="link"], [tabindex]')) {
      if (text.test(el.textContent?.trim() ?? '') && this.shown(el)) return el;
    }
    return null;
  }

  /** Resolves whether it asked. */
  private async confirm(): Promise<boolean> {
    const deadline = this.now() + CONFIRM_WAIT_MS;
    while (this.now() < deadline) {
      const ok = this.okButton();
      if (ok) {
        this.press(ok);
        return true;
      }
      await this.sleep(100);
    }
    return false;
  }

  private okButton(): HTMLElement | null {
    for (const el of this.doc.querySelectorAll<HTMLElement>('[role="alertdialog"] button, [role="dialog"] button')) {
      if ((el.getAttribute('name') === 'ok' || el.textContent?.trim() === 'OK') && this.shown(el)) return el;
    }
    return null;
  }

  /** Gmail's controls listen for the whole press, not just click. */
  private press(el: HTMLElement) {
    const box = el.getBoundingClientRect?.();
    const at = box ? { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 } : {};
    // Closure's controls read the event's view and act on mousedown then mouseup.
    const view = this.doc.defaultView;
    for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, view, ...at }));
    }
  }

  /** Like until, for something that may never happen. */
  private async wait(check: () => boolean, ms: number): Promise<boolean> {
    const deadline = Math.min(this.now() + ms, this.budgetEnd);
    while (!check()) {
      if (this.now() >= deadline) return false;
      await this.sleep(100);
    }
    return true;
  }

  private async until<T>(check: () => T | null | undefined | false, step: string): Promise<T> {
    const deadline = Math.min(this.now() + this.stepTimeoutMs, this.budgetEnd);
    for (;;) {
      const value = check();
      if (value) return value;
      if (this.now() >= deadline) throw new GmailPageError(`Gmail's page didn't respond in time (couldn't ${step}).`, step);
      await this.sleep(100);
    }
  }
}

function text(el: Element): string {
  return el.textContent?.trim() ?? '';
}

/** Leaving out `skip`, with a space wherever Gmail split the text. */
function words(el: Element, skip: Element[]): string {
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!skip.some((s) => s.contains(node))) parts.push(node.textContent ?? '');
  }
  return spaced(parts.join(' '));
}

/** The same space before AM/PM (or none) and the same case as `own`. */
function shapedLike(own: string, value: string): string {
  const shape = /\d([\s\u00a0\u202f]*)([ap]m)$/i.exec(own.trim());
  const ours = /^(.*\d)[\s\u00a0\u202f]*([ap]m)$/i.exec(value.trim());
  if (!shape || !ours) return value;
  const meridiem = shape[2] === shape[2]!.toLowerCase() ? ours[2]!.toLowerCase() : ours[2]!.toUpperCase();
  return `${ours[1]}${shape[1]}${meridiem}`;
}

/** Intl puts narrow and non-breaking spaces in times ("8:00\u202fAM"); Gmail may not. */
function spaced(s: string): string {
  return s.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
}

/** Not part of a longer number ("Oct 1" in "Oct 14"). */
function hasToken(s: string, token: string): boolean {
  for (let i = s.indexOf(token); i >= 0; i = s.indexOf(token, i + 1)) {
    const before = s[i - 1] ?? '';
    const after = s[i + token.length] ?? '';
    if (!/\d/.test(before) && !/\d/.test(after)) return true;
  }
  return false;
}

/** So a row's wrapper isn't pressed for the row. */
function innermost(els: HTMLElement[]): HTMLElement[] {
  return els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
}

function enabledEl(el: HTMLElement | null): HTMLElement | null {
  if (!el || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null;
  return el;
}

/** "#msg-a:r123" and "msg-a:r123" are the same draft. */
function draftKey(id: string): string {
  return id.trim().replace(/^#/, '').replace(/^msg-a:/, '');
}

/** Even if the page itself is hidden: display:none toolbars have no boxes. */
function laidOut(el: Element): boolean {
  return el.getClientRects().length > 0 || (el as HTMLElement).offsetParent !== null;
}
