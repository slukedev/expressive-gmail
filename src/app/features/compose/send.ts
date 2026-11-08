import { mail } from '../../data/actions';
import { backend, keys, queryClient } from '../../data/client';
import type { Draft, OutgoingMessage, Thread } from '../../data/types';
import { BackendError } from '../../data/backend';
import { rawId } from '../../data/accounts/ids';
import { composeFallbackUrl } from '../../../session/account';
import { composeUrlId } from '../../../session/ids';
import { classicGmailAt, openUrl } from '../../lib/host';
import { stripHtml } from '../../lib/format';
import { fullTime } from '../../lib/presets';
import { getRoute, navigate } from '../../router/useRoute';
import { aside } from '../replylater/store';
import { local } from '../../state/local';
import { useSettingsStore } from '../../state/settings';
import { useUi, type ComposeDraft } from '../../state/ui';
import { snack, snackbarManager } from '../../ui/Snackbar';

export function toOutgoing(d: ComposeDraft): OutgoingMessage {
  const html = d.quoteHtml ? `${d.html}<br>${d.quoteHtml}` : d.html;
  return {
    draftId: d.draftId,
    threadId: d.threadId,
    from: d.from,
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    html,
    inReplyTo: d.inReplyTo,
    references: d.references,
    attachments: d.attachments,
  };
}

export function isEmptyDraft(d: ComposeDraft) {
  return !d.to.length && !d.cc.length && !d.bcc.length && !d.subject.trim() && !stripHtml(d.html).replace(/^--\s*/, '').trim() && !d.attachments.length;
}

/** The moment its draft is sent or thrown away. */
function hideDraftRow(d: ComposeDraft) {
  if (!d.threadId || !d.draftMessageId) return;
  queryClient.setQueryData<Thread>(keys.thread(d.threadId), (t) => t && { ...t, messages: t.messages.filter((m) => m.id !== d.draftMessageId) });
}

interface SendOptions {
  sendAt?: number;
  remindInDays?: number;
}

/** The window closes at once and the real send waits out the undo delay, so Undo can reopen the draft untouched. */
export function sendDraft(d: ComposeDraft, opts: SendOptions = {}) {
  if (scheduling.has(d.key)) {
    // An earlier Schedule send hasn't answered yet; a second send could make two.
    snack('Gmail is still scheduling this message. Check Scheduled before sending it again.', {
      action: { label: 'Open Scheduled', onClick: () => navigate({ view: { kind: 'folder', folder: 'scheduled' } }) },
    });
    return;
  }
  if (opts.sendAt) {
    scheduleDraft(d, opts.sendAt);
    return;
  }
  const ui = useUi.getState();
  const delay = opts.sendAt ? 0 : useSettingsStore.getState().settings.undoSendSeconds * 1000;
  const message = { ...toOutgoing(d), sendAt: opts.sendAt };
  ui.closeCompose(d.key);
  hideDraftRow(d);
  // Answering something set aside takes it off Reply later; Undo or a failed send puts it back.
  const putBack = d.threadId && d.mode !== 'forward' ? aside.replying(d.threadId) : undefined;
  // An inline reply only reopens inline if its conversation is still open.
  const reopen = () => ({ ...d, inline: d.inline && getRoute().threadId === d.threadId, window: d.inline ? ('open' as const) : d.window });

  let cancelled = false;
  const snackId = snack(delay ? 'Sending…' : 'Message sent', {
    timeout: delay ? delay + 400 : 6000,
    action: delay
      ? {
          label: 'Undo',
          onClick: () => {
            cancelled = true;
            window.clearTimeout(timer);
            putBack?.();
            useUi.getState().openCompose(reopen());
            snack('Sending undone');
          },
        }
      : undefined,
  });

  const timer = window.setTimeout(async () => {
    if (cancelled) return;
    try {
      // Send the draft an autosave in flight is creating, rather than leave it in Drafts.
      const { draftId } = await settleDraftSave(d);
      const sent = await backend().send(draftId ? { ...message, draftId } : message);
      savedIds.delete(d.key);
      // With no undo window the "Message sent" snackbar is already up.
      if (delay) snackbarManager.close(snackId);
      if (delay) {
        snack('Message sent', {
          action: { label: 'View message', onClick: () => navigate({ view: { kind: 'folder', folder: 'sent' }, threadId: sent.threadId }) },
        });
      }
      if (opts.remindInDays) {
        local.setReminder(
          {
            threadId: sent.threadId,
            subject: d.subject,
            due: Date.now() + opts.remindInDays * 86_400_000,
            messageCount: 0,
            createdAt: Date.now(),
          },
          sent.threadId,
        );
      }
      if (d.threadId && useSettingsStore.getState().settings.sendAndArchive && d.mode !== 'forward') {
        void mail.archive([d.threadId]);
      }
      void queryClient.invalidateQueries({ queryKey: keys.allThreads });
      void queryClient.invalidateQueries({ queryKey: keys.labels });
      if (d.threadId) void queryClient.invalidateQueries({ queryKey: keys.thread(d.threadId) });
    } catch (err) {
      snackbarManager.close(snackId);
      putBack?.();
      useUi.getState().openCompose(reopen());
      if (err instanceof BackendError && err.code === 'unsupported') {
        // Session mode can't always send; Gmail's own compose window always can.
        const account = queryClient.getQueryData<{ index: number }>(keys.account);
        snack("This connection can't send that message. Your draft is still here.", {
          state: 'error',
          timeout: 0,
          action: { label: 'Send in Gmail', onClick: () => openUrl(composeFallbackUrl(message, account?.index ?? 0)) },
        });
      } else if (err instanceof BackendError && err.code === 'unknown') {
        snack("Gmail didn't confirm the send. Check Sent before trying again.", { state: 'error', timeout: 0 });
      } else {
        snack(err instanceof Error && err.message ? `Couldn't send: ${err.message}` : "Couldn't send. Your message is back in the compose window.", { state: 'error' });
      }
    }
  }, delay);
}

