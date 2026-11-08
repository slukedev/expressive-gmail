import { BackendError, type MailBackend } from './backend';
import { readKey, watchKey, writeKey } from '../state/storage';
import type { LabelChange, ThreadPage, ThreadQuery, ThreadSummary } from './types';

const STORE_KEY = 'bg.localSnooze.v1';
type Store = Record<string, number>;

/** For backends without Gmail's snooze: archive now, keep the wake time in this browser, and put the thread back in the inbox (unread) the next time Gmail is open after it. */
export function withLocalSnooze(inner: MailBackend, account?: string): MailBackend {
  if (inner.capabilities.snooze) return inner;
  // Per account: tabs signed in as other accounts share this storage, and waking must never touch their ids.
  let key: Promise<string> | undefined;
  const storeKey = () => {
    if (!key) {
      key = (account ? Promise.resolve(account) : signedInAs(inner)).then((email) => `${STORE_KEY}:${email.trim().toLowerCase()}`);
      key.catch(() => (key = undefined));
    }
    return key;
  };
  // Another tab on the same account changes this list too; its writes drop the copy kept here.
  let cache: Store | null = null;
  let watching = false;
  const read = async (): Promise<Store> => {
    const key = await storeKey();
    if (!watching) {
      watching = true;
      watchKey(key, () => (cache = null));
    }
    const stored = await readKey<Store>(key);
    return (cache = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {});
  };
  const load = async () => cache ?? read();
  // Changes read what storage holds right then, never the copy, and run one at a time.
  let writes: Promise<unknown> = Promise.resolve();
  const update = (change: (store: Store) => Store | undefined): Promise<void> => {
    const run = writes.then(async () => {
      const next = change({ ...(await read()) });
      if (!next) return;
      cache = next;
      await writeKey(await storeKey(), next);
    });
    writes = run.catch(() => undefined);
    return run;
  };
  const mark = (t: ThreadSummary, until: number): ThreadSummary => ({
    ...t,
    snoozedUntil: until,
    labelIds: [...new Set([...t.labelIds.filter((l) => l !== 'INBOX'), 'SNOOZED'])],
  });

  function forget(ids: string[]) {
    return update((store) => {
      if (!ids.some((id) => id in store)) return undefined;
      ids.forEach((id) => delete store[id]);
      return store;
    });
  }

  async function wakeDue(): Promise<string[]> {
    const now = Date.now();
    const due = Object.entries(await read()).filter(([, t]) => t <= now);
    if (!due.length) return [];
    const woke: string[] = [];
    const gone: string[] = [];
    const ids = due.map(([id]) => id);
    try {
      await inner.modifyThreads(ids, { add: ['INBOX', 'UNREAD'] });
      woke.push(...ids);
    } catch (err) {
      if (!(err instanceof BackendError && err.code === 'not-found')) throw err;
      // One thread deleted meanwhile fails the whole call; wake the rest one by one.
      for (const id of ids) {
        try {
          await inner.modifyThreads([id], { add: ['INBOX', 'UNREAD'] });
          woke.push(id);
        } catch (e) {
          if (e instanceof BackendError && e.code === 'not-found') gone.push(id);
        }
      }
    }
    // Read again: a snooze set meanwhile must stay.
    await update((store) => {
      for (const [id, t] of due) if ((woke.includes(id) || gone.includes(id)) && store[id] === t) delete store[id];
      return store;
    });
    return woke;
  }

  // So two can't wake (and mark unread) the same threads.
  let queue: Promise<unknown> = Promise.resolve();
  const wake = () => {
    const run = queue.then(wakeDue, wakeDue);
    queue = run.catch(() => undefined);
    return run;
  };

  const wrapped: MailBackend = Object.create(inner);
  Object.assign(wrapped, {
    kind: inner.kind,
    capabilities: { ...inner.capabilities, snooze: true },
    async snoozeThreads(ids: string[], until: number) {
      await inner.modifyThreads(ids, { remove: ['INBOX'] });
      await update((store) => {
        ids.forEach((id) => (store[id] = until));
        return store;
      });
    },
    async unsnoozeThreads(ids: string[]) {
      await forget(ids);
      await inner.modifyThreads(ids, { add: ['INBOX'] });
    },
    async trashThreads(ids: string[]) {
      await inner.trashThreads(ids);
      await forget(ids);
    },
    async deleteThreadsForever(ids: string[]) {
      await inner.deleteThreadsForever(ids);
      await forget(ids);
    },
    async modifyThreads(ids: string[], change: LabelChange) {
      await inner.modifyThreads(ids, change);
      // Moving a snoozed thread back to the inbox by hand ends the snooze.
      if (change.add?.includes('INBOX')) await forget(ids);
    },
    async listThreads(query: ThreadQuery): Promise<ThreadPage> {
      if (!/(^|\s)(in|is):snoozed(\s|$)/.test(query.q)) {
        // The inbox shouldn't wait on a storage read first.
        const [store, page] = await Promise.all([load().catch((): Store => ({})), inner.listThreads(query)]);
        return { ...page, threads: page.threads.map((t) => (store[t.id] ? mark(t, store[t.id]) : t)) };
      }
      const store = await load();
      const native = await inner.listThreads(query).catch(() => ({ threads: [] }) as ThreadPage);
      if (query.pageToken) return native;
      const ids = Object.keys(store).filter((id) => !native.threads.some((t) => t.id === id));
      const local = await Promise.all(
        ids.map((id) =>
          inner
            .getThread(id)
            .then((t) => {
              const { messages: _m, ...summary } = t;
              void _m;
              return mark(summary, store[id]);
            })
            .catch(() => null),
        ),
      );
      const threads = [...local.filter((t): t is ThreadSummary => !!t), ...native.threads].sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0));
      return { ...native, threads, resultSizeEstimate: threads.length };
    },
    async getThread(id: string) {
      const [t, store] = await Promise.all([inner.getThread(id), load().catch((): Store => ({}))]);
      return store[id] ? { ...t, ...mark(t, store[id]) } : t;
    },
    async pollChanges() {
      const woke = await wake().catch(() => []);
      const changes = await inner.pollChanges();
      return woke.length ? [...changes, { type: 'threads' as const, threadIds: woke }] : changes;
    },
  });
  void wake().catch(() => undefined);
  return wrapped;
}

async function signedInAs(backend: MailBackend): Promise<string> {
  const hint = await backend.accountHint?.().catch(() => undefined);
  return hint || (await backend.getAccount()).email;
}
