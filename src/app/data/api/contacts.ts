/**
 * People API searchContacts + otherContacts:search, falling back to recent correspondents without the contacts scopes.
 * People API search must be warmed with an empty query first (its "Search the user's contacts" guide); once per instance and endpoint.
 * otherContacts:search can't return photos (its readMask doesn't allow them), so photos come from one listing of contacts instead.
 */
import type { Address, Contact } from '../types';
import { BackendError } from '../backend';
import { matchesPrefix } from '../contacts';
import { dedupeAddresses, parseAddressList } from './address';
import type { GmailThread, GmailThreadList, PeoplePerson, PeopleSearchResponse } from './gmail-types';
import { GMAIL_API, PEOPLE_API, unwrapBatch, type HttpClient } from './http';
import { header } from './payload';

const RECENT_TTL_MS = 30 * 60 * 1000;
const PHOTO_BOOK_TTL_MS = 30 * 60 * 1000;
const LIMIT = 15;
/** Pages of 1000; enough for nearly everyone, bounded for the rest. */
const BOOK_PAGES = 3;

interface Endpoint {
  path: string;
  readMask: string;
  warmed: boolean;
  /** Scope not granted, endpoint gone, or a request it can't take. */
  disabled: boolean;
}

interface PeopleListResponse {
  connections?: PeoplePerson[];
  otherContacts?: PeoplePerson[];
  nextPageToken?: string;
}

function personToContacts(person: PeoplePerson | undefined): Contact[] {
  if (!person) return [];
  const name = person.names?.[0]?.displayName;
  const photo = person.photos?.find((p) => !p.default)?.url;
  return (person.emailAddresses ?? [])
    .map((e) => e.value?.trim())
    .filter((e): e is string => !!e && e.includes('@'))
    .map((email) => ({ email, ...(name ? { name } : {}), ...(photo ? { photoUrl: photo } : {}) }));
}

/** Errors that will repeat on every call. */
const lasting = (err: unknown) => err instanceof BackendError && !err.retryable && err.code !== 'unauthenticated';

export class ContactSearch {
  private readonly endpoints: Endpoint[] = [
    { path: '/people:searchContacts', readMask: 'names,emailAddresses,photos', warmed: false, disabled: false },
    { path: '/otherContacts:search', readMask: 'names,emailAddresses', warmed: false, disabled: false },
  ];
  private recent?: { at: number; contacts: Contact[] };
  private recentLoading?: Promise<Contact[]>;
  private book?: { at: number; photos: Map<string, string> };
  private bookLoading?: Promise<Map<string, string> | undefined>;

  constructor(
    private readonly http: HttpClient,
    private readonly now: () => number = Date.now,
  ) {}

  private async query(endpoint: Endpoint, query: string): Promise<Contact[]> {
    const res = await this.http.request<PeopleSearchResponse>(`${PEOPLE_API}${endpoint.path}`, {
      query: { query, readMask: endpoint.readMask, pageSize: LIMIT },
    });
    return (res?.results ?? []).flatMap((r) => personToContacts(r.person));
  }

  private async searchEndpoint(endpoint: Endpoint, prefix: string): Promise<Contact[]> {
    if (endpoint.disabled) return [];
    try {
      if (!endpoint.warmed) {
        await this.query(endpoint, '');
        endpoint.warmed = true;
      }
      return await this.query(endpoint, prefix);
    } catch (err) {
      if (lasting(err)) {
        endpoint.disabled = true;
        return [];
      }
      throw err;
    }
  }

  /** Most frequent first. Cached for 30 minutes. */
  async recentCorrespondents(): Promise<Contact[]> {
    if (this.recent && this.now() - this.recent.at < RECENT_TTL_MS) return this.recent.contacts;
    this.recentLoading ??= this.loadRecent().finally(() => {
      this.recentLoading = undefined;
    });
    return this.recentLoading;
  }

