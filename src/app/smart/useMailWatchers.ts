import { useEffect } from 'react';
import { mail } from '../data/actions';
import { backend, keys, queryClient } from '../data/client';
import type { Account, ThreadSummary } from '../data/types';
import { navigate } from '../router/useRoute';
import { useLocal } from '../state/local';
import { useSettings, useSettingsStore } from '../state/settings';
import { pauseActive } from '../features/pause/pause';
import { participantsLine } from '../lib/format';
import { findCode } from './extract';
import { onMailArrived } from '../data/sync';
import { browserWatcherEnv, startMailWatcher } from './mailWatcher';
import { clearTracking, ingestSummaries, startTracking } from './trackingStore';

type ExtRuntime = { runtime?: { id?: string; sendMessage?: (m: unknown) => Promise<unknown> } };
const ext = (globalThis as unknown as { browser?: ExtRuntime; chrome?: ExtRuntime }).browser ?? (globalThis as unknown as { chrome?: ExtRuntime }).chrome;

/** Through the extension when possible, so it works with the tab in the background. */
async function notify(t: ThreadSummary, me?: string) {
  const from = participantsLine(t.participants.slice(-1), me);
  const code = findCode(t.subject, t.snippet);
  const title = code ? `${code.display} is your code` : from;
  const body = code ? `From ${from}` : `${t.subject || '(no subject)'}\n${t.snippet}`.slice(0, 180);
  if (ext?.runtime?.id && ext.runtime.sendMessage) {
    try {
      const res = (await ext.runtime.sendMessage({ type: 'notify', threadId: t.id, title, body })) as { ok?: boolean } | undefined;
      if (res?.ok) return;
    } catch {
      // Fall back to the page's own notifications below.
    }
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, tag: t.id, icon: '/icon/128.png' });
  n.onclick = () => {
    window.focus();
    navigate({ view: { kind: 'folder', folder: 'inbox' }, threadId: t.id });
  };
}

/** Desktop notifications and blocked senders (mailWatcher.ts, driven by the sync loop), and package records. */
export function useMailWatchers() {
  const notifications = useSettings((s) => s.notifications);
  const blocked = useLocal((s) => s.blocked);
  const smartFeatures = useSettings((s) => s.smartFeatures);

  useEffect(() => {
    if (smartFeatures) return startTracking();
    // Turned off: stop reading mail for packages and forget what was kept.
    clearTracking();
  }, [smartFeatures]);

  useEffect(() => {
    if (!notifications && !blocked.length) return;
    const watcher = startMailWatcher(
      {
        ...browserWatcherEnv(),
        onMailArrived,
        list: async (q, pageSize) => (await backend().listThreads({ q, pageSize })).threads,
        spam: async (ids) => {
          await mail.spam(ids);
        },
        notify: (t) => notify(t, queryClient.getQueryData<Account>(keys.account)?.email),
        paused: () => pauseActive(useSettingsStore.getState().settings.inboxPause),
        // A "Delivered" for a tracked package updates it here, no search needed.
        sawInbox: (threads) => useSettingsStore.getState().settings.smartFeatures && ingestSummaries(threads),
      },
      { notifications, blocked },
    );
    return () => watcher.stop();
  }, [notifications, blocked]);

  // Clicks on extension notifications come back through the content script.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { source?: string; type?: string; threadId?: string };
      if (e.source !== window.parent || d?.source !== 'better-gmail/content' || d.type !== 'open-thread' || !d.threadId) return;
      navigate({ view: { kind: 'folder', folder: 'inbox' }, threadId: d.threadId });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
}
