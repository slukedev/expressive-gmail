/**
 * Gemini in Gmail, driven on Gmail's own page hidden under the app. There is no public Gemini API for Gmail, so this presses Gmail's controls and reads what it shows: Help me write and Refine in a compose window it always discards, the summary card, Ask Gmail's AI Overview, AI Inbox.
 * It never presses Send or Insert into a message that stays, and runs in GmailPage's queue so it never interleaves with schedule send or a delete.
 * Everything runs in the isolated content script; nothing needs the main world, so Safari works the same.
 */

import { BackendError } from '../app/data/backend';
import {
  ALL_GEMINI_FEATURES,
  type BriefingTodo,
  type BriefingTopic,
  type GeminiAnswer,
  type GeminiFeature,
  type GeminiRequest,
  type GeminiResult,
  type GeminiSource,
  type GeminiStatus,
  type GeminiTurn,
  type ProofreadFix,
  type RefineMode,
} from '../app/data/gemini';
import { GmailPageError, type GmailPage, type PageControl } from './gmail-page';
import { fromLegacyHexId, fromThreadUrlId, normalizeThreadId, threadUrlId, toLegacyHexId } from './ids';

// Every selector and label this file reads, in one table, because Gmail changes them. Sources:
// [I] InboxSDK / gmail.js, stable. [R] public research lists of Gmail's Gemini classes (2024 to 2026), obfuscated, low to medium confidence.
// [G] Gmail's English labels. [ARIA] generic roles. [D] seen in a real account (Safari, October 2026), medium confidence.
// Labels are English only: geminiStatus reports another language as 'page'.

const HOOKS = {
  /** [I] Gmail's main view and search form: the page is there at all. */
  appPage: '[role="main"], [gh="tm"], form[role="search"], input[name="q"]',
  /** [I] the search box; [R] `.searchboxInputFontClass` on the AI search box. */
  searchBox: 'input[name="q"], input.searchboxInputFontClass',
  /** [R] the box's placeholder (or [G] name) when AI search is on. */
  askGmail: /^ask gmail\b/i,
  /** [R] the search button. */
  searchButton: 'button[aria-label="Search mail"], [role="button"][aria-label="Search mail"]',
  /** [R] AI Overview above search results; [G] its English heading as the fallback. */
  overview: '.JLWipf, [aria-label="AI Overview"]',
  overviewHeading: /^ai overview$/i,
  /** [G] words only an AI answer carries: its caption, or Gemini's disclaimer. */
  overviewMark: /^(ai overview|gemini can make mistakes|ai responses may include mistakes)/i,
  /** [R] Help me write, next to Send (`command="sdt"`), then [G] its tooltip. */
  helpMeWrite: '[command="sdt"], .bDl[command="sdt"], .wG.J-Z-I.bDl, [data-tooltip*="Help me write"], [aria-label*="Help me write"]',
  /** [R] Help me write's prompt popup. */
  writePrompt: '.jKzJCd, .eLNZDd[command="sdt"]',
  /** [ARIA] */
  promptInput: 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], input[type="text"], input:not([type])',
  /** [ARIA] */
  liveRegion: '[aria-live], [role="status"]',
  /** [G] */
  create: /^create$/i,
  refine: /^refine$/i,
  refineModes: {
    polish: /^polish$/i,
    formalize: /^formali[sz]e$/i,
    elaborate: /^elaborate$/i,
    shorten: /^shorten$/i,
    rephrase: /^(rephrase|recreate)$/i,
  } satisfies Record<RefineMode, RegExp>,
  /** [R] summary card at the top of a conversation (2025), then [R] "summarize this email v2.0". */
  summaryCard: '.eJPjde, .einvLd',
  /** [G] */
  summarize: /^summari[sz]e this email$/i,
  /** [R] Gemini's suggested replies under a conversation. */
  replies: '.B6t8wd, .mVCoBd',
  /** [R] Ask Gemini in Gmail's header (Workspace), and the Gemini callout ("gemkick" is Google's internal name). */
  askGemini: '.e5IPTd, [data-rp-placement-id="gemkick-pep-icon-callout-id"]',
  /** [D] Gemini's side panel: the header button that opens it, the box it takes a question in, its title. */
  panelButton: '.e5IPTd button, button[aria-label="Ask Gemini"]',
  panelInput: '[role="combobox"][aria-label="Ask Gemini"], .Pv5YRd[role="combobox"]',
  panelTitle: /^gemini$/i,
  /** [G] */
  send: /^(send|send message|submit)$/i,
  stop: /^stop/i,
  newChat: /^(new chat|start (a )?new chat)$/i,
  /** [D] what the panel says when it did something (made a draft) instead of showing the text. */
  panelDone: /^(done|ok(ay)?|sure|all set|i('ve| have) (drafted|created|written|opened)\b[^\n]{0,80})\.?!?$/i,
  /** [G] what the panel shows while it works, before the answer; [D] "Collecting info..." in Safari. */
  thinking: /^(thinking|generating|searching|reading|working|collecting|gathering|looking|checking|analy[sz]ing|reviewing|summari[sz]ing|getting|loading|just a sec|one moment)\b/i,
  /** [D] the screen reader label Gmail puts before each Gemini answer, which isn't part of it. */
  answerLabel: /^gemini (response|said|replied)\b[:.]?\s*/i,
  /** [D] what a source number after a sentence in the panel's answer can be. */
  cite: 'a, button, sup, [role="link"], [role="button"]',
  /** [R] */
  aiInbox: '.CL.u7KLgd',
  /** [G] */
  proofread: /^proofread$/i,
  acceptAll: /^accept all$/i,
  accept: /^accept$/i,
  noSuggestions: /no (suggestions|issues|changes)|looks good/i,
  /** [G] Help me schedule (Workspace, English, US) and the button that writes its times into the message. */
  helpMeSchedule: /^help me schedule$/i,
  insertTimes: /^(insert|insert times|add to email|insert into email)$/i,
  /** [G] */
  moreOptions: /^more options$/i,
  /** [I] compose: the hidden draft field, the message body, To and Subject. */
  draftField: 'input[name="draft"]',
  body: 'div[g_editable="true"], div[contenteditable="true"][aria-label="Message Body"], div.Am.Al.editable',
  to: 'input[name="to"], textarea[name="to"], input[aria-label="To recipients"], input[aria-label="To"]',
  subject: 'input[name="subjectbox"]',
  /** [I] a compose window's container: floating (`.M9` inside a dialog) or inline reply (`.ip`, `.AD`). */
  composeRoot: '[role="dialog"], .M9, .ip, .AD',
  /** [I] Discard draft: InboxSDK's `.og`, then [G] its tooltip. */
  discard: /^discard draft/i,
  discardClass: '.og',
  /** [I] quoted text and signature, which aren't part of what Gemini wrote. */
  notWritten: '.gmail_quote, .gmail_signature, [data-smartmail="gmail_signature"], .gmail_extra',
  /** [I] an open conversation: its subject header and permanent ids. */
  threadHeader: 'h2.hP',
  /** [I] Reply in a conversation (`.ams.bkH`), then [G] its name. */
  replyClass: '.ams.bkH',
  reply: /^reply$/i,
  /** [I] how Gmail marks which conversation an element belongs to. */
  threadRef: '[data-thread-id], [data-thread-perm-id], [data-legacy-thread-id], a[href*="#"]',
  /** [ARIA] */
  loading: '[role="progressbar"], [aria-busy="true"]',
  /** [ARIA] a control, not part of an answer. */
  control: 'button, [role="button"], [role="menuitem"], input, textarea, select, [role="toolbar"]',
  /** [G] words around an answer that aren't the answer. */
  chromeText: /^(ai overview|summary|summari[sz]e this email|help me write|gemini|sources?:?|show more|show less)$/i,
  disclaimer: /can make mistakes|learn more|give feedback|was this helpful/i,
  /** [G] AI Inbox section headings that hold things to do. */
  todoHeading: /to.?do|action|needs? (your )?(attention|reply)|follow.?up|suggested/i,
  /** [ARIA] */
  clickable: '[role="button"], button, [role="link"], a, [role="menuitem"], [role="option"], [role="menuitemradio"], [role="radio"], [tabindex]',
  dialogs: '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="complementary"], [role="region"]',
  headings: 'h1, h2, h3, h4, [role="heading"]',
  rows: 'li, tr, [role="listitem"], [role="row"], [role="article"]',
} as const;

const STEP_TIMEOUT_MS = 10_000;
/** How long Gemini gets to start answering. */
const ANSWER_TIMEOUT_MS = 45_000;
/** Then its search address is used instead. */
const SEARCH_START_MS = 4_000;
/** One request as a whole, however the steps add up. */
const RUN_BUDGET_MS = 90_000;
/** An answer is done when its text hasn't changed for this long and Gmail shows no loading state. */
const SETTLE_MS = 1_200;
const POLL_MS = 150;
/** Before the next fallback is tried. */
const MENU_WAIT_MS = 3_000;
/** How long Gmail gets to offer a summary chip or card in a conversation it just opened. */
const OFFER_WAIT_MS = 3_000;
/** How long Gmail gets to close a compose window after Discard draft. */
const DISCARD_WAIT_MS = 3_000;
const STATUS_TTL_MS = 3 * 60_000;
/** A "no" is looked at again sooner: Gmail adds its Gemini hooks a while after it loads. */
const STATUS_RETRY_MS = 30_000;
/** Ask Gmail's box takes a question, not an essay. */
const MAX_QUESTION = 400;
/** Text sent for Refine through the side panel. */
const MAX_REFINE = 4_000;
/** How long a compose window Gemini opens from the side panel gets to show up after its answer. */
const PANEL_COMPOSE_MS = 1_500;
const MAX_ACCEPTS = 50;
const BRIEFING_QUESTION = 'What needs my attention in my email from the last few days?';

const NO_HELP_ME_WRITE = "Gmail didn't show a Help me write button. Gemini may not be part of this account's plan, or Gmail changed.";
const NO_PANEL = "Gmail here has no Gemini side panel (Ask Gemini, top right). Gemini comes with Google AI plans and some Workspace plans.";
const NO_ASK_GMAIL = "Gmail's search here isn't Ask Gmail, so Gemini can't answer questions for this account. It comes with Google AI plans and some Workspace plans.";

export interface GmailGeminiOptions {
  /** The page driver whose queue (and wake) Gemini's actions share. */
  page: GmailPage;
  window?: Window;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Overridable for tests (jsdom has no layout). */
  shown?: (el: Element) => boolean;
  stepTimeoutMs?: number;
  answerTimeoutMs?: number;
  settleMs?: number;
  /** What Gmail showed when a step failed or cleanup didn't finish. */
  diagnostic?: (line: string) => void;
}

export interface GeminiRunOptions {
  onText?: (text: string) => void;
  /** The open conversation's subject, for chat grounded in one conversation. */
  subject?: string;
  /** The user's, so never written into or discarded. */
  drafts?: string[];
}

interface Running {
  controller: AbortController;
  settled: Promise<void>;
  /** Holding the page, rather than waiting in the queue. */
  started: boolean;
}

function stoppedError(): BackendError {
  return new BackendError('Stopped', 'unknown');
}

export class GmailGemini {
  private readonly page: GmailPage;
  private readonly win: Window;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly shown: (el: Element) => boolean;
  private readonly stepTimeoutMs: number;
  private readonly answerTimeoutMs: number;
  private readonly settleMs: number;
  private readonly diagnostic: (line: string) => void;
  private readonly running = new Map<string, Running>();
  private cached: { value: GeminiStatus; until: number } | undefined;
  /** What using a feature showed: present or not, over what the page's hooks suggest. */
  private readonly seen = new Map<GeminiFeature, boolean>();
  /** What earlier jobs learned that saves the next one a step. */
  private readonly hints: JobHints = {};

  constructor(options: GmailGeminiOptions) {
    this.page = options.page;
    this.win = options.window ?? window;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = options.now ?? (() => Date.now());
    this.shown = options.shown ?? laidOut;
    this.stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
    this.answerTimeoutMs = options.answerTimeoutMs ?? ANSWER_TIMEOUT_MS;
    this.settleMs = options.settleMs ?? SETTLE_MS;
    this.diagnostic = options.diagnostic ?? (() => undefined);
  }

  private get doc(): Document {
    return this.win.document;
  }

  /** Read from hooks already in the page (nothing is opened to check). Help me write, Refine and summaries are assumed wherever any Gemini hook shows, and confirmed (or dropped) on first use. */
  async status(): Promise<GeminiStatus> {
    if (this.cached && this.now() < this.cached.until) return this.cached.value;
    const value = this.detect();
    this.cached = { value, until: this.now() + (value.ready ? STATUS_TTL_MS : STATUS_RETRY_MS) };
    return value;
  }

  private detect(): GeminiStatus {
    if (!this.doc.querySelector(HOOKS.appPage)) return { ready: false, block: 'page', detail: "Gmail's page hasn't finished loading here. Try again in a moment." };
    const lang = this.otherLanguage();
    if (lang) return { ready: false, block: 'page', detail: needsEnglish(lang) };
    const found = new Set<GeminiFeature>();
    const add = (...features: GeminiFeature[]) => features.forEach((f) => found.add(f));
    const ask = this.searchBoxes().some(isAskGmail);
    // Ask Gmail answers questions, chat, and the briefing when there's no AI Inbox.
    if (ask) add('search', 'chat', 'inbox');
    if (this.doc.querySelector(HOOKS.helpMeWrite)) add('write', 'refine');
    if (this.doc.querySelector(HOOKS.summaryCard) || this.labelled(HOOKS.summarize)) add('summary');
    if (this.doc.querySelector(HOOKS.replies)) add('replies');
    if (this.doc.querySelector(HOOKS.aiInbox)) add('inbox');
    if (this.labelled(HOOKS.proofread)) add('proofread');
    if (this.labelled(HOOKS.helpMeSchedule)) add('schedule');
    const gemini = ask || found.has('write') || found.has('summary') || found.has('inbox') || !!this.doc.querySelector(HOOKS.askGemini);
    if (gemini) add('write', 'refine', 'summary');
    // The side panel writes and refines too (draftInPanel), for accounts whose compose has no Help me write.
    if (this.doc.querySelector(`${HOOKS.panelButton}, ${HOOKS.panelInput}`)) add('chat', 'search', 'summary', 'write', 'refine');
    for (const [feature, present] of this.seen) {
      if (present) found.add(feature);
      else found.delete(feature);
    }
    if (!found.size) {
      return {
        ready: false,
        block: 'plan',
        detail: "Gmail here shows no Gemini features. Gemini in Gmail comes with Google AI plans and some Google Workspace plans, and needs Gmail's smart features on in Settings > General.",
      };
    }
    return { ready: true, features: ALL_GEMINI_FEATURES.filter((f) => found.has(f)) };
  }

  /** Cheap: no layout. */
  private labelled(name: RegExp): boolean {
    for (const el of this.doc.querySelectorAll<HTMLElement>('[aria-label], [data-tooltip], [role="menuitem"]')) {
      if (name.test((el.getAttribute('aria-label') ?? el.getAttribute('data-tooltip') ?? text(el)).trim())) return true;
    }
    return false;
  }

  private searchBoxes(): HTMLInputElement[] {
    return [...this.doc.querySelectorAll<HTMLInputElement>(HOOKS.searchBox)];
  }

  /** `hl`, then the page's lang. */
  private otherLanguage(): string | undefined {
    let hl: string | null = null;
    try {
      hl = new URL(this.win.location.href).searchParams.get('hl');
    } catch {
      // No usable address: the page's lang decides.
    }
    const lang = (hl || this.doc.documentElement.lang || '').trim();
    return lang && !/^en\b/i.test(lang) ? lang : undefined;
  }

  private note(feature: GeminiFeature | GeminiFeature[], present: boolean) {
    for (const f of [feature].flat()) {
      if (this.seen.get(f) === present) continue;
      this.seen.set(f, present);
      this.cached = undefined;
    }
  }

  /** Rejects with BackendError 'unsupported' when Gmail doesn't offer the feature, 'unknown' "Stopped" after cancel, and GmailPageError (with the step) when Gmail stops responding. */
  async run(request: GeminiRequest, requestId: string, options: GeminiRunOptions = {}): Promise<GeminiResult> {
    const lang = this.otherLanguage();
    if (lang) throw new BackendError(needsEnglish(lang), 'unsupported');
    this.running.get(requestId)?.controller.abort();
    const controller = new AbortController();
    const stopped = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(stoppedError()), { once: true }));
    const work = this.page.exclusive((control) => {
      entry.started = true;
      return new Job(this.env(), control, controller.signal, options.onText ?? (() => undefined), options.drafts).run(request, options);
    });
    const entry: Running = { controller, settled: work.then(noop, noop), started: false };
    this.running.set(requestId, entry);
    try {
      const result = await Promise.race([work, stopped]);
      this.learn(request);
      return result;
    } catch (err) {
      if (err instanceof JobMissing) {
        this.note(err.features, false);
        throw new BackendError(err.message, 'unsupported');
      }
      throw err;
    } finally {
      if (this.running.get(requestId) === entry) this.running.delete(requestId);
    }
  }

  /** Resolves once Gmail's page is tidied (any compose it opened discarded). */
  async cancel(requestId: string): Promise<void> {
    const entry = this.running.get(requestId);
    if (!entry) return;
    entry.controller.abort();
    // Still queued: it sees the abort before touching anything.
    if (entry.started) await entry.settled;
  }

  private learn(request: GeminiRequest) {
    const used: Partial<Record<GeminiRequest['kind'], GeminiFeature[]>> = {
      write: ['write', 'refine'],
      refine: ['refine'],
      summarize: ['summary'],
      replies: ['replies'],
      proofread: ['proofread'],
      schedule: ['schedule'],
    };
    const features = used[request.kind];
    if (features) this.note(features, true);
  }

  private env(): JobEnv {
    return {
      doc: this.doc,
      win: this.win,
      sleep: this.sleep,
      now: this.now,
      shown: this.shown,
      stepTimeoutMs: this.stepTimeoutMs,
      answerTimeoutMs: this.answerTimeoutMs,
      settleMs: this.settleMs,
      diagnostic: this.diagnostic,
      hints: this.hints,
    };
  }
}

