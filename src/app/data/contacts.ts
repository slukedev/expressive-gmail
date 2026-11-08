import { useQuery, type QueryCacheNotifyEvent, type QueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useSyncExternalStore } from 'react';
import { readKey, writeKey } from '../state/storage';
import { CONTACTS_KEY } from './cacheKeys';
import { backend, keys } from './client';
import { photos } from './photos';
import { isMe, type Me } from '../lib/format';
import { useAccount, useMe } from './hooks';
import type { Account, Address, Contact, Thread, ThreadPage, ThreadSummary } from './types';

/** Recipient suggestions that work without Google's autocomplete: people the user corresponded with, indexed in this browser from mail the app loads (plus one look at recent Sent), ranked by frequency and recency, merged with the backend's search. */

const DAY = 24 * 60 * 60_000;
export const CONTACT_LIMITS = {
  people: 1_500,
  /** So a re-fetched thread isn't counted twice. */
  seen: 3_000,
  accounts: 3,
  /** Weight halves every this many ms without new mail. */
  halfLifeMs: 45 * DAY,
  sentRefreshMs: 12 * 60 * 60_000,
};

/** Writing to someone says more than receiving from them. */
export const WEIGHT = { wroteTo: 3, heardFrom: 1, cc: 0.5 };

interface Person {
  email: string;
  name?: string;
  /** Decayed weight as of `at`. */
  score: number;
  /** Newest mail with this person, epoch ms. */
  at: number;
}

export interface SavedIndex {
  people: Person[];
  seen: string[];
  sentAt?: number;
  savedAt: number;
}