const scheduling = new Set<string>();
/** Gmail's own steps give up well before this. */
const SCHEDULE_WATCHDOG_MS = 90_000;

/** Saved as a Gmail draft, then Gmail schedules it; Undo is Gmail's Cancel send. The window always comes back editable with the saved draft, and a late answer is still reported. */
function scheduleDraft(d: ComposeDraft, sendAt: number) {
  useUi.getState().closeCompose(d.key);
  hideDraftRow(d);
  scheduling.add(d.key);
  let saved: Draft | undefined;
  const savedIds = (): Partial<ComposeDraft> => (saved ? { draftId: saved.id, draftMessageId: saved.message.id, threadId: saved.message.threadId } : {});
  const reopen = (patch: Partial<ComposeDraft> = {}) =>
    useUi.getState().openCompose({ ...d, inline: d.inline && getRoute().threadId === d.threadId, window: d.inline ? ('open' as const) : d.window, ...patch });
  const progress = snack('Scheduling…', { state: 'loading' });
  const b = backend();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.allThreads });
    void queryClient.invalidateQueries({ queryKey: keys.labels });
    if (d.threadId) void queryClient.invalidateQueries({ queryKey: keys.thread(d.threadId) });
  };
  const openScheduled = { label: 'Open Scheduled', onClick: () => navigate({ view: { kind: 'folder', folder: 'scheduled' } }) };

  // Gmail went quiet: hand the window back and keep listening.
  let gaveUp = false;
  let waitingSnack: string | undefined;
  const watchdog = window.setTimeout(() => {
    gaveUp = true;
    snackbarManager.close(progress);
    reopen(savedIds());
    waitingSnack = snack("Gmail hasn't confirmed the schedule yet. Your message is saved in Drafts; check Scheduled before trying again.", { timeout: 0, action: openScheduled });
  }, SCHEDULE_WATCHDOG_MS);

  void (async () => {
    // Saved first, so a failure leaves the message in Drafts and this window keeps editing it.
    if (b.capabilities.drafts) saved = await b.saveDraft(toOutgoing(await settleDraftSave(d)));
    const at = saved ? { draftId: saved.id, threadId: saved.message.threadId } : {};
    return b.send({ ...toOutgoing(d), ...at, sendAt });
  })()
    .finally(() => {
      window.clearTimeout(watchdog);
      scheduling.delete(d.key);
      snackbarManager.close(progress);
      if (waitingSnack) snackbarManager.close(waitingSnack);
      refresh();
    })
    .then(
      (sent) => {
        if (gaveUp) {
          // The window came back meanwhile: untouched, it goes away again; edited, it stays.
          const open = useUi.getState().composes.find((c) => c.key === d.key);
          if (open && open.html === d.html && open.subject === d.subject && open.to === d.to) useUi.getState().closeCompose(d.key);
          else if (open) {
            snack(`Gmail scheduled it after all, for ${fullTime(sendAt)}. Changes in the open window aren't in it.`, { timeout: 0, action: openScheduled });
            return;
          }
        }
        snack(`Send scheduled for ${fullTime(sendAt)}`, {
          action: {
            label: 'Undo',
            onClick: () =>
              void mail.cancelScheduled(sent.threadId, { quiet: true }).then((thread) => {
                if (!thread) return;
                const draft = thread.messages.find((m) => m.id === sent.id && m.isDraft) ?? [...thread.messages].reverse().find((m) => m.isDraft);
                // Undone, it's a draft again: Send sends unless a new time is picked.
                reopen({ sendAt: undefined, ...(draft ? { draftId: draft.id, draftMessageId: draft.id, threadId: draft.threadId } : {}) });
                snack('Scheduled send undone');
              }),
          },
        });
      },
      (err: unknown) => {
        if (!gaveUp) reopen(savedIds());
        else if (saved) useUi.getState().updateCompose(d.key, savedIds());
        if (err instanceof BackendError && err.code === 'unsupported') {
          snack(err.message);
        } else if (saved) {
          const draft = saved;
          snack(err instanceof BackendError && err.code === 'unknown' && err.message ? err.message : "Couldn't schedule in Gmail. Your message is saved in Drafts.", {
            timeout: 0,
            ...(b.kind === 'session'
              ? { action: { label: 'Open in classic Gmail', onClick: () => classicGmailAt(`#drafts?compose=${composeUrlId(rawId(draft.message.threadId), rawId(draft.message.id))}`) } }
              : {}),
          });
        } else {
          snack(err instanceof Error && err.message ? `Couldn't schedule: ${err.message}` : "Couldn't schedule. Your message is back in the compose window.");
        }
      },
    );
}