interface JobHints {
  /** One miss can be Gmail loading slowly; two mean this account writes in the side panel. */
  helpMeWriteMisses?: number;
}

interface JobEnv {
  doc: Document;
  win: Window;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  shown: (el: Element) => boolean;
  stepTimeoutMs: number;
  answerTimeoutMs: number;
  settleMs: number;
  diagnostic: (line: string) => void;
  hints: JobHints;
}

/** These features are noted as missing. */
class JobMissing extends Error {
  constructor(
    message: string,
    readonly features: GeminiFeature[],
  ) {
    super(message);
  }
}

interface Compose {
  body: HTMLElement;
  root: HTMLElement;
}

class Job {
  private readonly budgetEnd: number;
  /** Compose windows this job opened, discarded when done. A user's own draft reply that a conversation shows is never this job's. */
  private readonly opened = new Set<HTMLElement>();
  /** Bodies on screen just before a compose this job asked for, until it shows up. */
  private awaiting: Set<HTMLElement> | undefined;
  private readonly usersDrafts: Set<string>;
  private readonly dialogsBefore: Set<HTMLElement>;

  constructor(
    private readonly env: JobEnv,
    private readonly control: PageControl,
    private readonly signal: AbortSignal,
    private readonly onText: (text: string) => void,
    drafts: string[] = [],
  ) {
    this.usersDrafts = new Set(drafts.map(draftKey));
    this.budgetEnd = env.now() + Math.max(RUN_BUDGET_MS, env.answerTimeoutMs + env.stepTimeoutMs);
    this.dialogsBefore = new Set(this.shownAll<HTMLElement>(`${HOOKS.dialogs}, ${HOOKS.writePrompt}`));
  }