/** Lowercase, without accents, so "mül" finds "Müller". */
export function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function matchesPrefix(contact: Pick<Contact, 'email' | 'name'>, prefix: string): boolean {
  const p = fold(prefix.trim());
  if (!p) return true;
  const email = fold(contact.email);
  if (email.startsWith(p)) return true;
  const name = fold(contact.name ?? '');
  if (name.startsWith(p)) return true;
  // The start of any word in the name or local part ("smith" in "jane.smith@").
  return `${name} ${email.split('@')[0]}`.split(/[\s._+'-]+/).some((w) => w.startsWith(p));
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUTOMATED = /^(no-?reply|do-?not-?reply|mailer-daemon|notifications?|bounce[s]?)([+.-]|@)/i;

export class ContactIndex {
  private people = new Map<string, Person>();
  private seen = new Set<string>();
  private self = new Set<string>();
  sentAt: number | undefined;
  version = 0;
  private listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /** For another account. */
  reset() {
    this.people = new Map();
    this.seen = new Set();
    this.sentAt = undefined;
    this.changed();
  }

  setSelf(addresses: string[]) {
    this.self = new Set(addresses.map((a) => a.toLowerCase()));
    for (const a of this.self) this.people.delete(a);
  }

  isSelf(email: string) {
    return this.self.has(email.toLowerCase());
  }

  /** Once per observation key (a message or thread version), so mail seen in every refetch adds nothing. */
  observe(key: string, entries: [Address, number][], at: number) {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > CONTACT_LIMITS.seen) this.seen.delete(this.seen.values().next().value!);
    let changed = false;
    for (const [address, weight] of entries) changed = this.add(address, weight, at) || changed;
    if (changed) this.changed();
  }

  private add(address: Address, weight: number, at: number): boolean {
    const email = address.email?.trim();
    if (!email || !EMAIL.test(email) || weight <= 0) return false;
    const key = email.toLowerCase();
    if (this.self.has(key) || AUTOMATED.test(key)) return false;
    const name = address.name?.trim() && address.name.trim().toLowerCase() !== key ? address.name.trim() : undefined;
    const person = this.people.get(key);
    if (!person) {
      this.people.set(key, { email, ...(name ? { name } : {}), score: weight, at });
      if (this.people.size > CONTACT_LIMITS.people) this.prune();
      return true;
    }
    if (at >= person.at) {
      person.score = person.score * decay(at - person.at) + weight;
      person.at = at;
      if (name) person.name = name;
    } else {
      person.score += weight * decay(person.at - at);
      if (name && !person.name) person.name = name;
    }
    return true;
  }

  private prune() {
    const now = this.now();
    const ranked = [...this.people.values()].sort((a, b) => current(b, now) - current(a, now));
    this.people = new Map(ranked.slice(0, Math.floor(CONTACT_LIMITS.people * 0.9)).map((p) => [p.email.toLowerCase(), p]));
  }

  get size() {
    return this.people.size;
  }

  nameOf(email: string): string | undefined {
    return this.people.get(email.trim().toLowerCase())?.name;
  }

  search(prefix: string, limit = 8): Contact[] {
    return this.searchScored(prefix, limit).map((s) => s.contact);
  }

  searchScored(prefix: string, limit = 8): Scored[] {
    if (!prefix.trim()) return [];
    const now = this.now();
    return [...this.people.values()]
      .filter((p) => matchesPrefix(p, prefix))
      .map((p) => ({ p, score: current(p, now) }))
      .sort((a, b) => b.score - a.score || b.p.at - a.p.at)
      .slice(0, limit)
      .map(({ p, score }) => ({ contact: { email: p.email, ...(p.name ? { name: p.name } : {}) }, score }));
  }

  toJSON(): SavedIndex {
    return { people: [...this.people.values()], seen: [...this.seen], ...(this.sentAt ? { sentAt: this.sentAt } : {}), savedAt: this.now() };
  }

  /** Under what this one already learned. */
  restore(saved: SavedIndex | undefined) {
    if (!saved || !Array.isArray(saved.people)) return;
    for (const key of saved.seen ?? []) this.seen.add(key);
    for (const p of saved.people) {
      if (!p?.email || typeof p.score !== 'number' || typeof p.at !== 'number') continue;
      const key = p.email.toLowerCase();
      if (this.self.has(key)) continue;
      const mine = this.people.get(key);
      if (!mine) this.people.set(key, { ...p });
      else {
        const newer = mine.at >= p.at ? mine : p;
        const older = newer === mine ? p : mine;
        mine.score = newer.score + older.score * decay(newer.at - older.at);
        mine.at = newer.at;
        mine.name = newer.name ?? older.name;
      }
    }
    this.sentAt = Math.max(this.sentAt ?? 0, saved.sentAt ?? 0) || undefined;
    if (this.people.size > CONTACT_LIMITS.people) this.prune();
    this.changed();
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
}

function decay(ms: number) {
  return Math.pow(0.5, Math.max(0, ms) / CONTACT_LIMITS.halfLifeMs);
}

function current(p: Person, now: number) {
  return p.score * decay(now - p.at);
}

export function summaryEntries(t: ThreadSummary): [Address, number][] {
  const sent = t.labelIds.includes('SENT');
  return [
    ...t.participants.map((a): [Address, number] => [a, WEIGHT.heardFrom]),
    ...(sent ? (t.recipients ?? []).map((a): [Address, number] => [a, WEIGHT.wroteTo]) : []),
  ];
}

/** Everyone you wrote to, or whoever wrote to you. */
function messageEntries(m: Thread['messages'][number], isSelf: (email: string) => boolean): [Address, number][] {
  if (m.isDraft) return [];
  if (isSelf(m.from.email) || m.labelIds.includes('SENT')) {
    return [...m.to.map((a): [Address, number] => [a, WEIGHT.wroteTo]), ...m.cc.map((a): [Address, number] => [a, WEIGHT.cc])];
  }
  return [[m.from, WEIGHT.heardFrom]];
}

export interface Scored {
  contact: Contact;
  /** 3 for one message written today. */
  score: number;
}

/** The start of the name or address beats the start of a later word. */
function matchStrength(contact: Pick<Contact, 'email' | 'name'>, prefix: string): 0 | 1 | 2 {
  const p = fold(prefix.trim());
  if (!p) return 0;
  if (fold(contact.email).startsWith(p) || fold(contact.name ?? '').startsWith(p)) return 2;
  return matchesPrefix(contact, prefix) ? 1 : 0;
}

/** You come up when you type yourself, below the people you write to. */
const SELF_AFFINITY = 0.3;

/** One list from three sources, like Gmail's: Google's ranking (its order is its affinity), the people this browser saw you mail, and your own addresses. Someone both know ranks higher; a match at the start of a name or address ranks above one inside it. Remote matches that don't start a word (nicknames, companies) stay, after the rest. */
export function rankSuggestions(
  prefix: string,
  sources: { local: Scored[]; remote: Contact[]; self?: Contact[] },
  limit = 8,
): Contact[] {
  const entries = new Map<string, { contact: Contact; local: number; remote: number; self: boolean }>();
  const add = (c: Contact, patch: { local?: number; remote?: number; self?: boolean }, nameWins: boolean) => {
    const key = c.email.trim().toLowerCase();
    if (!key) return;
    const e = entries.get(key);
    if (!e) {
      entries.set(key, { contact: { ...c }, local: patch.local ?? 0, remote: patch.remote ?? 0, self: !!patch.self });
      return;
    }
    e.local = Math.max(e.local, patch.local ?? 0);
    e.remote = Math.max(e.remote, patch.remote ?? 0);
    e.self ||= !!patch.self;
    if (c.name && (nameWins || !e.contact.name)) e.contact.name = c.name;
    if (c.photoUrl && !e.contact.photoUrl) e.contact.photoUrl = c.photoUrl;
  };
  // Names: a saved contact's (Google) over a header's, and your own account's over both.
  sources.local.forEach((s) => add(s.contact, { local: s.score / (s.score + 2) }, false));
  // Google's first answer counts as much as someone you mail every day; later ones a little less each.
  sources.remote.forEach((c, i) => add(c, { remote: 1 / (1 + 0.15 * i) }, true));
  (sources.self ?? []).filter((c) => matchesPrefix(c, prefix)).forEach((c) => add(c, { self: true }, true));

  const ranked = [...entries.values()].map((e) => {
    const affinity = e.self ? SELF_AFFINITY : Math.max(e.local, e.remote) + 0.25 * Math.min(e.local, e.remote);
    const strength = matchStrength(e.contact, prefix);
    return { contact: e.contact, rank: affinity + (strength === 2 ? 0.35 : strength === 1 ? 0.2 : 0) };
  });
  ranked.sort((a, b) => b.rank - a.rank || (a.contact.name ?? a.contact.email).localeCompare(b.contact.name ?? b.contact.email));
  return ranked.slice(0, limit).map((r) => r.contact);
}

export interface RemoteOptions {
  /** After a failure, remote search rests this long. */
  restMs?: number;
  /** Typing pauses this long before a request goes out. */
  debounceMs?: number;
  /** Answers are reused this long. */
  ttlMs?: number;
  maxEntries?: number;
}

interface Answer {
  at: number;
  results: Contact[];
  complete: boolean;
}

const abortError = () => new DOMException('Superseded by newer typing', 'AbortError');

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** `complete` says it held everyone matching the prefix, so a longer prefix can be answered from it. Only the source can know that (a merged inbox missing an account is short without being whole), so a plain list never counts. */
export type SearchAnswer = Contact[] | { contacts: Contact[]; complete: boolean };

/** Asked sparingly: only once typing pauses (a newer keystroke aborts it before it's sent), per prefix, and not at all when a shorter prefix's answer was complete. Google's endpoint is undocumented, so failures never show per keystroke: remote search rests and one breadcrumb says why. */
export class RemoteContacts {
  private restUntil = 0;
  private reported = false;
  lastError: string | undefined;
  private readonly answers = new Map<string, Answer>();
  private readonly pending = new Map<string, Promise<Contact[]>>();
  private readonly o: Required<RemoteOptions>;

  constructor(
    private readonly search: (prefix: string) => Promise<SearchAnswer>,
    private readonly now: () => number = Date.now,
    options: RemoteOptions | number = {},
  ) {
    const given = typeof options === 'number' ? { restMs: options } : options;
    this.o = { restMs: 2 * 60_000, debounceMs: 0, ttlMs: 5 * 60_000, maxEntries: 200, ...given };
  }

  /** Bumped by reset: an answer arriving after it belongs to the account before. */
  private generation = 0;

  /** For another account. */
  reset() {
    this.generation++;
    this.answers.clear();
    this.pending.clear();
    this.restUntil = 0;
  }

  /** Without asking. */
  cached(prefix: string): Contact[] | undefined {
    const key = fold(prefix.trim());
    if (!key) return [];
    const exact = this.fresh(key);
    if (exact) return exact.results;
    for (let n = key.length - 1; n > 0; n--) {
      const shorter = this.fresh(key.slice(0, n));
      if (shorter?.complete) return shorter.results.filter((c) => matchesPrefix(c, prefix));
    }
    return undefined;
  }

  /** Rejects only with an AbortError; any other failure answers []. */
  async query(prefix: string, signal?: AbortSignal): Promise<Contact[]> {
    const key = fold(prefix.trim());
    if (!key) return [];
    const known = this.cached(prefix);
    if (known) return known;
    if (this.now() < this.restUntil) return [];
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    if (this.o.debounceMs > 0) {
      await pause(this.o.debounceMs, signal);
      const settled = this.cached(prefix) ?? (await this.pending.get(key));
      if (settled) return settled;
    }
    if (this.now() < this.restUntil) return [];
    const generation = this.generation;
    const request = this.ask(key, prefix.trim(), generation).finally(() => {
      if (this.pending.get(key) === request) this.pending.delete(key);
    });
    this.pending.set(key, request);
    return request;
  }

  private async ask(key: string, prefix: string, generation: number): Promise<Contact[]> {
    try {
      const answer = await this.search(prefix);
      if (generation !== this.generation) return [];
      const results = Array.isArray(answer) ? answer : answer.contacts;
      const complete = !Array.isArray(answer) && answer.complete;
      this.answers.delete(key);
      this.answers.set(key, { at: this.now(), results, complete });
      if (this.answers.size > this.o.maxEntries) this.answers.delete(this.answers.keys().next().value!);
      return results;
    } catch (err) {
      if (generation !== this.generation) return [];
      this.restUntil = this.now() + this.o.restMs;
      this.lastError = String((err as Error)?.message ?? err);
      if (!this.reported) {
        this.reported = true;
        // eslint-disable-next-line no-console -- development breadcrumb
        if (import.meta.env?.DEV) console.debug(`[expressive-gmail] contact search failed, using local suggestions: ${this.lastError}`);
      }
      return [];
    }
  }

  /** The name a recent answer gave `email`, if any. */
  nameOf(email: string): string | undefined {
    const key = email.trim().toLowerCase();
    for (const a of this.answers.values()) {
      const name = a.results.find((c) => c.email.toLowerCase() === key && c.name)?.name;
      if (name) return name;
    }
    return undefined;
  }

  private fresh(key: string): Answer | undefined {
    const a = this.answers.get(key);
    return a && this.now() - a.at < this.o.ttlMs ? a : undefined;
  }
}

export const contactIndex = new ContactIndex();
const remoteContacts = new RemoteContacts((prefix) => backend().searchContacts(prefix), Date.now, { debounceMs: 120 });

interface ScopeState {
  scope: string;
  stop: () => void;
}
let active: ScopeState | undefined;

/** Feeds the index for one account from every list and thread the app loads, restores what was saved, and once in a while reads recent Sent mail. */
export function startContactIndex(
  client: QueryClient,
  scope: string,
  self: string[],
  options: { sentDelayMs?: number; read?: () => Promise<unknown>; write?: (v: unknown) => Promise<void> } = {},
): () => void {
  active?.stop();
  const read = options.read ?? (() => readKey(CONTACTS_KEY));
  const write = options.write ?? ((v: unknown) => writeKey(CONTACTS_KEY, v));
  const index = contactIndex;
  index.reset();
  remoteContacts.reset();
  index.setSelf(self);
  let stopped = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let sentTimer: ReturnType<typeof setTimeout> | undefined;

  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      if (stopped) return;
      const all = ((await read().catch(() => undefined)) ?? {}) as Record<string, SavedIndex>;
      const next = { ...all, [scope]: index.toJSON() };
      const kept = Object.entries(next)
        .sort(([, a], [, b]) => (b?.savedAt ?? 0) - (a?.savedAt ?? 0))
        .slice(0, CONTACT_LIMITS.accounts);
      await write(Object.fromEntries(kept)).catch(() => undefined);
    }, 2_000);
  };

  const feedPage = (page: ThreadPage) => {
    for (const t of page.threads) index.observe(`t:${t.id}:${t.lastDate}:${t.messageCount}`, summaryEntries(t), t.lastDate);
  };
  const feedThread = (t: Thread) => {
    for (const m of t.messages) index.observe(`m:${m.id}`, messageEntries(m, (e) => index.isSelf(e)), m.date);
  };
  const feed = (key: readonly unknown[], data: unknown) => {
    if (!data) return;
    if (key[0] === keys.allThreads[0]) (data as { pages?: ThreadPage[] }).pages?.forEach(feedPage);
    else if (key[0] === 'thread' && (data as Thread).messages) feedThread(data as Thread);
  };

  const unsubscribe = index.subscribe(save);
  const unwatch = client.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (event.type === 'updated' && event.action.type === 'success' && !event.action.manual) feed(event.query.queryKey, event.query.state.data);
  });

  void read()
    .catch(() => undefined)
    .then((all) => {
      if (stopped) return;
      index.restore((all as Record<string, SavedIndex> | undefined)?.[scope]);
      // Whatever was already loaded before the saved index arrived.
      for (const q of client.getQueryCache().getAll()) feed(q.queryKey, q.state.data);
      if (index.sentAt && Date.now() - index.sentAt < CONTACT_LIMITS.sentRefreshMs) return;
      sentTimer = setTimeout(async () => {
        try {
          const page = await backend().listThreads({ q: 'in:sent', pageSize: 50 });
          if (stopped) return;
          feedPage(page);
          index.sentAt = Date.now();
          save();
        } catch {
          // Tried again next session.
        }
      }, options.sentDelayMs ?? 3_000);
    });

  const stop = () => {
    stopped = true;
    clearTimeout(sentTimer);
    clearTimeout(saveTimer);
    unwatch();
    unsubscribe();
    if (active?.stop === stop) active = undefined;
  };
  active = { scope, stop };
  return stop;
}

