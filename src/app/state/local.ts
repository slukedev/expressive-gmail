import { create } from 'zustand';
import { readKey, watchKey, writeKey } from './storage';
import { rawId } from '../data/accounts/ids';
import { threadAccount } from '../data/accounts/threads';

/** Features Gmail doesn't have, stored locally. Thread ids are kept without their account prefix so they hold in every scope; read them through rawId(). */
export interface Reminder {
  threadId: string;
  subject: string;
  /** Epoch ms. */
  due: number;
  /** More messages later means a reply came in. */
  messageCount: number;
  createdAt: number;
  /** Lowercased, when known. */
  account?: string;
}

export interface LocalData {
  pinned: string[];
  notes: Record<string, { text: string; updatedAt: number }>;
  reminders: Reminder[];
  /** Senders whose remote images always load. */
  trustedImageSenders: string[];
  recentSearches: string[];
  /** By calendar UID, so invites show how you replied. */
  rsvps: Record<string, 'ACCEPTED' | 'TENTATIVE' | 'DECLINED'>;
  /** New mail from them goes to Spam. */
  blocked: string[];
  /** Sent threads whose "Follow up?" nudge was dismissed. */
  dismissedNudges: string[];
  /** Answered with Looks safe. */
  safeMessages: string[];
  /**
   * "<raw thread id>
   * <to-do text>".
   */
  doneTodos: string[];
}

const EMPTY: LocalData = { pinned: [], notes: {}, reminders: [], trustedImageSenders: [], recentSearches: [], rsvps: {}, blocked: [], dismissedNudges: [], safeMessages: [], doneTodos: [] };
const KEY = 'bg.local.v1';

interface LocalStore extends LocalData {
  update: (fn: (d: LocalData) => Partial<LocalData>) => void;
}

export const useLocal = create<LocalStore>((set, get) => ({
  ...EMPTY,
  update: (fn) => {
    const { update: _u, ...data } = get();
    void _u;
    const next = prune({ ...data, ...fn(data) });
    set(next);
    writeKey(KEY, next).catch(() => undefined);
  },
}));

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Fields of the wrong shape (an old version, a hand edit) reset to empty. */
function sanitize(stored: unknown): LocalData {
  const s = isRecord(stored) ? stored : {};
  const out = { ...EMPTY } as Record<keyof LocalData, unknown>;
  for (const key of Object.keys(EMPTY) as (keyof LocalData)[]) {
    const value = s[key];
    if (Array.isArray(EMPTY[key]) ? Array.isArray(value) : isRecord(value)) out[key] = value;
  }
  return out as unknown as LocalData;
}

/** So years of use stay a few hundred KB. */
export const LOCAL_LIMITS = {
  rsvps: 500,
  trustedImageSenders: 1000,
  blocked: 2000,
  pinned: 1000,
  notes: 5000,
  safeMessages: 1000,
  doneTodos: 300,
  /** Over, answered or not. */
  reminderAgeMs: 60 * 24 * 60 * 60_000,
};

/** By insertion order (the order answers were given). */
const newest = <T,>(record: Record<string, T>, n: number) => {
  const entries = Object.entries(record);
  return entries.length > n ? Object.fromEntries(entries.slice(-n)) : record;
};

/** Old RSVPs, long-past reminders, the oldest of any long list. */
export function prune(d: LocalData, now = Date.now()): LocalData {
  const notes = Object.entries(d.notes);
  return {
    ...d,
    rsvps: newest(d.rsvps, LOCAL_LIMITS.rsvps),
    trustedImageSenders: d.trustedImageSenders.slice(-LOCAL_LIMITS.trustedImageSenders),
    blocked: d.blocked.slice(-LOCAL_LIMITS.blocked),
    safeMessages: d.safeMessages.slice(-LOCAL_LIMITS.safeMessages),
    doneTodos: d.doneTodos.slice(-LOCAL_LIMITS.doneTodos),
    pinned: d.pinned.slice(0, LOCAL_LIMITS.pinned),
    notes: notes.length > LOCAL_LIMITS.notes ? Object.fromEntries(notes.sort(([, a], [, b]) => b.updatedAt - a.updatedAt).slice(0, LOCAL_LIMITS.notes)) : d.notes,
    reminders: d.reminders.filter((r) => now - r.due < LOCAL_LIMITS.reminderAgeMs),
  };
}

export async function loadLocal() {
  useLocal.setState(prune(sanitize(await readKey(KEY))));
  watchKey(KEY, (v) => v && typeof v === 'object' && useLocal.setState(sanitize(v)));
}

export const local = {
  togglePin(id: string) {
    const threadId = rawId(id);
    useLocal.getState().update((d) => ({
      pinned: d.pinned.includes(threadId) ? d.pinned.filter((x) => x !== threadId) : [threadId, ...d.pinned],
    }));
  },
  setNote(id: string, text: string) {
    const threadId = rawId(id);
    useLocal.getState().update((d) => {
      const notes = { ...d.notes };
      if (text.trim()) notes[threadId] = { text, updatedAt: Date.now() };
      else delete notes[threadId];
      return { notes };
    });
  },
  setReminder(r: Reminder | null, id: string) {
    const threadId = rawId(id);
    const account = r?.account ?? threadAccount(id);
    useLocal.getState().update((d) => ({
      reminders: [...d.reminders.filter((x) => x.threadId !== threadId), ...(r ? [{ ...r, threadId, ...(account ? { account } : {}) }] : [])],
    }));
  },
  trustImages(email: string) {
    useLocal.getState().update((d) => ({ trustedImageSenders: [...new Set([...d.trustedImageSenders, email.toLowerCase()])] }));
  },
  addRecentSearch(q: string) {
    const query = q.trim();
    if (!query) return;
    useLocal.getState().update((d) => ({ recentSearches: [query, ...d.recentSearches.filter((s) => s !== query)].slice(0, 8) }));
  },
  setRsvp(uid: string, answer: LocalData['rsvps'][string]) {
    useLocal.getState().update((d) => ({ rsvps: { ...d.rsvps, [uid]: answer } }));
  },
  block(email: string) {
    useLocal.getState().update((d) => ({ blocked: [...new Set([...d.blocked, email.toLowerCase()])] }));
  },
  unblock(email: string) {
    useLocal.getState().update((d) => ({ blocked: d.blocked.filter((e) => e !== email.toLowerCase()) }));
  },
  dismissNudge(threadId: string) {
    useLocal.getState().update((d) => ({ dismissedNudges: [...d.dismissedNudges, rawId(threadId)].slice(-200) }));
  },
  markSafe(messageId: string) {
    useLocal.getState().update((d) => ({ safeMessages: [...new Set([...d.safeMessages, rawId(messageId)])] }));
  },
  setTodoDone(threadId: string, text: string, done: boolean) {
    const key = `${rawId(threadId)}|${text}`;
    useLocal.getState().update((d) => ({ doneTodos: done ? [...new Set([...d.doneTodos, key])] : d.doneTodos.filter((k) => k !== key) }));
  },
  clearRecentSearches() {
    useLocal.getState().update(() => ({ recentSearches: [] }));
  },
};