  private get doc() {
    return this.env.doc;
  }

  async run(request: GeminiRequest, options: GeminiRunOptions): Promise<GeminiResult> {
    this.check();
    try {
      return await this.runKind(request, options);
    } catch (err) {
      // What Gmail showed instead, so a failure can be matched to Gmail's markup.
      if (!this.signal.aborted) this.env.diagnostic(`gemini ${request.kind} failed: ${err instanceof Error ? err.message : String(err)}\n${this.outline()}`);
      throw err;
    } finally {
      await this.tidy();
    }
  }

  /** Gmail's AI controls as tags, roles, labels and classes. Only labels Gmail gives its own controls are read, never a message's text. */
  private outline(): string {
    const words = /gemini|summar|ai overview|ask gmail|help me write|refine|proofread|polish|ai inbox|suggested repl/i;
    const lines: string[] = [];
    const named = new Set<Element>();
    const consider = (el: Element, label: string) => {
      // Suggested replies and the message itself are written from the user's mail.
      if (named.size >= 16 || named.has(el) || !words.test(label) || el.closest(`${HOOKS.replies}, ${HOOKS.body}, .a3s`)) return;
      named.add(el);
      const chain: string[] = [];
      for (let up = el.parentElement, i = 0; up && up !== this.doc.body && i < 4; up = up.parentElement, i++) chain.push(describe(up));
      lines.push(`  ${this.env.shown(el) ? '' : '(hidden) '}${describe(el)} "${clip(spaced(label), 50)}" in ${chain.join(' < ') || 'body'}`);
    };
    for (const el of this.doc.querySelectorAll('[aria-label], [data-tooltip], [title], [placeholder]')) {
      consider(el, el.getAttribute('aria-label') ?? el.getAttribute('data-tooltip') ?? el.getAttribute('title') ?? el.getAttribute('placeholder') ?? '');
    }
    for (const el of this.doc.querySelectorAll(`${HOOKS.headings}, button, [role="button"]`)) {
      if (el.children.length <= 3) consider(el, text(el).slice(0, 80));
    }
    const hooks = (Object.entries(HOOKS) as [string, unknown][])
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k} ${this.doc.querySelectorAll(v as string).length}/${this.shownAll(v as string).length}`)
      .join(', ');
    return [`  at ${this.env.win.location.hash.slice(0, 30)}; hooks found/shown: ${hooks}`, ...lines].join('\n');
  }

  private async runKind(request: GeminiRequest, options: GeminiRunOptions): Promise<GeminiResult> {
    switch (request.kind) {
      // Gemini's side panel answers wherever this account has it; Ask Gmail's overview is the fallback.
      case 'search':
        if (!this.hasPanel()) return { kind: 'answer', ...(await this.ask(request.query)) };
        await this.leaveConversation();
        return { kind: 'answer', ...(await this.askPanel(request.query)) };
      case 'chat': {
        const question = chatQuestion(request.turns, request.threadId ? options.subject : undefined);
        if (!this.hasPanel()) return { kind: 'answer', ...(await this.ask(question)) };
        // The panel answers about what Gmail shows: the conversation, or else the inbox.
        if (request.threadId) await this.openThread(request.threadId);
        else await this.leaveConversation();
        return { kind: 'answer', ...(await this.askPanel(question)) };
      }
      case 'summarize':
        return await this.summarize(request.threadId);
      case 'write':
        return await this.write(request);
      case 'refine':
        return await this.refine(request.text, request.mode, request.threadId);
      case 'replies':
        return await this.replies(request.threadId);
      case 'proofread':
        return await this.proofread(request.text);
      case 'briefing':
        return await this.briefing();
      case 'schedule':
        return await this.schedule(request.threadId, request.durationMinutes);
    }
  }

  /** A question through Ask Gmail; the AI Overview above the results is the answer. */
  private async ask(question: string): Promise<GeminiAnswer> {
    const box = await this.until(() => this.searchBoxes().find((b) => this.env.shown(b)) ?? null, 'find the search box');
    if (!isAskGmail(box)) throw new JobMissing(NO_ASK_GMAIL, ['search', 'chat']);
    // Overviews already on the page are stale unless Gmail writes into them again.
    const seen = new Set(this.overviews());
    const touched = new Set<Element>();
    const observer = new MutationObserver((records) => {
      for (const r of records) for (const o of seen) if (o.contains(r.target)) touched.add(o);
    });
    observer.observe(this.doc.documentElement, { subtree: true, childList: true, characterData: true });
    try {
      const hashBefore = this.env.win.location.hash;
      fill(box, question);
      const button = this.shownAll<HTMLElement>(HOOKS.searchButton)[0];
      // A synthetic Enter never submits a form; Gmail only hears a click or a real submit.
      if (button) press(button);
      else if (box.form) box.form.requestSubmit();
      const fresh = () => this.overviews().find((o) => !seen.has(o) || touched.has(o)) ?? null;
      const searching = () => !!fresh() || (this.env.win.location.hash !== hashBefore && /^#search\//.test(this.env.win.location.hash));
      // Gmail's box didn't take it: its search address runs the same search.
      if (!(await this.wait(searching, SEARCH_START_MS))) this.control.navigate(`#search/${encodeURIComponent(question)}`);
      if (!(await this.wait(() => !!fresh(), this.env.answerTimeoutMs))) {
        this.env.diagnostic(`gemini: no AI Overview after asking; ${this.describeResults()}`);
        throw new GmailPageError("Gmail's page didn't respond in time (couldn't show an AI Overview).", 'show an AI Overview');
      }
      this.control.claim();
      const read = () => {
        const o = fresh();
        return o ? toMarkdown(o, this.env.shown).text : '';
      };
      await this.stream(read, () => this.busy(fresh()), 'finish the AI Overview');
      const overview = fresh();
      if (!overview) throw new GmailPageError("Gmail's page didn't respond in time (couldn't finish the AI Overview).", 'finish the AI Overview');
      this.control.claim();
      return toMarkdown(overview, this.env.shown);
    } finally {
      observer.disconnect();
    }
  }

  private overviews(): HTMLElement[] {
    const out = this.shownAll<HTMLElement>(HOOKS.overview);
    const take = (box: HTMLElement | null) => {
      if (box && !out.some((o) => o.contains(box) || box.contains(o))) out.push(box);
    };
    for (const h of this.shownAll<HTMLElement>(HOOKS.headings)) {
      if (HOOKS.overviewHeading.test(text(h))) take(h.parentElement);
    }
    // Gmail's class names change; its caption and disclaimer don't. The answer is the smallest box around one that holds more than the caption.
    if (!out.length) {
      for (const label of this.labels(HOOKS.overviewMark)) take(this.answerAround(label));
    }
    return out;
  }

  /** Shown elements whose own words (not their children's) match. */
  private labels(words: RegExp): HTMLElement[] {
    const main = this.doc.querySelector('[role="main"]') ?? this.doc.body;
    const found: HTMLElement[] = [];
    const walker = this.doc.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && found.length < 6; n = walker.nextNode()) {
      const el = n.parentElement;
      if (el && words.test((n.textContent ?? '').trim()) && this.env.shown(el) && !found.includes(el)) found.push(el);
    }
    return found;
  }

  private answerAround(label: HTMLElement): HTMLElement | null {
    const main = this.doc.querySelector('[role="main"]');
    const own = spaced(text(label)).length;
    for (let el = label.parentElement; el && el !== main && el !== this.doc.body; el = el.parentElement) {
      // Past the answer and into the results list: stop.
      if (el.querySelector('[role="row"], tr.zA')) return null;
      if (spaced(text(el)).length > own + 40) return el;
    }
    return null;
  }

  /** For the diagnostics log when no answer shows. */
  private describeResults(): string {
    const main = this.doc.querySelector<HTMLElement>('[role="main"]');
    if (!main) return 'no main view';
    const blocks = [...main.querySelectorAll<HTMLElement>('div[class]')]
      .filter((el) => this.env.shown(el) && el.children.length && spaced(text(el)).length > 40 && !el.querySelector('[role="row"], tr.zA'))
      .slice(0, 4)
      .map((el) => `.${el.className.toString().trim().split(/\s+/).join('.')} "${spaced(text(el)).slice(0, 40)}"`);
    return `hash ${this.env.win.location.hash.slice(0, 40)}, search box "${this.searchBoxes()[0]?.getAttribute('placeholder') ?? ''}", ${blocks.join(', ') || 'no text blocks'}`;
  }

  private hasPanel(): boolean {
    return !!this.doc.querySelector(`${HOOKS.panelButton}, ${HOOKS.panelInput}`);
  }

  private panelInput(): HTMLElement | null {
    return this.shownAll<HTMLElement>(HOOKS.panelInput)[0] ?? null;
  }

  /** So a question about mail in general isn't read as one about a conversation left open. */
  private async leaveConversation() {
    if (!this.shownAll(HOOKS.threadHeader).length) return;
    this.control.navigate('#inbox');
    await this.wait(() => !this.shownAll(HOOKS.threadHeader).length, this.env.stepTimeoutMs);
  }

  /** Returns the panel and where it takes a question. */
  private async openPanel(): Promise<{ root: HTMLElement; input: HTMLElement }> {
    let input = this.panelInput();
    if (!input) {
      const button = this.shownAll<HTMLElement>(HOOKS.panelButton)[0];
      if (!button) throw new JobMissing(NO_PANEL, ['chat', 'search']);
      press(button);
      input = await this.until(() => this.panelInput(), 'open the Gemini panel');
    }
    return { root: this.panelRoot(input), input };
  }

  /** The nearest box around the input that also holds its "Gemini" title. */
  private panelRoot(input: HTMLElement): HTMLElement {
    let fallback = input;
    for (let el = input.parentElement, i = 0; el && el !== this.doc.body; el = el.parentElement, i++) {
      if (i < 8) fallback = el;
      for (const h of el.querySelectorAll(HOOKS.headings)) if (HOOKS.panelTitle.test(text(h))) return el;
    }
    return fallback;
  }

  /** Answered about whatever Gmail shows (the open conversation, or the inbox). Each starts a new chat where offered; earlier turns ride in the question (chatQuestion). */
  private async askPanel(question: string): Promise<GeminiAnswer> {
    let { root, input } = await this.openPanel();
    const fresh = this.named(HOOKS.newChat, root);
    if (fresh) {
      press(fresh);
      await this.wait(() => !!this.panelInput() && this.panelInput() !== input, 1_000);
      input = this.panelInput() ?? input;
      root = this.panelRoot(input);
    }
    const before = new Set(root.querySelectorAll('*'));
    const send = () => this.named(HOOKS.send, root);
    const ready = () => {
      const b = send();
      return !!b && !b.matches(':disabled, [aria-disabled="true"]');
    };
    // Gmail's editor keeps its own copy of the text and Submit stays disabled until that copy has it; each way in is tried in turn.
    let how = '';
    for (const way of ENTRY_WAYS) {
      way.enter(input, question);
      if (await this.wait(ready, 1_200)) {
        how = way.name;
        break;
      }
    }
    const button = send();
    this.env.diagnostic(
      `gemini panel: ${describe(root)}; box ${describe(editableIn(input))} holds ${spaced(text(input)).length} of ${question.length} chars; ` +
        (how ? `Submit came on after ${how}` : button ? `Submit stayed disabled (${describe(button)}), pressed Enter` : 'no Submit, pressed Enter'),
    );
    if (how && button) press(button);
    else enter(editableIn(input));
    const read = () => {
      const el = this.panelAnswer(root, before, question);
      const t = el ? toMarkdown(el, this.env.shown, { refs: false, cites: false }).text : '';
      return stillThinking(t) ? '' : t;
    };
    // Still writing while it offers Stop or shows a spinner.
    const working = () => !!this.named(HOOKS.stop, root) || this.busy(root);
    let answer: string;
    try {
      answer = await this.stream(read, working, 'answer in the Gemini panel');
    } catch (err) {
      if (!this.signal.aborted) this.env.diagnostic(`gemini panel added: ${this.panelOutline(root, before)}`);
      throw err;
    }
    // Its shape (never its text), so a layout change shows in the log.
    this.env.diagnostic(`gemini panel answered: ${this.panelOutline(root, before)}`);
    this.control.claim();
    // Its numbered sources all point at what Gmail shows.
    return { text: answer, sources: [] };
  }

  /** Help me write or Refine through the side panel, for accounts whose compose has no Help me write (Google AI plans). A "Subject:" line Gemini adds becomes the subject. */
  private async draftInPanel(question: string, threadId?: string): Promise<GeminiResult> {
    // So no half-made draft stays behind.
    await this.tidy();
    if (threadId) await this.openThread(threadId);
    else await this.leaveConversation();
    // Asked to write, Gemini can open its own compose window and only say "Done." in the panel. That window is this job's: its text is the draft, discarded after.
    const before = new Set(this.bodies());
    this.awaiting = before;
    const answer = (await this.askPanel(question)).text;
    const fresh = () => this.bodies().find((b) => !before.has(b) && this.env.shown(b) && !this.isUsersDraft(this.composeRoot(b))) ?? null;
    if (await this.wait(() => !!fresh(), PANEL_COMPOSE_MS)) {
      const body = fresh()!;
      this.opened.add(body);
      const root = this.composeRoot(body);
      const text = await this.stream(() => this.bodyText(body), () => this.busy(root), 'read the draft Gemini opened', '', false);
      const subject = root.querySelector<HTMLInputElement>(HOOKS.subject)?.value.trim();
      this.env.diagnostic('gemini: the side panel wrote its draft in a compose window; read it from there');
      return { kind: 'draft', text, ...(subject ? { subject } : {}) };
    }
    const draft = draftFrom(answer);
    if (HOOKS.panelDone.test(draft.text)) {
      throw new GmailPageError("Gemini said it was done but didn't show the draft. Try again.", 'read the draft');
    }
    return { kind: 'draft', ...draft };
  }

  /** As tags, roles, classes and text lengths, never the text. */
  private panelOutline(root: HTMLElement, before: Set<Element>): string {
    const added = [...root.querySelectorAll('*')].filter((el) => !before.has(el));
    const tops = added.filter((el) => !added.includes(el.parentElement as Element)).slice(0, 12);
    const busy = this.named(HOOKS.stop, root) ? 'Stop shown' : 'no Stop';
    if (!tops.length) return `nothing new (${busy}); panel text ${spaced(text(root)).length} chars`;
    return `${busy}; ${tops.map((el) => `${describe(el)}${this.env.shown(el) ? '' : ' (hidden)'} ${spaced(text(el)).length}ch [${[...el.querySelectorAll('*')].slice(0, 6).map(describe).join(' ')}]`).join(' | ')}`;
  }

  /** The largest block the panel added that isn't the question (Gemini repeats it above the answer). */
  private panelAnswer(root: HTMLElement, before: Set<Element>, question: string): HTMLElement | null {
    const asked = spaced(question);
    const start = asked.slice(0, 30);
    const added = [...root.querySelectorAll<HTMLElement>('*')].filter((el) => !before.has(el) && !el.matches(HOOKS.panelInput) && !el.closest(HOOKS.panelInput) && this.env.shown(el));
    // The question as the panel repeats it: a block holding its start and little more. Refine quotes the message and an answer can repeat it, so not every text the question holds is left out.
    const echoes = added.filter((el) => {
      const t = spaced(text(el));
      return t.includes(start) && t.length <= asked.length + 12;
    });
    let best: HTMLElement | null = null;
    let most = 0;
    for (const el of added) {
      const t = spaced(text(el));
      if (!t || t.includes(start) || echoes.some((e) => e.contains(el))) continue;
      if (t.length > most) {
        best = el;
        most = t.length;
      }
    }
    // Gmail lists the chat's turns: an answer that is one list item is the turn, not a bullet.
    for (let only = best?.firstElementChild; best && best.children.length === 1 && only && spaced(text(only)) === spaced(text(best)) && !best.matches('li, [role="listitem"]'); only = best.firstElementChild) {
      best = only as HTMLElement;
    }
    return best;
  }

  /** By its legacy hex id or, for "thread-a:" ids, Gmail's URL id. */
  private async openThread(threadId: string): Promise<void> {
    const id = normalizeThreadId(threadId);
    if (!id) throw new BackendError(`"${threadId}" is not a Gmail conversation id.`, 'not-found');
    const hex = toLegacyHexId(id);
    const headersBefore = new Set(this.shownAll(HOOKS.threadHeader));
    this.control.navigate(`#all/${hex ?? threadUrlId(id)}`);
    await this.until(() => {
      for (const el of this.shownAll<HTMLElement>('[data-thread-perm-id], [data-legacy-thread-id]')) {
        const perm = el.getAttribute('data-thread-perm-id');
        if (perm === id || (hex && el.getAttribute('data-legacy-thread-id') === hex)) return true;
      }
      return this.shownAll(HOOKS.threadHeader).some((h) => !headersBefore.has(h));
    }, 'open the conversation');
  }

  private async summarize(threadId: string): Promise<GeminiResult> {
    await this.openThread(threadId);
    const card = () => this.shownAll<HTMLElement>(HOOKS.summaryCard)[0] ?? null;
    await this.wait(() => !!card() || !!this.named(HOOKS.summarize), OFFER_WAIT_MS);
    if (!card()) {
      const ask = this.named(HOOKS.summarize);
      // No summary chip here (Google AI plans show none): the side panel summarizes instead.
      if (!ask && this.hasPanel()) return { kind: 'answer', ...(await this.askPanel('Summarize this email')) };
      if (!ask) throw new JobMissing("Gmail didn't offer a summary for this conversation. It summarizes longer conversations, and only when Gemini is part of this account's plan.", []);
      press(ask);
    }
    await this.until(card, 'show the summary', this.env.answerTimeoutMs);
    const read = () => {
      const c = card();
      const t = c ? toMarkdown(c, this.env.shown).text : '';
      return stillThinking(t) ? '' : t;
    };
    const summary = await this.stream(read, () => this.busy(card()), 'finish the summary');
    return { kind: 'answer', text: summary, sources: [] };
  }

  private async replies(threadId: string): Promise<GeminiResult> {
    await this.openThread(threadId);
    const chips = () => {
      const found: HTMLElement[] = [];
      for (const hook of this.shownAll<HTMLElement>(HOOKS.replies)) {
        const inner = [...hook.querySelectorAll<HTMLElement>('[role="button"], button')].filter((el) => this.env.shown(el) && text(el));
        found.push(...(inner.length ? inner : [hook]));
      }
      return innermost(found.filter((el) => text(el)));
    };
    if (!(await this.wait(() => chips().length > 0, this.env.stepTimeoutMs))) {
      throw new JobMissing("Gmail didn't suggest replies for this conversation. Gemini suggests them for some conversations only.", []);
    }
    const read = () => chips().map((c) => text(c)).join('\n');
    await this.stream(read, () => false, 'suggest replies', '', false);
    const replies: { label: string; text: string }[] = [];
    for (const chip of chips()) {
      const label = spaced(text(chip));
      const full = spaced(chip.getAttribute('data-reply-text') ?? chip.getAttribute('title') ?? chip.getAttribute('aria-label') ?? '');
      if (!label || replies.some((r) => r.label === label)) continue;
      replies.push({ label, text: full.length > label.length ? full : label });
    }
    return { kind: 'replies', replies };
  }

  private bodies(): HTMLElement[] {
    return [...this.doc.querySelectorAll<HTMLElement>(HOOKS.body)];
  }

  /** A new message, or a reply in the conversation when `threadId` is set. */
  private async openCompose(threadId?: string): Promise<Compose> {
    let before: Set<HTMLElement>;
    if (threadId) {
      await this.openThread(threadId);
      // Taken after the conversation opened: a draft reply it shows is the user's.
      const reply = await this.until(() => this.shownAll<HTMLElement>(HOOKS.replyClass)[0] ?? this.named(HOOKS.reply), 'find Reply');
      before = new Set(this.bodies());
      press(reply);
    } else {
      before = new Set(this.bodies());
      this.control.navigate('#inbox?compose=new');
    }
    this.awaiting = before;
    const body = await this.until(() => this.bodies().find((b) => !before.has(b) && this.env.shown(b)) ?? null, threadId ? 'open a reply' : 'open a new message');
    this.awaiting = undefined;
    const root = this.composeRoot(body);
    // Reply can bring up the user's saved draft; writing into it would change their words.
    if (this.isUsersDraft(root)) {
      throw new BackendError('This conversation already has a draft reply in Gmail. Send or discard it, then try again.', 'unsupported');
    }
    this.opened.add(body);
    return { body, root };
  }

  private isUsersDraft(root: Element): boolean {
    const id = root.querySelector<HTMLInputElement>(HOOKS.draftField)?.value;
    return !!id && this.usersDrafts.has(draftKey(id));
  }

  private composeRoot(body: HTMLElement): HTMLElement {
    let fallback: HTMLElement = body.parentElement ?? body;
    for (let el = body.parentElement, up = 0; el && el !== this.doc.body && up < 14; el = el.parentElement, up++) {
      if (el.querySelector(HOOKS.draftField) || el.matches('[role="dialog"]')) return el;
      if (up < 6 && el.matches(HOOKS.composeRoot)) fallback = el;
    }
    return fallback;
  }

  /** Null where the side panel can write instead. */
  private async helpMeWrite(compose: Compose): Promise<HTMLElement | null> {
    const find = () => [...compose.root.querySelectorAll<HTMLElement>(HOOKS.helpMeWrite)].find((el) => this.env.shown(el)) ?? null;
    const found = await this.wait(() => !!find(), MENU_WAIT_MS);
    this.env.hints.helpMeWriteMisses = found ? 0 : (this.env.hints.helpMeWriteMisses ?? 0) + 1;
    if (found) return find()!;
    if (!this.hasPanel()) throw new JobMissing(NO_HELP_ME_WRITE, ['write', 'refine']);
    this.env.diagnostic(`gemini: no Help me write in compose, writing in the side panel\n${this.outline()}`);
    return null;
  }

  private panelWrites(): boolean {
    return (this.env.hints.helpMeWriteMisses ?? 0) >= 2 && this.hasPanel();
  }

  private async write(request: Extract<GeminiRequest, { kind: 'write' }>): Promise<GeminiResult> {
    const question = writeQuestion(request.prompt, !!request.threadId);
    if (this.panelWrites()) return await this.draftInPanel(question, request.threadId);
    const compose = await this.openCompose(request.threadId);
    // Recipients stay empty: Gmail autosaves this window, and a draft addressed to real people must never linger.
    if (!request.threadId) {
      const subject = compose.root.querySelector<HTMLInputElement>(HOOKS.subject);
      if (subject && request.subject) fill(subject, request.subject);
    }
    const baseline = this.bodyText(compose.body);
    const button = await this.helpMeWrite(compose);
    if (!button) return await this.draftInPanel(question, request.threadId);
    press(button);
    const popup = await this.until(() => this.popup(compose), 'open Help me write');
    const input = await this.until(() => [...popup.querySelectorAll<HTMLElement>(HOOKS.promptInput)].find((el) => this.env.shown(el)) ?? null, 'find the Help me write prompt');
    fill(input, request.prompt);
    press(await this.until(() => enabled(this.named(HOOKS.create, popup) ?? this.named(HOOKS.create)), 'find Create'));
    const draft = await this.stream(() => this.written(compose, popup, baseline), () => this.busy(popup) || this.busy(compose.root), 'write a draft', baseline);
    const subjectNow = compose.root.querySelector<HTMLInputElement>(HOOKS.subject)?.value.trim();
    return { kind: 'draft', text: draft, ...(!request.threadId && !request.subject && subjectNow ? { subject: subjectNow } : {}) };
  }

  private async refine(original: string, mode: RefineMode, threadId?: string): Promise<GeminiResult> {
    if (this.panelWrites()) return await this.draftInPanel(panelRefine(original, mode));
    const compose = await this.openCompose(threadId);
    setBody(compose.body, original);
    const baseline = this.bodyText(compose.body);
    const button = await this.helpMeWrite(compose);
    if (!button) return await this.draftInPanel(panelRefine(original, mode));
    selectAll(this.doc, compose.body);
    press(button);
    const name = HOOKS.refineModes[mode];
    const choice = () => this.named(name, undefined, '[role="menuitem"], [role="option"], [role="button"], button');
    if (!(await this.wait(() => !!choice(), MENU_WAIT_MS))) {
      const refine = this.named(HOOKS.refine);
      if (refine) press(refine);
    }
    press(await this.until(choice, `find ${mode[0]!.toUpperCase()}${mode.slice(1)}`));
    const popup = this.popup(compose);
    const draft = await this.stream(() => this.written(compose, popup, baseline), () => this.busy(popup) || this.busy(compose.root), 'refine the text', baseline);
    return { kind: 'draft', text: draft };
  }

  private async proofread(original: string): Promise<GeminiResult> {
    const compose = await this.openCompose();
    setBody(compose.body, original);
    const baseline = this.bodyText(compose.body);
    const control = await this.menuControl(compose, HOOKS.proofread);
    if (!control) throw new JobMissing("Gmail didn't show Proofread. It comes with some Google Workspace and Google AI plans, in English.", ['proofread']);
    press(control);
    const scope = () => [compose.root, ...this.newDialogs()];
    const state = await this.until(
      () => this.namedIn(scope(), HOOKS.acceptAll) ?? this.namedIn(scope(), HOOKS.accept) ?? (this.says(scope(), HOOKS.noSuggestions) ? 'none' : null),
      'check the text',
      this.env.answerTimeoutMs,
    );
    if (state === 'none') return { kind: 'proofread', fixes: [] };
    for (let i = 0; i < MAX_ACCEPTS; i++) {
      this.check();
      const all = this.namedIn(scope(), HOOKS.acceptAll);
      const one = all ?? this.namedIn(scope(), HOOKS.accept);
      if (!one) break;
      press(one);
      // Gmail moves to its next suggestion a beat after each one is taken.
      await this.wait(() => !one.isConnected || !this.env.shown(one), MENU_WAIT_MS);
      if (all) break;
    }
    const changed = await this.wait(() => !sameText(this.bodyText(compose.body), baseline), this.env.stepTimeoutMs);
    if (!changed) return { kind: 'proofread', fixes: [] };
    const revised = await this.stream(() => this.bodyText(compose.body), () => this.busy(compose.root), 'apply the suggestions', baseline, false);
    return { kind: 'proofread', fixes: diffFixes(original, revised) };
  }

  private async schedule(threadId?: string, durationMinutes?: number): Promise<GeminiResult> {
    const compose = await this.openCompose(threadId);
    const baseline = this.bodyText(compose.body);
    const control = await this.menuControl(compose, HOOKS.helpMeSchedule);
    if (!control) throw new JobMissing("Gmail didn't show Help me schedule. It's for Google Workspace accounts with Gmail in English (US).", ['schedule']);
    press(control);
    const insert = await this.until(() => enabled(this.namedIn(this.newDialogs(), HOOKS.insertTimes) ?? this.named(HOOKS.insertTimes, compose.root)), 'suggest times', this.env.answerTimeoutMs);
    if (durationMinutes) await this.pickDuration(durationMinutes);
    press(enabled(insert.isConnected ? insert : this.named(HOOKS.insertTimes)) ?? insert);
    const body = await this.stream(() => this.bodyText(compose.body), () => this.busy(compose.root), 'write the times into the message', baseline);
    return { kind: 'draft', text: withoutBaseline(body, baseline) };
  }

  /** Best effort. */
  private async pickDuration(minutes: number) {
    const names = durationNames(minutes);
    const option = () =>
      this.newDialogs()
        .flatMap((d) => [...d.querySelectorAll<HTMLElement>('[role="option"], [role="menuitemradio"], [role="radio"], [role="menuitem"], option')])
        .find((el) => this.env.shown(el) && names.some((n) => n.test(text(el)))) ?? null;
    if (!option()) {
      const box = this.newDialogs().flatMap((d) => [...d.querySelectorAll<HTMLElement>('[role="combobox"], [aria-haspopup="listbox"]')]).find((el) => this.env.shown(el));
      if (box) press(box);
    }
    const found = (await this.wait(() => !!option(), MENU_WAIT_MS)) ? option() : null;
    if (found) press(found);
    else this.env.diagnostic(`gemini: Help me schedule has no ${minutes} minute choice`);
  }

  /** On the compose window, else under its More options menu. */
  private async menuControl(compose: Compose, name: RegExp): Promise<HTMLElement | null> {
    const find = () => this.named(name, compose.root) ?? this.namedIn(this.newDialogs(), name, '[role="menuitem"], [role="menuitemcheckbox"], [role="button"], button');
    if (await this.wait(() => !!find(), MENU_WAIT_MS / 3)) return find();
    const more = this.named(HOOKS.moreOptions, compose.root);
    if (!more) return null;
    press(more);
    return (await this.wait(() => !!find(), MENU_WAIT_MS)) ? find() : null;
  }

  /** By its hook, or a dialog that opened for it with a place to type. */
  private popup(compose: Compose): HTMLElement | null {
    const hooked = this.shownAll<HTMLElement>(HOOKS.writePrompt).find((el) => el.querySelector(HOOKS.promptInput) || compose.root.contains(el));
    if (hooked) return hooked;
    return this.newDialogs().find((d) => !d.contains(compose.body) && [...d.querySelectorAll(HOOKS.promptInput)].some((el) => this.env.shown(el))) ?? null;
  }

  /** The body once it changed, else what the popup shows as it writes. */
  private written(compose: Compose, popup: HTMLElement | null, baseline: string): string {
    const body = this.bodyText(compose.body);
    if (!sameText(body, baseline)) return withoutBaseline(body, baseline);
    if (!popup?.isConnected) return '';
    const live = [...popup.querySelectorAll<HTMLElement>(HOOKS.liveRegion)].filter((el) => this.env.shown(el));
    return innermost(live)
      .map((el) => toMarkdown(el, this.env.shown).text)
      .filter(Boolean)
      .join('\n\n');
  }

  private bodyText(body: HTMLElement): string {
    return body.isConnected ? toMarkdown(body, () => true, { refs: false, skip: HOOKS.notWritten }).text : '';
  }

  /** Otherwise the same question asked of Ask Gmail. */
  private async briefing(): Promise<GeminiResult> {
    const hook = this.shownAll<HTMLElement>(HOOKS.aiInbox)[0] ?? this.doc.querySelector<HTMLElement>(HOOKS.aiInbox);
    if (hook) {
      const before = JSON.stringify(this.readBriefing());
      press(hook.closest<HTMLElement>(HOOKS.clickable) ?? hook);
      const read = () => {
        const b = this.readBriefing();
        return b.todos.length || b.topics.length ? JSON.stringify(b) : '';
      };
      await this.until(() => read() && read() !== before, 'open AI Inbox', this.env.answerTimeoutMs);
      await this.stream(read, () => this.busy(this.mainView()), 'finish AI Inbox', '', false);
      return { kind: 'briefing', ...this.readBriefing() };
    }
    if (!this.searchBoxes().some(isAskGmail)) throw new JobMissing("Gmail here has neither AI Inbox nor Ask Gmail, so there's no briefing for this account.", ['inbox']);
    return { kind: 'briefing', ...briefingFromAnswer(await this.ask(BRIEFING_QUESTION)) };
  }

  private mainView(): HTMLElement | null {
    return this.shownAll<HTMLElement>('[role="main"]')[0] ?? null;
  }

  /** Each heading owns the conversation rows after it, up to the next heading. */
  private readBriefing(): { todos: BriefingTodo[]; topics: BriefingTopic[] } {
    const main = this.mainView();
    const todos: BriefingTodo[] = [];
    const topics: BriefingTopic[] = [];
    if (!main) return { todos, topics };
    const headings = [...main.querySelectorAll<HTMLElement>(HOOKS.headings)].filter((h) => this.env.shown(h) && text(h));
    if (!headings.length) return { todos, topics };
    const rows = new Map<HTMLElement, string>();
    for (const el of main.querySelectorAll<HTMLElement>(HOOKS.threadRef)) {
      const id = threadRefOf(el);
      if (!id || !this.env.shown(el)) continue;
      const row = el.closest<HTMLElement>(HOOKS.rows) ?? el;
      if (main.contains(row) && !rows.has(row)) rows.set(row, id);
    }
    for (const [i, heading] of headings.entries()) {
      const next = headings[i + 1];
      const mine = [...rows].filter(([row]) => follows(heading, row) && (!next || follows(row, next)));
      if (!mine.length) continue;
      const title = spaced(text(heading));
      if (HOOKS.todoHeading.test(title)) {
        for (const [row, threadId] of mine) {
          const line = spaced(toMarkdown(row, this.env.shown, { refs: false }).text.replace(/\n+/g, ' '));
          if (line) todos.push({ text: line, threadId, ...dueOf(row) });
        }
      } else {
        const blurb = heading.nextElementSibling;
        const summary = blurb && !blurb.querySelector(HOOKS.threadRef) && ![...rows.keys()].some((r) => blurb.contains(r)) ? spaced(text(blurb)) : '';
        topics.push({ title, summary, threadIds: [...new Set(mine.map(([, id]) => id))] });
      }
    }
    return { todos, topics };
  }

  private searchBoxes(): HTMLInputElement[] {
    return [...this.doc.querySelectorAll<HTMLInputElement>(HOOKS.searchBox)];
  }

  private shownAll<T extends Element = Element>(selector: string): T[] {
    return [...this.doc.querySelectorAll<T>(selector)].filter((el) => this.env.shown(el));
  }

  private newDialogs(): HTMLElement[] {
    return this.shownAll<HTMLElement>(`${HOOKS.dialogs}, ${HOOKS.writePrompt}`).filter((d) => !this.dialogsBefore.has(d));
  }

  /** Within `root` when given. */
  private named(name: RegExp, root?: Element | null, selector: string = HOOKS.clickable): HTMLElement | null {
    if (root === null) return null;
    for (const el of (root ?? this.doc).querySelectorAll<HTMLElement>(selector)) {
      const label = (el.getAttribute('aria-label') ?? el.getAttribute('data-tooltip') ?? '').trim();
      if ((name.test(label) || name.test(text(el))) && this.env.shown(el)) return el;
    }
    return null;
  }

  private namedIn(roots: Element[], name: RegExp, selector?: string): HTMLElement | null {
    for (const root of roots) {
      const found = this.named(name, root, selector);
      if (found) return found;
    }
    return null;
  }

  private says(roots: Element[], words: RegExp): boolean {
    return roots.some((r) => this.env.shown(r) && words.test(text(r)));
  }

  private busy(root: Element | null): boolean {
    if (!root) return false;
    if (root.matches(HOOKS.loading)) return true;
    return [...root.querySelectorAll(HOOKS.loading)].some((el) => this.env.shown(el));
  }

  private check() {
    if (this.signal.aborted) throw stoppedError();
  }

  /** Like until, for something that may never happen. */
  private async wait(check: () => boolean, ms: number): Promise<boolean> {
    const deadline = Math.min(this.env.now() + ms, this.budgetEnd);
    for (;;) {
      this.check();
      if (check()) return true;
      if (this.env.now() >= deadline) return false;
      await this.env.sleep(POLL_MS);
    }
  }

  private async until<T>(check: () => T | null | undefined | false | '', step: string, ms = this.env.stepTimeoutMs): Promise<T> {
    const deadline = Math.min(this.env.now() + ms, this.budgetEnd);
    for (;;) {
      this.check();
      const value = check();
      if (value) return value;
      if (this.env.now() >= deadline) throw new GmailPageError(`Gmail's page didn't respond in time (couldn't ${step}).`, step);
      await this.env.sleep(POLL_MS);
    }
  }

  /** Passes text on each time it grows, until it hasn't changed for the settle time and Gmail shows no loading state. Text equal to `ignore` (what was there before) counts as nothing yet. */
  private async stream(read: () => string, loading: () => boolean, step: string, ignore = '', emit = true): Promise<string> {
    const firstBy = Math.min(this.env.now() + this.env.answerTimeoutMs, this.budgetEnd);
    let last = '';
    let changedAt = this.env.now();
    let poke: () => void = noop;
    const observer = new MutationObserver(() => poke());
    observer.observe(this.doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    try {
      for (;;) {
        this.check();
        const raw = read().trim();
        const value = sameText(raw, ignore) ? '' : raw;
        if (value !== last) {
          last = value;
          changedAt = this.env.now();
          if (value && emit) this.onText(value);
        }
        if (last && this.env.now() - changedAt >= this.env.settleMs && !loading()) return last;
        if (!last && this.env.now() >= firstBy) throw new GmailPageError(`Gmail's page didn't respond in time (couldn't ${step}).`, step);
        // Out of time with an answer still moving: keep what came.
        if (last && this.env.now() >= this.budgetEnd) return last;
        // A change on the page wakes this early; the poll covers text Gmail swaps without a mutation we see.
        await Promise.race([this.env.sleep(POLL_MS), new Promise<void>((r) => (poke = r))]);
      }
    } finally {
      observer.disconnect();
    }
  }

  /** Closes popups this opened and discards every compose window it opened, whether the job finished, failed or was stopped. */
  private async tidy() {
    for (const d of this.newDialogs()) {
      if (this.bodies().some((b) => d.contains(b))) continue;
      d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    }
    for (const body of this.bodies()) {
      if (!body.isConnected) continue;
      const root = this.composeRoot(body);
      // A compose that came too late is this job's too.
      const late = !!this.awaiting && !this.awaiting.has(body);
      if ((!this.opened.has(body) && !late) || this.isUsersDraft(root)) continue;
      const discard =
        [...root.querySelectorAll<HTMLElement>('[role="button"], button')].find((el) => HOOKS.discard.test((el.getAttribute('aria-label') ?? el.getAttribute('data-tooltip') ?? '').trim())) ??
        root.querySelector<HTMLElement>(HOOKS.discardClass);
      if (!discard) {
        this.env.diagnostic("gemini: couldn't find Discard draft on a compose window it opened");
        continue;
      }
      press(discard);
      const deadline = this.env.now() + DISCARD_WAIT_MS;
      while (body.isConnected && this.env.shown(body) && this.env.now() < deadline) await this.env.sleep(POLL_MS);
      if (body.isConnected && this.env.shown(body)) this.env.diagnostic('gemini: Gmail kept a compose window open after Discard draft');
    }
  }
}