/** From the suggestions on screen (your own and Google's names), then Google's recent answers, then the people this browser saw you mail. */
export function knownName(email: string, shown: Contact[] = []): string | undefined {
  const key = email.trim().toLowerCase();
  return shown.find((c) => c.email.toLowerCase() === key && c.name)?.name ?? remoteContacts.nameOf(key) ?? contactIndex.nameOf(key);
}

/** The account, its send-as aliases and, in a merged view, every member's. */
export function selfContacts(account: Account | undefined, me: Me): Contact[] {
  if (!account) return [];
  const accounts = [account, ...(account.members ?? [])];
  const all: Contact[] = accounts.flatMap((a) => [
    { email: a.email, ...(a.name ? { name: a.name } : {}), ...(a.photoUrl ? { photoUrl: a.photoUrl } : {}) },
    ...(a.sendAs ?? []).map((s) => ({ email: s.email, ...((s.name ?? a.name) ? { name: s.name ?? a.name } : {}) })),
  ]);
  const seen = new Set<string>();
  return all.filter((c) => {
    const key = c.email.toLowerCase();
    if (seen.has(key) || !isMe(key, me)) return false;
    seen.add(key);
    return true;
  });
}

/** Local matches and your own addresses at once, ranked with the backend's search when it answers. Never throws. */
export function useContactSuggestions(text: string, limit = 6): Contact[] {
  const prefix = text.trim();
  const version = useSyncExternalStore(
    (fn) => contactIndex.subscribe(fn),
    () => contactIndex.version,
  );
  const me = useMe();
  const { data: account } = useAccount();
  const self = useMemo(() => selfContacts(account, me), [account, me]);
  // `version` changes whenever the index learns someone new.
  const local = useMemo(() => (version >= 0 ? contactIndex.searchScored(prefix, limit + 6) : []), [prefix, limit, version]);
  const remoteQuery = useQuery({
    queryKey: keys.contacts(fold(prefix)),
    queryFn: async ({ signal }) => {
      const found = await remoteContacts.query(prefix, signal);
      for (const c of found) photos.remember(c.email, c.photoUrl);
      return found;
    },
    enabled: prefix.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
  const remoteResults = useMemo(() => {
    const data = remoteQuery.data ?? [];
    // Results kept from the previous prefix only count while they still match.
    return remoteQuery.isPlaceholderData ? data.filter((c) => matchesPrefix(c, prefix)) : data;
  }, [remoteQuery.data, remoteQuery.isPlaceholderData, prefix]);
  const shown = useRef<{ prefix: string; list: Contact[] }>({ prefix: '', list: [] });
  return useMemo(() => {
    if (!prefix) return [];
    const ranked = rankSuggestions(prefix, { local, remote: remoteResults, self }, limit + 6);
    // While the prefix stays the same, a late answer can't move the first suggestion (the one Enter picks).
    const previous = shown.current.prefix === prefix ? shown.current.list.slice(0, 1) : [];
    const list = keepOrder(previous, ranked).slice(0, limit + 6);
    shown.current = { prefix, list };
    return list;
  }, [prefix, local, remoteResults, self, limit]);
}

/** Entries already in `previous` keep their places; the rest follow. */
function keepOrder(previous: Contact[], next: Contact[]): Contact[] {
  const byEmail = new Map(next.map((c) => [c.email.toLowerCase(), c]));
  const kept = previous.map((c) => byEmail.get(c.email.toLowerCase())).filter((c): c is Contact => !!c);
  const keptSet = new Set(kept.map((c) => c.email.toLowerCase()));
  return [...kept, ...next.filter((c) => !keptSet.has(c.email.toLowerCase()))];
}