  private async loadRecent(): Promise<Contact[]> {
    const list = await this.http.request<GmailThreadList>(`${GMAIL_API}/threads`, {
      query: { q: 'in:sent', maxResults: 50 },
    });
    const ids = (list?.threads ?? []).map((t) => t.id);
    const counts = new Map<string, { address: Address; count: number }>();
    if (ids.length) {
      const results = await this.http.batch(
        ids.map((id) => ({
          method: 'GET' as const,
          path: `/gmail/v1/users/me/threads/${encodeURIComponent(id)}?format=metadata&metadataHeaders=To&metadataHeaders=Cc`,
        })),
      );
      for (const thread of unwrapBatch<GmailThread>(results, { ignoreNotFound: true })) {
        for (const m of thread?.messages ?? []) {
          if (!(m.labelIds ?? []).includes('SENT')) continue;
          const addresses = [
            ...parseAddressList(header(m.payload?.headers, 'To')),
            ...parseAddressList(header(m.payload?.headers, 'Cc')),
          ];
          for (const a of addresses) {
            const key = a.email.toLowerCase();
            const entry = counts.get(key);
            if (entry) {
              entry.count++;
              if (!entry.address.name && a.name) entry.address.name = a.name;
            } else counts.set(key, { address: { ...a }, count: 1 });
          }
        }
      }
    }
    const contacts = [...counts.values()].sort((a, b) => b.count - a.count).map((e) => e.address);
    this.recent = { at: this.now(), contacts };
    return contacts;
  }

  /** By lowercased address; undefined when neither can be listed. */
  private photoBook(): Promise<Map<string, string> | undefined> {
    if (this.book && this.now() - this.book.at < PHOTO_BOOK_TTL_MS) return Promise.resolve(this.book.photos);
    this.bookLoading ??= this.loadBook().finally(() => {
      this.bookLoading = undefined;
    });
    return this.bookLoading;
  }

  private async loadBook(): Promise<Map<string, string> | undefined> {
    const lists = [
      { path: '/people/me/connections', query: { personFields: 'emailAddresses,photos' }, key: 'connections' as const },
      { path: '/otherContacts', query: { readMask: 'emailAddresses,photos' }, key: 'otherContacts' as const },
    ];
    const photos = new Map<string, string>();
    let listed = false;
    for (const list of lists) {
      let pageToken: string | undefined;
      try {
        for (let page = 0; page < BOOK_PAGES; page++) {
          const res = await this.http.request<PeopleListResponse>(`${PEOPLE_API}${list.path}`, {
            query: { ...list.query, pageSize: 1000, ...(pageToken ? { pageToken } : {}) },
          });
          listed = true;
          for (const c of (res?.[list.key] ?? []).flatMap(personToContacts)) {
            const key = c.email.toLowerCase();
            if (c.photoUrl && !photos.has(key)) photos.set(key, c.photoUrl);
          }
          pageToken = res?.nextPageToken;
          if (!pageToken) break;
        }
      } catch {
        // Missing scope or a hiccup: the other listing may still answer.
      }
    }
    if (!listed) return undefined;
    this.book = { at: this.now(), photos };
    return photos;
  }

  /** The People API can't see the photo of someone who is neither a saved nor an other contact; Gmail gets those from People Stack, which only answers a signed-in Gmail page. They show their initial here. */
  async photos(emails: string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()))].filter((e) => e.includes('@'));
    const book = await this.photoBook();
    const out: Record<string, string> = {};
    if (book) {
      for (const email of wanted) {
        const url = book.get(email);
        if (url) out[email] = url;
      }
      return out;
    }
    // No listing allowed: a saved-contacts search per address, a few at a time.
    const queue = [...wanted];
    const worker = async () => {
      for (let email = queue.shift(); email; email = queue.shift()) {
        const found = await this.searchEndpoint(this.endpoints[0]!, email).catch(() => []);
        const url = found.find((c) => c.email.toLowerCase() === email && c.photoUrl)?.photoUrl;
        if (url) out[email] = url;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
    return out;
  }

  /** Saved contacts first, then other contacts, then recent correspondents. */
  async search(prefix: string): Promise<Contact[]> {
    const settled = await Promise.allSettled(this.endpoints.map((e) => this.searchEndpoint(e, prefix)));
    let results = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (this.endpoints.every((e) => e.disabled) || results.length < LIMIT) {
      const recent = (await this.recentCorrespondents().catch(() => [])).filter((c) => matchesPrefix(c, prefix));
      results = [...results, ...recent];
    }
    // Nothing at all and a real failure: throw, so the caller can rest instead of retrying per keystroke.
    if (!results.length && failed) throw failed.reason;
    return dedupeAddresses(results).slice(0, LIMIT);
  }
}
