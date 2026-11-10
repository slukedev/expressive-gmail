import { snack, snackProgress } from '../ui/Snackbar';
import { markMoved, pulseDestination } from './moved';
import { getRoute, navigate } from '../router/useRoute';
import { classicGmailAt } from '../lib/host';
import { BackendError, type MailBackend } from './backend';
import {
  adjustUnread,
  applyLabelChange,
  backend,
  forgetChange,
  keys,
  patchThreads,
  pruneAfterCollapse,
  markArriving,
  pruneLists,
  queryClient,
  rememberChange,
  rememberGone,
  snapshotThreads,
} from './client';
import type { Label, LabelChange, LabelId, Thread, ThreadSummary } from './types';
import { stillInView } from './views';
import { useSettingsStore } from '../state/settings';
import { showingCachedMail, untilFreshMail } from './lifecycle';
import { useUi } from '../state/ui';

/** In list order, so actions can auto-advance. */
let visibleIds: string[] = [];
export function setVisibleThreadIds(ids: string[]) {
  visibleIds = ids;
}
export function getVisibleThreadIds() {
  return visibleIds;
}

/** In single-pane mode Gmail returns to the list after archive; with a reading pane we advance. */
let splitPane = false;
export function setSplitPane(on: boolean) {
  splitPane = on;
}

/** From .row-wrap[data-leaving] in app.css. */
const COLLAPSE_MS = 460;

let lastUndo: (() => void) | null = null;
let lastUndoLabel = '';
/** What z would take back ("Conversation archived"). */
export function undoableAction(): string | null {
  return lastUndo ? lastUndoLabel : null;
}
export function undoLast() {
  const fn = lastUndo;
  lastUndo = null;
  if (fn) fn();
  else snack('Nothing to undo');
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);
const convo = (n: number) => (n === 1 ? 'Conversation' : `${n} conversations`);

/** Adds the reason when knowing it changes what to do next. */
function errorMessage(err: unknown, fallback: string) {
  if (err instanceof BackendError) {
    if (err.code === 'unauthenticated' || err.code === 'session-unavailable') return 'Your Gmail session expired. Reload the page to sign in again.';
    // Gmail's 5xx answers arrive as network errors too; only blame the connection when the browser says so.
    if (err.code === 'network') return navigator.onLine === false ? `${fallback} You're offline.` : fallback;
    if (err.code === 'rate-limited') return `${fallback} Gmail is busy right now.`;
    if (err.code === 'unsupported') return err.message;
  }
  return fallback;
}

/** Failures on Gmail's own page already say what's left and what to do. */
function deleteFailure(err: unknown, fallback: string) {
  if (err instanceof BackendError && err.code === 'unknown' && /classic Gmail/.test(err.message)) return err.message;
  return errorMessage(err, fallback);
}

function classicAction(hash: string) {
  return { label: 'Open classic Gmail', onClick: () => classicGmailAt(hash) };
}

const EMPTY_BATCH = 100;
/** For backends with no folder-wide call. */
export async function deleteEveryPage(b: MailBackend, folder: 'trash' | 'spam'): Promise<number> {
  const q = `in:${folder}`;
  let count = 0;
  let previous = '';
  for (;;) {
    const { threads } = await b.listThreads({ q, pageSize: EMPTY_BATCH });
    if (!threads.length) return count;
    const ids = threads.map((t) => t.id);
    // The same page twice means the last batch didn't go.
    if (ids.join() === previous) {
      throw new BackendError(`Couldn't empty ${folder === 'trash' ? 'Trash' : 'Spam'}: some conversations wouldn't delete. Open classic Gmail to finish.`, 'unknown');
    }
    previous = ids.join();
    await b.deleteThreadsForever(ids);
    count += ids.length;
  }
}

/** A backend can say so for a refusal it explains itself. */
function retryable(err: unknown) {
  if (!(err instanceof BackendError)) return true;
  if (err.code === 'unsupported') return err.retryable;
  return err.code !== 'unauthenticated' && err.code !== 'session-unavailable';
}

function advanceFrom(ids: string[]) {
  const route = getRoute();
  if (!route.threadId || !ids.includes(route.threadId)) return;
  const pref = useSettingsStore.getState().settings.afterAction;
  if (pref === 'list' || (pref === 'auto' && !splitPane)) {
    navigate({ view: route.view }, { replace: true });
    return;
  }
  const index = visibleIds.indexOf(route.threadId);
  const remaining = visibleIds.filter((id) => !ids.includes(id));
  // The list is newest first: the older neighbour takes the same index, the newer one sits just above.
  const older = index >= 0 ? remaining[index] : undefined;
  const newer = index > 0 ? remaining[index - 1] : undefined;
  const next = pref === 'newer' ? (newer ?? older) : (older ?? newer);
  navigate({ view: route.view, threadId: next }, { replace: true });
}

