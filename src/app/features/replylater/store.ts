import { create } from 'zustand';
import { rawId } from '../../data/accounts/ids';
import { inCurrentScope, scopedThreadId, threadAccount } from '../../data/accounts/threads';
import type { Account, Address, ThreadSummary } from '../../data/types';
import { keys, queryClient } from '../../data/client';
import { myAddresses } from '../../data/hooks';
import { isMe } from '../../lib/format';
import { getRoute, navigate } from '../../router/useRoute';
import { readKey, watchKey, writeKey } from '../../state/storage';
import { snack } from '../../ui/Snackbar';
import { replyToThread } from '../compose/open';

/** Reply later, after HEY's: conversations you mean to answer move to a stack at the top of the inbox and come off once you reply. Kept in this browser, by raw thread id. */
export interface AsideItem {
  threadId: string;
  /** Lowercased address of the owning account, when the scope can tell. */
  account?: string;
  subject: string;
  from: Address;
  snippet: string;
  addedAt: number;
  /** Newest message when it was set aside. */
  lastDate: number;
}

const KEY = 'bg.replylater.v1';

interface AsideStore {
  items: AsideItem[];
  /** Working through the stack: sending a reply opens the next one. */
  session: boolean;
  open: boolean;
}

export const useAside = create<AsideStore>(() => ({ items: [], session: false, open: false }));

let loaded = false;
/** Other tabs' changes come in through storage events. */
function loadAside() {
  if (loaded) return;
  loaded = true;
  void readKey<AsideItem[]>(KEY).then((stored) => {
    if (Array.isArray(stored)) useAside.setState({ items: stored });
  });
  watchKey(KEY, (v) => Array.isArray(v) && useAside.setState({ items: v as AsideItem[] }));
  // Leaving the stack ends a run through it.
  window.addEventListener('hashchange', () => {
    const { session, items } = useAside.getState();
    const open = getRoute().threadId;
    if (session && (!open || !isAside(items, open))) useAside.setState({ session: false });
  });
}

if (typeof window !== 'undefined') loadAside();

function save(items: AsideItem[]) {
  useAside.setState({ items });
  void writeKey(KEY, items);
}

/** Whatever has waited longest is answered first. */
export function stackOrder(items: AsideItem[]): AsideItem[] {
  return [...items].sort((a, b) => a.addedAt - b.addedAt);
}

/** Wrapping to the start; null when nothing else is left. */
export function nextAfter(items: AsideItem[], threadId: string | undefined): AsideItem | null {
  const ordered = stackOrder(items);
  const raw = threadId ? rawId(threadId) : undefined;
  const at = ordered.findIndex((i) => i.threadId === raw);
  const rest = at < 0 ? ordered : [...ordered.slice(at + 1), ...ordered.slice(0, at)];
  return rest[0] ?? null;
}

/** Answered somewhere else: newer mail whose newest sender is you. */
export function repliedSince(item: AsideItem, thread: Pick<ThreadSummary, 'lastDate' | 'participants'>, me: string[]): boolean {
  const newest = thread.participants.at(-1);
  return thread.lastDate > Math.max(item.lastDate, item.addedAt) && !!newest && isMe(newest.email, me);
}

export function visibleItems(items: AsideItem[]): AsideItem[] {
  return stackOrder(items).filter((i) => inCurrentScope(i.account));
}

export function isAside(items: AsideItem[], threadId: string) {
  const raw = rawId(threadId);
  return items.some((i) => i.threadId === raw);
}

function remove(threadId: string): AsideItem | undefined {
  const raw = rawId(threadId);
  const { items } = useAside.getState();
  const found = items.find((i) => i.threadId === raw);
  if (found) save(items.filter((i) => i.threadId !== raw));
  return found;
}

function restore(item: AsideItem) {
  const { items } = useAside.getState();
  if (!items.some((i) => i.threadId === item.threadId)) save([...items, item]);
}