/** A draft's id however Gmail writes it: "#msg-a:r-123", "msg-a:r-123" or "r-123". */
function draftKey(id: string): string {
  return id.trim().replace(/^#/, '').replace(/^msg-a:/, '');
}

// Reading answers ----------------------------------------------------------------

/** Gmail's data attributes, then a link's address. */
export function threadRefOf(el: Element): string | undefined {
  const synced = el.getAttribute('data-thread-id') ?? el.getAttribute('data-thread-perm-id');
  if (synced) {
    const id = normalizeThreadId(synced.replace(/^#/, ''));
    if (id) return id;
  }
  const legacy = el.getAttribute('data-legacy-thread-id');
  if (legacy) {
    const id = fromLegacyHexId(legacy.replace(/^#/, ''), 'thread');
    if (id) return id;
  }
  const href = el.getAttribute('href');
  if (href?.includes('#')) {
    let last = href.slice(href.indexOf('#') + 1).split('?')[0]!.split('/').pop() ?? '';
    try {
      last = decodeURIComponent(last);
    } catch {
      // Leave it as written.
    }
    if (/^[0-9a-f]{12,16}$/i.test(last)) return fromLegacyHexId(last, 'thread');
    if (/^[A-Za-z]{16,}$/.test(last)) return fromThreadUrlId(last);
  }
  return undefined;
}

interface MarkdownOptions {
  /** Turn conversation links into `[n]` markers with sources. */
  refs?: boolean;
  skip?: string;
  /** False leaves out the source numbers the side panel puts after a sentence ("...advice. 1"). */
  cites?: boolean;
}

/** The small Markdown subset GeminiAnswer uses: paragraphs, `-` and `1.` lists, `**bold**`, and `[n]` where it points at a conversation. Buttons, hidden parts and Gmail's captions are left out. */
export function toMarkdown(root: Element, shown: (el: Element) => boolean, options: MarkdownOptions = {}): GeminiAnswer {
  const refs = options.refs ?? true;
  const sources: GeminiSource[] = [];
  const index = new Map<string, number>();
  let out = '';
  let inItem = 0;
  const breakBlock = () => {
    if (!out) return;
    out = out.replace(/[ \t]+$/, '');
    const want = inItem ? ' ' : '\n\n';
    if (inItem) {
      if (!/\s$/.test(out)) out += ' ';
    } else if (!out.endsWith(want)) out = out.replace(/\n*$/, want);
  };
  const walk = (node: Node, list?: { ordered: boolean; n: number }) => {
    if (node.nodeType === 3) {
      const raw = node.textContent ?? '';
      // Text laid out with its own line breaks (Gemini's draft cards) keeps them.
      out += keepsLines(node.parentElement) ? raw.replace(/[ \t\u00a0]+/g, ' ') : raw.replace(/[\s\u00a0]+/g, ' ');
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || el.getAttribute('aria-hidden') === 'true') return;
    if (el !== root && (!shown(el) || (options.skip && el.matches(options.skip)))) return;
    if (refs && el !== root && el.matches(HOOKS.threadRef)) {
      const id = threadRefOf(el);
      if (id) {
        let n = index.get(id);
        if (!n) {
          n = sources.push({ threadId: id, subject: subjectOf(el) });
          index.set(id, n);
        }
        out = out.replace(/[ \t]+$/, '');
        out += `${out && !/\s$/.test(out) ? ' ' : ''}[${n}]`;
        return;
      }
    }
    if (el !== root && el.matches(HOOKS.control)) return;
    if (options.cites === false && el !== root && el.matches(HOOKS.cite) && /^\[?\d{1,2}\]?$/.test(spaced(text(el)))) return;
    if (el !== root && HOOKS.answerLabel.test(text(el)) && !spaced(text(el)).replace(HOOKS.answerLabel, '')) return;
    const children = (l?: { ordered: boolean; n: number }) => el.childNodes.forEach((c) => walk(c, l));
    if (tag === 'BR') {
      out += inItem ? ' ' : '\n';
      return;
    }
    if (/^H[1-6]$/.test(tag) || el.getAttribute('role') === 'heading') {
      const words = spaced(text(el));
      if (!words || HOOKS.chromeText.test(words)) return;
      breakBlock();
      const start = out.length;
      children();
      out = out.slice(0, start) + bold(out.slice(start));
      breakBlock();
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      breakBlock();
      const l = { ordered: tag === 'OL', n: 0 };
      el.childNodes.forEach((c) => walk(c, l));
      out = out.replace(/[ \t]+$/, '');
      if (out && !out.endsWith('\n\n')) out = out.replace(/\n*$/, '\n\n');
      return;
    }
    if (el !== root && (tag === 'LI' || el.getAttribute('role') === 'listitem')) {
      out = out.replace(/[ \t]+$/, '');
      if (out && !out.endsWith('\n')) out += '\n';
      out += list?.ordered ? `${++list.n}. ` : '- ';
      inItem++;
      children();
      inItem--;
      out = out.replace(/[ \t]+$/, '') + '\n';
      return;
    }
    if (tag === 'B' || tag === 'STRONG') {
      const start = out.length;
      children(list);
      out = out.slice(0, start) + bold(out.slice(start));
      return;
    }
    const block = /^(P|DIV|SECTION|ARTICLE|BLOCKQUOTE|TABLE|TR|HEADER|FOOTER|MAIN|ASIDE|DL|DD|DT|FIGURE)$/.test(tag);
    if (block && el !== root) breakBlock();
    children(list);
    if (block && el !== root) breakBlock();
  };
  walk(root);
  const lines = out
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => !HOOKS.disclaimer.test(l) && !HOOKS.chromeText.test(l.replace(/\*\*/g, '')) && !(l && /^((-|\d+\.)\s*)?(\[\d+\]\s*)*$/.test(l)));
  const textOut = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(HOOKS.answerLabel, '');
  return { text: textOut, sources };
}

function keepsLines(el: Element | null): boolean {
  if (!el) return false;
  const ws = el.ownerDocument.defaultView?.getComputedStyle(el).whiteSpace ?? '';
  return /^pre|break-spaces/.test(ws);
}

function bold(inner: string): string {
  const words = inner.trim();
  if (!words) return inner;
  const lead = /^\s/.test(inner) ? ' ' : '';
  const trail = /\s$/.test(inner) ? ' ' : '';
  return `${lead}**${words}**${trail}`;
}

/** Gmail's attributes, or the link's words when they're more than a number. */
function subjectOf(el: HTMLElement): string {
  const own = el.getAttribute('data-subject') ?? el.getAttribute('title') ?? el.getAttribute('aria-label');
  if (own?.trim()) return spaced(own);
  const words = spaced(text(el));
  return /^\[?\d+\]?$/.test(words) ? '' : words;
}

/** "Due Oct 21" or "by Friday, Oct 24" on an AI Inbox to-do, when Gmail writes a date. */
function dueOf(row: Element): { due?: number } {
  const m = /\b(?:due|by)\s+(?:\w+day,?\s+)?([A-Z][a-z]{2,8}\.? \d{1,2}(?:,? \d{4})?)/.exec(text(row));
  if (!m) return {};
  const year = /\d{4}/.test(m[1]!) ? '' : ` ${new Date().getFullYear()}`;
  const due = Date.parse(`${m[1]!.replace('.', '')}${year}`);
  return Number.isNaN(due) ? {} : { due };
}

/** Each listed point with a source becomes a to-do. */
function briefingFromAnswer(answer: GeminiAnswer): { todos: BriefingTodo[]; topics: BriefingTopic[] } {
  const todos: BriefingTodo[] = [];
  for (const line of answer.text.split('\n')) {
    const item = /^(?:-|\d+\.)\s+(.*)$/.exec(line.trim());
    if (!item) continue;
    const marks = [...item[1]!.matchAll(/\[(\d+)\]/g)].map((m) => answer.sources[Number(m[1]) - 1]).filter((s): s is GeminiSource => !!s);
    const words = spaced(item[1]!.replace(/\s*\[\d+\]/g, ''));
    if (marks[0] && words) todos.push({ text: words, threadId: marks[0].threadId });
  }
  if (todos.length || !answer.sources.length) return { todos, topics: [] };
  const summary = spaced(answer.text.replace(/\s*\[\d+\]/g, '').replace(/\*\*/g, ''));
  return { todos, topics: [{ title: 'Recent mail', summary, threadIds: answer.sources.map((s) => s.threadId) }] };
}

/** The last thing asked, about the open conversation when there is one, with earlier turns folded in while the whole stays short. */
export function chatQuestion(turns: GeminiTurn[], subject?: string): string {
  const lastAt = turns.map((t) => t.role).lastIndexOf('user');
  const asked = lastAt >= 0 ? spaced(turns[lastAt]!.text) : '';
  if (!asked) throw new BackendError('Ask Gemini something first.', 'unsupported');
  const about = subject?.trim() ? `About the email "${clip(spaced(subject), 120)}": ${asked}` : asked;
  const earlier = turns
    .slice(0, lastAt)
    .slice(-2)
    .map((t) => `${t.role === 'user' ? 'I asked' : 'You said'}: ${clip(spaced(t.text), 140)}`);
  const folded = earlier.length ? `${earlier.join(' ')} Now: ${about}` : about;
  return folded.length <= MAX_QUESTION ? folded : clip(about, MAX_QUESTION);
}

/** Just the draft back, so it can go straight into the message. */
function writeQuestion(prompt: string, reply: boolean): string {
  const asked = clip(spaced(prompt), MAX_QUESTION);
  // "Show it here" keeps Gemini from opening or saving a draft of its own.
  return reply
    ? `Suggest the text of my reply to this email: ${asked}. Show it here in the chat without opening or saving a draft: only the reply's body, with no subject line and no notes before or after it.`
    : `Suggest the text of an email: ${asked}. Show it here in the chat without opening or saving a draft: a "Subject:" line, then the body, with no notes before or after it.`;
}

const REFINE_ASKS: Record<RefineMode, string> = {
  polish: 'Polish',
  formalize: 'Make more formal',
  elaborate: 'Expand on',
  shorten: 'Shorten',
  rephrase: 'Rephrase',
};

/** On one line: a line break in the panel's box can send it early. */
function refineQuestion(original: string, mode: RefineMode): string {
  return `${REFINE_ASKS[mode]} this email text, keeping what it says. Answer with only the new text, with no notes before or after it: "${clip(spaced(original), MAX_REFINE)}"`;
}

/** Refused rather than cut short: Replace would drop the rest of the message. */
function panelRefine(original: string, mode: RefineMode): string {
  if (spaced(original).length > MAX_REFINE) {
    throw new GmailPageError('This message is too long for Gemini to refine. Try it on a shorter message.', 'refine');
  }
  return refineQuestion(original, mode);
}

/** Plain text, without the intro line, Markdown bold or an offer to change it, and with a "Subject:" line taken out as the subject. */
export function draftFrom(answer: string): { text: string; subject?: string } {
  const plain = answer.replace(/\*\*/g, '').replace(/^\s*(-|\d+\.)\s+/, '');
  const card = fromCard(plain);
  if (card) return card;
  // "Subject: …" run into the body on one line: the subject ends where the greeting starts.
  const run = /^\s*subject:\s*([^\n]*?)\s+((?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^\n]*)$/i.exec(plain);
  if (run) return { subject: run[1]!.trim(), text: reflow(run[2]!.trim()) };
  const lines = plain.split('\n');
  const first = () => lines.findIndex((l) => l.trim());
  if (lines.filter((l) => l.trim()).length > 1 && /^(here('s| is| are)|sure|okay|ok|certainly|of course)\b.*:$/i.test(lines[first()]!.trim())) lines.splice(first(), 1);
  let subject: string | undefined;
  const at = first();
  const line = at >= 0 ? /^subject:\s*(.+)$/i.exec(lines[at]!.trim()) : null;
  if (line) {
    subject = line[1]!.trim();
    lines.splice(at, 1);
  }
  const paragraphs = lines.join('\n').replace(/^\s*body:\s*/i, '').split(/\n{2,}/);
  if (paragraphs.length > 1 && /^(let me know|feel free|i hope this|would you like|want me to)\b/i.test(paragraphs.at(-1)!.trim())) paragraphs.pop();
  const text = paragraphs.join('\n\n').trim();
  return subject ? { text, subject } : { text };
}

/** Gemini's draft card ("To:", "Subject:", "Body:"), which can come through on one line. Recipients are left out (the person picks them). */
function fromCard(answer: string): { text: string; subject?: string } | null {
  const t = answer.replace(/^\s*(-|\d+\.)\s+/gm, '');
  const at = t.search(/(^|\s)Body:\s*/);
  if (at < 0) return null;
  const subject = /(?:^|\s)Subject:\s*([\s\S]*?)(?=\s+(?:To|Cc|Bcc|Body):|\n|$)/.exec(t.slice(0, at))?.[1]?.trim();
  const body = reflow(t.slice(at).replace(/^\s*Body:\s*/, '').trim());
  return subject ? { text: body, subject } : { text: body };
}

const GREETING = /^((?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^,!.\n]{0,40}[,!])\s+/i;

/** A body that came through on one line gets its greeting and sign-off back on lines of their own. */
function reflow(body: string): string {
  if (body.includes('\n')) return body;
  return body
    .replace(GREETING, '$1\n\n')
    .replace(/\s+((?:best|thanks|thank you|cheers|regards|best regards|kind regards|warm regards|sincerely|warmly|talk soon|love),)\s+(\S[^\n]{0,40})$/i, '\n\n$1\n$2');
}

/** A word-level diff, so whitespace Gmail rewrites on its own isn't a fix. */
export function diffFixes(original: string, revised: string): ProofreadFix[] {
  const a = tokens(original);
  const b = tokens(revised).map((t) => t.text);
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) return sameText(original, revised) ? [] : [{ start: 0, end: original.length, replacement: revised, kind: 'Clarity' }];
  // lcs[i][j]: common words of a[i..] and b[j..].
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] = a[i]!.text === b[j] ? lcs[at(i + 1, j + 1)]! + 1 : Math.max(lcs[at(i + 1, j)]!, lcs[at(i, j + 1)]!);
    }
  }
  const fixes: ProofreadFix[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i]!.text === b[j]) {
      i++;
      j++;
      continue;
    }
    const i0 = i;
    const j0 = j;
    while ((i < n || j < m) && !(i < n && j < m && a[i]!.text === b[j])) {
      if (j < m && (i >= n || lcs[at(i, j + 1)]! >= lcs[at(i + 1, j)]!)) j++;
      else i++;
    }
    const removed = a.slice(i0, i);
    const added = b.slice(j0, j);
    if (removed.length) {
      const fromPrev = !added.length && i0 > 0;
      const start = fromPrev ? a[i0 - 1]!.end : removed[0]!.start;
      const end = !added.length && !fromPrev ? (a[i]?.start ?? removed.at(-1)!.end) : removed.at(-1)!.end;
      fixes.push({ start, end, replacement: added.join(' '), kind: fixKind(removed.map((t) => t.text), added) });
    } else {
      const pos = i0 > 0 ? a[i0 - 1]!.end : (a[0]?.start ?? 0);
      fixes.push({ start: pos, end: pos, replacement: i0 > 0 ? ` ${added.join(' ')}` : `${added.join(' ')} `, kind: fixKind([], added) });
    }
  }
  return fixes;
}

function fixKind(removed: string[], added: string[]): string {
  const letters = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (removed.length === 1 && added.length === 1) {
    if (letters(removed[0]!) === letters(added[0]!)) return removed[0]!.toLowerCase() === added[0]!.toLowerCase() ? 'Capitalization' : 'Punctuation';
    return 'Spelling';
  }
  return removed.length + added.length <= 4 ? 'Grammar' : 'Clarity';
}

function tokens(s: string): { text: string; start: number; end: number }[] {
  return [...s.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
}

function durationNames(minutes: number): RegExp[] {
  const out = [new RegExp(`^${minutes}\\s*(min|mins|minutes)$`, 'i')];
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    out.push(new RegExp(`^${h}\\s*(hr|hrs|hour|hours)$`, 'i'));
  }
  if (minutes === 90) out.push(/^1\.5\s*hours?$/i);
  return out;
}

function needsEnglish(lang: string): string {
  return `Gemini here needs Gmail in English, and Gmail is set to "${lang}". Change Gmail's language in Settings > General, or use Gemini in classic Gmail.`;
}

function isAskGmail(box: HTMLInputElement): boolean {
  return HOOKS.askGmail.test((box.getAttribute('placeholder') ?? box.getAttribute('aria-label') ?? '').trim());
}

/** The way a person would, so Gmail's handlers run. */
function fill(el: HTMLElement, value: string) {
  el.focus?.();
  el.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const field = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
  } else {
    el.textContent = value;
  }
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** One block per line, as Gmail writes it. */
function setBody(body: HTMLElement, value: string) {
  const doc = body.ownerDocument;
  body.focus?.();
  body.replaceChildren(
    ...value.split('\n').map((line) => {
      const div = doc.createElement('div');
      if (line) div.textContent = line;
      else div.append(doc.createElement('br'));
      return div;
    }),
  );
  body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
}

/** Refine works on the selection. */
function selectAll(doc: Document, body: HTMLElement) {
  const selection = doc.getSelection?.();
  if (!selection) return;
  const range = doc.createRange();
  range.selectNodeContents(body);
  selection.removeAllRanges();
  selection.addRange(range);
  doc.dispatchEvent(new Event('selectionchange'));
  body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

/** It can be a wrapper around the editable part. */
function editableIn(box: HTMLElement): HTMLElement {
  return box.isContentEditable ? box : (box.querySelector<HTMLElement>('[contenteditable="true"], [contenteditable="plaintext-only"], textarea, input') ?? box);
}

function selectBox(el: HTMLElement) {
  el.focus?.();
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    (el as HTMLInputElement).select();
    return;
  }
  const selection = el.ownerDocument.getSelection();
  if (!selection) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Ways to get text into a rich editor so its model sees it, not just its DOM: the editing command, then the input events editors listen for, then a paste. */
const ENTRY_WAYS: { name: string; enter: (box: HTMLElement, value: string) => void }[] = [
  {
    name: 'typing',
    enter: (box, value) => {
      const el = editableIn(box);
      selectBox(el);
      if (!el.ownerDocument.execCommand?.('insertText', false, value)) fill(el, value);
    },
  },
  {
    name: 'input events',
    enter: (box, value) => {
      const el = editableIn(box);
      selectBox(el);
      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
      if (spaced(text(el)) !== spaced(value) && !('value' in el && (el as HTMLInputElement).value === value)) fill(el, value);
      else el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: value.at(-1) ?? 'a', bubbles: true }));
    },
  },
  {
    name: 'a paste',
    enter: (box, value) => {
      const el = editableIn(box);
      selectBox(el);
      const data = new DataTransfer();
      data.setData('text/plain', value);
      el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    },
  },
];