interface ModifyOptions {
  ids: string[];
  change: LabelChange;
  message?: string;
  /** Archive, move: auto-advance and animate out. */
  leaves?: boolean;
  /** Where it went, as a sidebar route (`inbox`), so the row and that entry can show the move. */
  to?: string;
  undoable?: boolean;
  /** Defaults to modifyThreads. */
  run?: (b: MailBackend) => Promise<void>;
  inverseRun?: (b: MailBackend) => Promise<void>;
  patch?: (t: ThreadSummary) => ThreadSummary;
  /** "Couldn't archive." */
  failed?: string;
}

/** A label is only taken off threads that didn't have it, and only put back on threads that did. Threads needing the same change share one call. */
function inverseChanges(ids: string[], change: LabelChange, before: Map<string, ThreadSummary>) {
  const groups = new Map<string, { ids: string[]; change: { add: LabelId[]; remove: LabelId[] } }>();
  for (const id of ids) {
    const had = before.get(id)?.labelIds;
    const add = (change.remove ?? []).filter((l) => !had || had.includes(l));
    const remove = (change.add ?? []).filter((l) => !had || !had.includes(l));
    if (!add.length && !remove.length) continue;
    const key = JSON.stringify([add, remove]);
    const group = groups.get(key) ?? { ids: [], change: { add, remove } };
    group.ids.push(id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Mail painted from the boot cache isn't acted on until fresh data arrives: the change shows at once, the call waits, and the change is laid over the fresh data. */
async function afterFreshMail(reapply: () => void) {
  if (!showingCachedMail()) return;
  await untilFreshMail();
  reapply();
}

const CATEGORIES: LabelId[] = ['CATEGORY_PERSONAL', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];
const inTab = (t: ThreadSummary, category: LabelId) =>
  Number(t.labelIds.includes('INBOX') && t.labelIds.includes('UNREAD') && t.labelIds.includes(category));

async function modify(options: ModifyOptions): Promise<void> {
  const { ids, change, message, leaves, to, undoable = true, run, inverseRun, patch, failed = "Couldn't update." } = options;
  if (!ids.length) return;
  // Undo goes to the account the action went to, even if the scope changes meanwhile.
  const b = backend();
  const before = snapshotThreads(ids);

  const apply = (t: ThreadSummary) => (patch ? patch(applyLabelChange(t, change)) : applyLabelChange(t, change));
  patchThreads(ids, apply);
  rememberChange(ids, change);
  const markUnread = change.add?.includes('UNREAD');
  if (markUnread || change.remove?.includes('UNREAD')) {
    // Only threads whose unread state flips move a count, and only on their own labels.
    const deltas = new Map<LabelId, number>();
    for (const t of before.values()) {
      if (t.labelIds.includes('UNREAD') === !!markUnread) continue;
      for (const l of t.labelIds) deltas.set(l, (deltas.get(l) ?? 0) + (markUnread ? 1 : -1));
    }
    adjustUnread(deltas, ids);
  }
  // A category's inbox tab counts unread threads in the inbox, so archiving or moving to the inbox moves it as well.
  const section = new Map<LabelId, number>();
  for (const t of before.values()) {
    const after = apply(t);
    for (const c of CATEGORIES) section.set(c, (section.get(c) ?? 0) + inTab(after, c) - inTab(t, c));
  }
  adjustUnread(section, ids, 'inboxUnreadCount');
  if (leaves) {
    // Only rows that stay in this list (All mail) slide; the others fold away, and sliding them too would fight that.
    const view = getRoute().view;
    const labels = queryClient.getQueryData<Label[]>(keys.labels) ?? [];
    markMoved(ids.filter((id) => {
      const t = before.get(id);
      return !t || stillInView(view, applyLabelChange(t, change), labels) !== false;
    }));
    if (to) pulseDestination(to);
    advanceFrom(ids);
    // Removing a half-collapsed row from the cache makes the list below jump.
    pruneAfterCollapse(ids, COLLAPSE_MS);
  } else {
    pruneLists();
  }

  const restore = () => {
    markArriving(ids);
    forgetChange(ids);
    patchThreads(ids, (t) => before.get(t.id) ?? t);
    void queryClient.invalidateQueries({ queryKey: keys.labels });
  };

  // z takes back the change on screen, even while Gmail is still writing it.
  let wrote!: (ok: boolean) => void;
  const written = new Promise<boolean>((resolve) => (wrote = resolve));
  const undo = async () => {
    if (lastUndo === undo) lastUndo = null;
    restore();
    const inverse = inverseChanges(ids, change, before);
    // Gmail can answer with the pre-undo state for a few seconds.
    inverse.forEach((g) => rememberChange(g.ids, g.change));
    // One that failed was put back with its own message.
    if (!(await written)) return;
    try {
      if (inverseRun) await inverseRun(b);
      else await Promise.all(inverse.map((g) => b.modifyThreads(g.ids, g.change)));
      snack('Action undone');
    } catch (err) {
      forgetChange(ids);
      snack(errorMessage(err, "Couldn't undo."), { state: 'error' });
    }
    void queryClient.invalidateQueries({ queryKey: keys.allThreads });
  };
  if (undoable) {
    lastUndo = undo;
    lastUndoLabel = message ?? '';
  }

  try {
    await afterFreshMail(() => {
      patchThreads(ids, apply);
      pruneLists();
    });
    await (run ? run(b) : b.modifyThreads(ids, change));
    wrote(true);
  } catch (err) {
    wrote(false);
    if (lastUndo === undo) lastUndo = null;
    restore();
    void queryClient.invalidateQueries({ queryKey: keys.allThreads });
    snack(errorMessage(err, failed), { state: 'error', ...(retryable(err) ? { action: { label: 'Retry', onClick: () => void modify(options) } } : {}) });
    return;
  }

  if (message) snack(message, undoable ? { action: { label: 'Undo', onClick: undo } } : {});
  void queryClient.invalidateQueries({ queryKey: keys.labels });
  // Lists not on screen refetch when next shown; the shown one is already right.
  void queryClient.invalidateQueries({ queryKey: keys.allThreads, refetchType: 'none' });
}

export const mail = {
  archive(ids: string[]) {
    return modify({ ids, change: { remove: ['INBOX'] }, leaves: true, to: 'all', message: `${convo(ids.length)} archived`, failed: "Couldn't archive." });
  },
  moveToInbox(ids: string[]) {
    return modify({
      ids,
      change: { add: ['INBOX'], remove: ['SPAM', 'TRASH'] },
      leaves: true,
      to: 'inbox',
      message: `${convo(ids.length)} moved to Inbox`,
      failed: "Couldn't move to Inbox.",
    });
  },
  trash(ids: string[]) {
    // In Drafts, Delete means Discard, as in Gmail: the draft goes, its conversation stays.
    const view = getRoute().view;
    if (view.kind === 'folder' && view.folder === 'drafts') return mail.discardDrafts(ids);
    return modify({
      ids,
      change: { add: ['TRASH'], remove: ['INBOX'] },
      leaves: true,
      to: 'trash',
      message: `${convo(ids.length)} moved to Trash`,
      failed: "Couldn't move to Trash.",
      run: (b) => b.trashThreads(ids),
      inverseRun: (b) => b.untrashThreads(ids),
    });
  },
  untrash(ids: string[]) {
    return modify({
      ids,
      change: { remove: ['TRASH'], add: ['INBOX'] },
      leaves: true,
      to: 'inbox',
      message: `${convo(ids.length)} restored`,
      failed: "Couldn't restore.",
      run: (b) => b.untrashThreads(ids),
      inverseRun: (b) => b.trashThreads(ids),
    });
  },
  /** Their rows leave Drafts at once and come back if Gmail refuses. */
  async discardDrafts(ids: string[]) {
    if (!ids.length) return;
    const b = backend();
    const before = snapshotThreads(ids);
    const change: LabelChange = { remove: ['DRAFT'] };
    advanceFrom(ids);
    patchThreads(ids, (t) => ({ ...applyLabelChange(t, change), draftCount: 0 }));
    rememberChange(ids, change);
    pruneAfterCollapse(ids, COLLAPSE_MS);
    try {
      let count = 0;
      for (const id of ids) {
        const thread = await queryClient.fetchQuery({ queryKey: keys.thread(id), queryFn: () => b.getThread(id), staleTime: 0 });
        for (const m of thread.messages.filter((x) => x.isDraft && !x.labelIds.includes('SCHEDULED'))) {
          // An open window on the draft would save it straight back.
          const ui = useUi.getState();
          ui.composes.filter((c) => c.draftId === m.id || c.draftMessageId === m.id).forEach((c) => ui.closeCompose(c.key));
          await b.deleteDraft(m.id, id);
          count++;
        }
      }
      snack(count === 1 ? 'Draft discarded' : `${count} drafts discarded`);
    } catch (err) {
      forgetChange(ids);
      patchThreads(ids, (t) => before.get(t.id) ?? t);
      snack(errorMessage(err, "Couldn't discard the draft."), { state: 'error', ...(retryable(err) ? { action: { label: 'Retry', onClick: () => void mail.discardDrafts(ids) } } : {}) });
    }
    void queryClient.invalidateQueries({ queryKey: keys.allThreads });
    void queryClient.invalidateQueries({ queryKey: keys.labels });
    ids.forEach((id) => void queryClient.invalidateQueries({ queryKey: keys.thread(id) }));
  },
  async deleteForever(ids: string[]) {
    if (!ids.length) return;
    const view = getRoute().view;
    const classic = classicAction(view.kind === 'folder' && view.folder === 'spam' ? '#spam' : '#trash');
    // Session mode can't delete forever; Gmail's own page can. Hand off instead of failing.
    if (!backend().capabilities.deleteForever) {
      snack('Deleting forever only works in classic Gmail', { action: classic });
      return;
    }
    // The account it was asked of, even if the view changes while this waits for fresh mail.
    const b = backend();
    const before = snapshotThreads(ids);
    advanceFrom(ids);
    patchThreads(ids, (t) => ({ ...t, labelIds: [] }));
    rememberGone(ids);
    pruneAfterCollapse(ids, COLLAPSE_MS);
    const progress = snackProgress(ids.length === 1 ? 'Deleting forever…' : `Deleting ${ids.length} conversations forever…`);
    try {
      await afterFreshMail(() => {
        patchThreads(ids, (t) => ({ ...t, labelIds: [] }));
        pruneLists();
      });
      await b.deleteThreadsForever(ids);
      progress.done(`${convo(ids.length)} deleted forever`);
    } catch (err) {
      forgetChange(ids);
      patchThreads(ids, (t) => before.get(t.id) ?? t);
      progress.fail(deleteFailure(err, "Couldn't delete forever."), { action: classic });
    }
    void queryClient.invalidateQueries({ queryKey: keys.allThreads });
    void queryClient.invalidateQueries({ queryKey: keys.labels });
  },
  /** Everything in the folder, not just what's loaded. */
  async emptyFolder(folder: 'trash' | 'spam') {
    const b = backend();
    const name = folder === 'trash' ? 'Trash' : 'Spam';
    const classic = classicAction(`#${folder}`);
    if (!b.capabilities.deleteForever) {
      snack(`Emptying ${name} only works in classic Gmail`, { action: classic });
      return;
    }
    // Rows stay until Gmail confirms the folder is empty.
    const progress = snackProgress(folder === 'trash' ? 'Emptying Trash…' : 'Deleting all spam…');
    try {
      const n = b.emptyFolder ? await b.emptyFolder(folder) : await deleteEveryPage(b, folder);
      if (n === 0) progress.done(`${name} is already empty`);
      else progress.done(`${name} emptied${typeof n === 'number' ? `. ${n === 1 ? '1 conversation' : `${n.toLocaleString()} conversations`} deleted forever` : ''}`);
    } catch (err) {
      progress.fail(deleteFailure(err, `Couldn't empty ${name}. Open classic Gmail to finish.`), { action: classic });
    }
    void queryClient.invalidateQueries({ queryKey: keys.allThreads });
    void queryClient.invalidateQueries({ queryKey: keys.labels });
  },
  spam(ids: string[]) {
    return modify({
      ids,
      change: { add: ['SPAM'], remove: ['INBOX'] },
      leaves: true,
      message: `${convo(ids.length)} marked as spam`,
      failed: "Couldn't report spam.",
    });
  },
  notSpam(ids: string[]) {
    return modify({
      ids,
      change: { remove: ['SPAM'], add: ['INBOX'] },
      leaves: true,
      message: `${convo(ids.length)} moved to Inbox`,
      failed: "Couldn't move to Inbox.",
    });
  },
  markRead(ids: string[], read: boolean, quiet = false) {
    return modify({
      ids,
      change: read ? { remove: ['UNREAD'] } : { add: ['UNREAD'] },
      message: quiet ? undefined : `${convo(ids.length)} marked as ${read ? 'read' : 'unread'}`,
      undoable: !quiet,
      failed: read ? "Couldn't mark as read." : "Couldn't mark as unread.",
    });
  },
  star(ids: string[], on: boolean) {
    return modify({ ids, change: on ? { add: ['STARRED'] } : { remove: ['STARRED'] }, undoable: false, failed: on ? "Couldn't star." : "Couldn't remove the star." });
  },
  important(ids: string[], on: boolean) {
    return modify({
      ids,
      change: on ? { add: ['IMPORTANT'] } : { remove: ['IMPORTANT'] },
      message: `${plural(ids.length, 'Conversation', `${ids.length} conversations`)} marked as ${on ? 'important' : 'not important'}`,
      failed: on ? "Couldn't mark as important." : "Couldn't mark as not important.",
    });
  },
  addLabels(ids: string[], labelIds: LabelId[], removeIds: LabelId[] = [], message?: string) {
    return modify({ ids, change: { add: labelIds, remove: removeIds }, message, failed: "Couldn't change labels." });
  },
  moveTo(ids: string[], labelId: LabelId, labelName: string) {
    return modify({
      ids,
      change: { add: [labelId], remove: ['INBOX'] },
      leaves: true,
      message: `${convo(ids.length)} moved to "${labelName}"`,
      failed: `Couldn't move to "${labelName}".`,
    });
  },
  snooze(ids: string[], until: number, label: string) {
    return modify({
      ids,
      change: { add: ['SNOOZED'], remove: ['INBOX'] },
      leaves: true,
      message: `Snoozed until ${label}`,
      failed: "Couldn't snooze.",
      run: (b) => b.snoozeThreads(ids, until),
      inverseRun: (b) => b.unsnoozeThreads(ids),
      patch: (t) => ({ ...t, snoozedUntil: until }),
    });
  },
  unsnooze(ids: string[]) {
    return modify({
      ids,
      change: { remove: ['SNOOZED'], add: ['INBOX'] },
      leaves: true,
      message: `${convo(ids.length)} unsnoozed`,
      failed: "Couldn't unsnooze.",
      run: (b) => b.unsnoozeThreads(ids),
      undoable: false,
      patch: (t) => ({ ...t, snoozedUntil: undefined }),
    });
  },
  mute(ids: string[]) {
    return modify({
      ids,
      change: { add: ['MUTED' as LabelId], remove: ['INBOX'] },
      leaves: true,
      message: `${convo(ids.length)} muted`,
      failed: "Couldn't mute.",
      run: (b) => b.muteThreads(ids, true),
      inverseRun: (b) => b.muteThreads(ids, false),
    });
  },
  /** The scheduled message turns back into a draft. Resolves with the conversation afterwards (to open the draft), or undefined when it couldn't be cancelled. */
  async cancelScheduled(threadId: string, opts: { quiet?: boolean } = {}): Promise<Thread | undefined> {
    const b = backend();
    if (!b.cancelScheduled) {
      snack("This account can't cancel scheduled mail here", { action: classicAction('#scheduled') });
      return undefined;
    }
    const before = snapshotThreads([threadId]);
    const view = getRoute().view;
    if (view.kind === 'folder' && view.folder === 'scheduled') advanceFrom([threadId]);
    patchThreads([threadId], (t) => ({ ...t, labelIds: t.labelIds.filter((l) => l !== 'SCHEDULED'), scheduledFor: undefined }));
    pruneAfterCollapse([threadId], COLLAPSE_MS);
    let thread: Thread | undefined;
    try {
      await b.cancelScheduled(threadId);
      thread = await b.getThread(threadId).catch(() => undefined);
      if (thread) queryClient.setQueryData(keys.thread(threadId), thread);
    } catch (err) {
      patchThreads([threadId], (t) => before.get(t.id) ?? t);
      snack(deleteFailure(err, "Couldn't cancel the send."), {
        state: 'error',
        action: retryable(err) ? { label: 'Retry', onClick: () => void mail.cancelScheduled(threadId, opts) } : classicAction('#scheduled'),
      });
      return undefined;
    } finally {
      void queryClient.invalidateQueries({ queryKey: keys.allThreads });
      void queryClient.invalidateQueries({ queryKey: keys.labels });
    }
    if (!opts.quiet) snack('Send canceled. Your message is in Drafts.');
    return thread ?? (before.get(threadId) as Thread | undefined);
  },
};