let draftTimers = new Map<string, number>();
/** One save at a time per window, so a draft is never created twice. */
let inflight = new Map<string, Promise<void>>();
/** Kept past the window closing. */
let savedIds = new Map<string, { draftId: string; draftMessageId: string }>();

/** Its own, or what its last save made. */
function withSavedIds(d: ComposeDraft): ComposeDraft {
  const current = useUi.getState().composes.find((c) => c.key === d.key);
  const saved = savedIds.get(d.key);
  const draftId = current?.draftId ?? saved?.draftId ?? d.draftId;
  const draftMessageId = current?.draftMessageId ?? saved?.draftMessageId ?? d.draftMessageId;
  return draftId ? { ...d, draftId, draftMessageId } : d;
}

async function settleDraftSave(d: ComposeDraft): Promise<ComposeDraft> {
  await inflight.get(d.key)?.catch(() => undefined);
  return withSavedIds(d);
}

/** A moment after typing stops. */
export function scheduleDraftSave(d: ComposeDraft, onStatus: (s: 'saving' | 'saved' | 'error') => void, delay = 1500) {
  if (!backend().capabilities.drafts) return;
  window.clearTimeout(draftTimers.get(d.key));
  draftTimers.set(
    d.key,
    window.setTimeout(() => {
      draftTimers.delete(d.key);
      if (isEmptyDraft(d)) return;
      const save = async () => {
        onStatus('saving');
        try {
          const draft = await backend().saveDraft(toOutgoing(withSavedIds(d)));
          savedIds.set(d.key, { draftId: draft.id, draftMessageId: draft.message.id });
          const current = useUi.getState().composes.find((c) => c.key === d.key);
          if (current && (current.draftId !== draft.id || current.draftMessageId !== draft.message.id)) {
            useUi.getState().updateCompose(d.key, { draftId: draft.id, draftMessageId: draft.message.id });
          }
          onStatus('saved');
          void queryClient.invalidateQueries({ queryKey: keys.labels });
          // Closed before the save landed: the thread shows the draft row again.
          if (!current && d.threadId) void queryClient.invalidateQueries({ queryKey: keys.thread(d.threadId) });
        } catch {
          onStatus('error');
        }
      };
      const next = (inflight.get(d.key) ?? Promise.resolve()).then(save);
      inflight.set(d.key, next);
      void next.finally(() => inflight.get(d.key) === next && inflight.delete(d.key));
    }, delay),
  );
}

export function cancelDraftSave(key: string) {
  window.clearTimeout(draftTimers.get(key));
  draftTimers.delete(key);
}

export async function discardDraft(d: ComposeDraft) {
  cancelDraftSave(d.key);
  useUi.getState().closeCompose(d.key);
  hideDraftRow(d);
  // A save still in flight would leave a draft behind.
  const saved = await settleDraftSave(d);
  savedIds.delete(d.key);
  if (saved.draftId) {
    try {
      await backend().deleteDraft(saved.draftId, saved.threadId ?? d.threadId);
      void queryClient.invalidateQueries({ queryKey: keys.allThreads });
      void queryClient.invalidateQueries({ queryKey: keys.labels });
      if (d.threadId) void queryClient.invalidateQueries({ queryKey: keys.thread(d.threadId) });
    } catch {
      // The draft stays in Drafts.
    }
  }
  snack('Draft discarded', {
    action: {
      label: 'Undo',
      onClick: () => useUi.getState().openCompose({ ...d, draftId: undefined, draftMessageId: undefined }),
    },
  });
}

export function resetDraftTimers() {
  draftTimers.forEach((t) => window.clearTimeout(t));
  draftTimers = new Map();
  inflight = new Map();
  savedIds = new Map();
}