function openItem(item: AsideItem, reply: boolean) {
  const id = scopedThreadId(item.threadId, item.account);
  navigate({ view: { kind: 'folder', folder: 'inbox' }, threadId: id });
  if (reply) void replyToThread(id, 'reply').catch(() => snack("Couldn't open a reply. Try Reply on the message."));
}

function finishSession() {
  useAside.setState({ session: false });
  navigate({ view: getRoute().view });
  snack("That's everything you set aside");
}

export const aside = {
  add(thread: ThreadSummary) {
    aside.addMany([thread]);
  },
  addMany(threads: ThreadSummary[]) {
    const { items } = useAside.getState();
    const mine = myAddresses(queryClient.getQueryData<Account>(keys.account));
    const now = Date.now();
    const added: AsideItem[] = [];
    for (const thread of threads) {
      const raw = rawId(thread.id);
      if (items.some((i) => i.threadId === raw) || added.some((i) => i.threadId === raw)) continue;
      // The person waiting on you: the newest sender who isn't you.
      const from = [...thread.participants].reverse().find((p) => !isMe(p.email, mine)) ?? thread.participants.at(-1) ?? { email: '' };
      const account = threadAccount(thread.id);
      added.push({
        threadId: raw,
        ...(account ? { account } : {}),
        subject: thread.subject,
        from,
        snippet: thread.snippet,
        addedAt: now,
        lastDate: thread.lastDate,
      });
    }
    if (!added.length) return;
    save([...items, ...added]);
    const ids = added.map((i) => i.threadId);
    snack(added.length === 1 ? 'Moved to Reply later' : `${added.length} conversations moved to Reply later`, {
      action: { label: 'Undo', onClick: () => save(useAside.getState().items.filter((i) => !ids.includes(i.threadId))) },
    });
  },
  done(threadId: string, quiet = false) {
    const item = remove(threadId);
    if (item && !quiet) snack('Removed from Reply later', { action: { label: 'Undo', onClick: () => restore(item) } });
    return item;
  },
  toggle(thread: ThreadSummary) {
    if (isAside(useAside.getState().items, thread.id)) aside.done(thread.id);
    else aside.add(thread);
  },
  /** The oldest, with a reply started. */
  start() {
    const first = visibleItems(useAside.getState().items)[0];
    if (!first) return;
    useAside.setState({ session: true });
    openItem(first, true);
  },
  stop() {
    useAside.setState({ session: false });
  },
  skip(threadId: string) {
    const next = nextAfter(visibleItems(useAside.getState().items), threadId);
    if (next && next.threadId !== rawId(threadId)) openItem(next, true);
  },
  doneAndNext(threadId: string) {
    const visible = visibleItems(useAside.getState().items);
    const next = nextAfter(visible, threadId);
    aside.done(threadId);
    if (!useAside.getState().session) return;
    if (next && next.threadId !== rawId(threadId)) openItem(next, true);
    else finishSession();
  },
  /** Takes it off the stack and, while working through it, opens the next. Returns a function that puts it back, for Undo or a failed send. */
  replying(threadId: string): (() => void) | undefined {
    const visible = visibleItems(useAside.getState().items);
    const next = nextAfter(visible, threadId);
    const item = remove(threadId);
    if (!item) return undefined;
    if (useAside.getState().session) {
      if (next && next.threadId !== item.threadId) openItem(next, true);
      else finishSession();
    }
    return () => restore(item);
  },
  /** Drops items answered elsewhere and refreshes the rest from fresh list data. */
  sync(threads: ThreadSummary[], me: string[]) {
    const { items } = useAside.getState();
    if (!items.length || !me.length) return;
    const byRaw = new Map(threads.map((t) => [rawId(t.id), t]));
    let changed = false;
    const next: AsideItem[] = [];
    for (const item of items) {
      const t = byRaw.get(item.threadId);
      if (t && repliedSince(item, t, me)) {
        changed = true;
        continue;
      }
      if (t && (t.snippet !== item.snippet || t.subject !== item.subject)) {
        changed = true;
        next.push({ ...item, snippet: t.snippet, subject: t.subject });
      } else next.push(item);
    }
    if (changed) save(next);
  },
};