/** Enter, for a box that sends on Enter and offers no send button. */
function enter(el: HTMLElement) {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  }
}

/** Gmail's controls listen for the whole press, not just click. */
function press(el: HTMLElement) {
  const box = el.getBoundingClientRect?.();
  const at = box ? { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 } : {};
  const view = el.ownerDocument.defaultView;
  for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, view, ...at }));
  }
}

function enabled(el: HTMLElement | null): HTMLElement | null {
  if (!el || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null;
  return el;
}

function follows(a: Node, b: Node): boolean {
  return !!(a.compareDocumentPosition(b) & 4);
}

function innermost(els: HTMLElement[]): HTMLElement[] {
  return els.filter((el) => !els.some((other) => other !== el && el.contains(other)));
}

function withoutBaseline(body: string, baseline: string): string {
  const base = baseline.trim();
  if (!base) return body.trim();
  if (body.startsWith(base)) return body.slice(base.length).trim();
  if (body.endsWith(base)) return body.slice(0, -base.length).trim();
  return body.trim();
}

/** Nothing yet, or only a status line ("Thinking...") a real answer replaces. A sentence that only starts like one ("Looking at your inbox, ...") is an answer. */
function stillThinking(answer: string): boolean {
  const t = spaced(answer.replace(/\*\*/g, '').replace(/^(-|\d+\.)\s+/, ''));
  if (!t) return true;
  if (t.length >= 80 || answer.includes('\n')) return false;
  const trails = /(\.\.\.|…)$/.test(t);
  return (HOOKS.thinking.test(t) && (trails || t.split(' ').length <= 3)) || (trails && /^\w+ing\b/i.test(t));
}

function sameText(a: string, b: string): boolean {
  return spaced(a) === spaced(b);
}

function text(el: Element): string {
  return el.textContent?.trim() ?? '';
}

function spaced(s: string): string {
  return s.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

function noop() {}

/** For the diagnostics log. */
function describe(el: Element): string {
  const role = el.getAttribute('role');
  const cls = el.getAttribute('class')?.trim().split(/\s+/).slice(0, 4).join('.');
  return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ''}${cls ? `.${cls}` : ''}`;
}

/** Even if the page itself is hidden: display:none parts have no boxes. */
function laidOut(el: Element): boolean {
  return el.getClientRects().length > 0 || (el as HTMLElement).offsetParent !== null;
}
