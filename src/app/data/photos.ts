import { useEffect, useSyncExternalStore } from 'react';
import { readKey, writeKey } from '../state/storage';
import { MIN_LOGO_PX, bimiLogo, bimiSelectorOf, brandDomain, faviconUrl, imageWidth, logoHosts, orgDomain } from './brands';
import { personLabel, photoLog } from './photoLog';
import { tag } from '../../session/shape';
import { PHOTOS_KEY } from './cacheKeys';
import { cap } from '../../shared/bounded';
import { backend } from './client';
import { demoLogo } from './demo/logos';
import { MONOGRAM_MARK } from '../../session/contacts';
import { isGooglePlaceholder } from '../ui/avatarFit';

/** Pictures for avatars: people get their profile photo from the backend (`lookupPhotos`), organisations their brand logo from Google's favicon service, one lookup per domain. Avatars rendered in the same tick are looked up together; every answer, misses included, is kept per account in memory and storage. */

export interface Photo {
  url: string;
  kind: 'person' | 'brand';
  /** A brand's verified (BIMI) logo: a square mark made to fill the circle, as Gmail shows it. */
  verified?: true;
}

const HOUR = 60 * 60_000;
export const PHOTO_LIMITS = {
  hitTtlMs: 7 * 24 * HOUR,
  missTtlMs: 24 * HOUR,
  /** A failed lookup is retried after this long. */
  errorTtlMs: 10 * 60_000,
  brandHitTtlMs: 30 * 24 * HOUR,
  brandMissTtlMs: 7 * 24 * HOUR,
  /** A logo that failed to load at all (offline, blocked). */
  brandErrorTtlMs: 24 * HOUR,
  batch: 25,
  brandConcurrency: 4,
  perAccount: 1_500,
  brandsPerAccount: 500,
  accounts: 3,
  /** Per map, while the tab stays open. */
  inMemory: 4_000,
};

/** [url or null for none, checked at epoch ms] */
type Stored = [string | null, number];
/** Bumped when misses saved by earlier builds can't be trusted. */
const STORE_VERSION = 5;

interface Saved {
  v?: number;
  savedAt: number;
  photos: Record<string, Stored>;
  brands?: Record<string, Stored>;
}
type Store = Record<string, Saved>;

export interface PhotoCacheDeps {
  lookup: () => ((emails: string[]) => Promise<Record<string, string>>) | undefined;
  read: () => Promise<unknown>;
  write: (store: Store) => Promise<void>;
  /** True for Google's generic silhouette, which some lookups hand out as a photo. */
  placeholder?: (url: string) => Promise<boolean>;
  /** 0 when it doesn't load. */
  imageWidth?: (url: string) => Promise<number>;
  /** The demo's invented brands, used instead of Google's favicon service. */
  logo?: (domain: string) => string | undefined;
  /** Undefined when DNS can't be asked from here. */
  bimi?: (host: string, selector?: string) => Promise<string[] | undefined>;
  now?: () => number;
  batchDelayMs?: number;
  saveDelayMs?: number;
}

const norm = (email: string) => email.trim().toLowerCase();

/** Inline images Gmail hands over are stored only while small and few, to stay under storage limits; bigger ones live in memory and come back with the next mail read. */
const STORED_INLINE = { maxChars: 40_000, count: 150 };

function storable(people: Map<string, Stored>): Map<string, Stored> {
  let inline = 0;
  const out = new Map<string, Stored>();
  for (const [key, value] of [...people].sort(([, a], [, b]) => b[1] - a[1])) {
    const url = value[0];
    if (url?.startsWith('data:') && (url.length > STORED_INLINE.maxChars || ++inline > STORED_INLINE.count)) continue;
    out.set(key, value);
  }
  return out;
}

/** A backend's lookupPhotos may add how it answered under this key: JSON of {steps: {address: [step]}, template?}. */
const PHOTO_HOW_KEY = '#how';

function readHow(found: Record<string, string> | undefined): { steps: Record<string, string[]> } {
  const raw = found?.[PHOTO_HOW_KEY];
  if (!raw) return { steps: {} };
  try {
    const parsed = JSON.parse(raw) as { steps?: Record<string, string[]>; template?: string; dumps?: { source: string; shape: string }[] };
    if (parsed.template !== undefined) photoLog.setTemplate(parsed.template);
    for (const d of parsed.dumps ?? []) if (typeof d?.source === 'string' && typeof d.shape === 'string') photoLog.addDump(d.source, d.shape);
    return { steps: parsed.steps ?? {} };
  } catch {
    return { steps: {} };
  }
}

export class PhotoCache {
  private readonly now: () => number;
  private scope: string | undefined;
  private ownEmail: string | undefined;
  private loaded: Promise<void> = Promise.resolve();
  private preloading: Promise<void> | undefined;
  private preloaded: { raw: unknown } | undefined;
  private people = new Map<string, Stored>();
  private brands = new Map<string, Stored>();
  /** Once a request decided that. */
  private brandOf = new Map<string, string>();
  /** From the first sender seen at each brand domain. */
  private hostsOf = new Map<string, string[]>();
  private snapshots = new Map<string, Photo | undefined>();
  /** To tell brands from people again after an account switch. */
  private names = new Map<string, string>();
  private queued = new Set<string>();
  private peopleBusy = false;
  private inflight = new Set<string>();
  private brandQueue = new Set<string>();
  private brandInflight = new Set<string>();
  /** Saved under "bimi:<domain>" in `brands`. */
  private orgOf = new Map<string, string>();
  private bimiQueue = new Set<string>();
  private bimiInflight = new Set<string>();
  /** From a sender's BIMI-Selector header ("nytimes.com" -> "nyt"). */
  private selectorOf = new Map<string, string>();
  private listeners = new Map<string, Set<() => void>>();
  /** Never offered again this session. */
  private readonly brokenUrls = new Set<string>();
  /** Already in the photo log this session. */
  private readonly logged = new Set<string>();
  private requests = 0;

  /** A tab open for weeks sees thousands of senders; memory keeps the most recent. Anyone dropped is looked up again when shown. */
  private trim() {
    const max = PHOTO_LIMITS.inMemory;
    for (const m of [this.people, this.brands, this.brandOf, this.orgOf, this.hostsOf, this.names, this.snapshots, this.logged, this.selectorOf]) cap(m, max);
  }
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: PhotoCacheDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** `scope` is "<backend>:<address>", e.g. "session:ada@example.com". */
  setScope(scope: string | undefined) {
    if (scope === this.scope) return;
    clearTimeout(this.saveTimer);
    this.scope = scope;
    this.ownEmail = scope?.slice(scope.indexOf(':') + 1);
    this.people = new Map();
    this.brands = new Map();
    this.brandOf = new Map();
    this.inflight.clear();
    this.brandInflight.clear();
    this.brandQueue.clear();
    const again = new Set([...this.queued, ...this.listeners.keys()]);
    this.queued = new Set();
    this.notifyAll();
    if (!scope) {
      this.queued = again;
      return;
    }
    // Read ahead (see preload), so saved answers are in before the first avatar renders.
    const preloaded = this.preloaded;
    this.preloaded = undefined;
    this.preloading = undefined;
    if (preloaded) {
      this.adopt(scope, preloaded.raw);
      this.loaded = Promise.resolve();
    } else {
      this.loaded = this.deps
        .read()
        .catch(() => undefined)
        .then((raw) => this.adopt(scope, raw));
    }
    // Everyone on screen or already asked for is looked up again for this account.
    for (const key of again) this.request(key, this.names.get(key));
    this.scheduleFlush();
  }

  private adopt(scope: string, raw: unknown) {
    if (this.scope !== scope) return;
    const saved = (raw as Store | undefined)?.[scope];
    const current = saved?.v === STORE_VERSION;
    // An older build's answers are dropped, photos too: one could be a placeholder it took for a photo.
    for (const [email, value] of Object.entries(current ? (saved?.photos ?? {}) : {})) {
      if (Array.isArray(value) && !this.people.has(email)) this.people.set(email, value);
    }
    for (const [domain, value] of Object.entries(current ? (saved?.brands ?? {}) : {})) {
      if (!Array.isArray(value) || this.brands.has(domain)) continue;
      this.brands.set(domain, value);
    }
    this.notifyAll();
  }

  /** Before the account is known, so a reload paints the cached inbox with photos instead of initials first. */
  preload(): Promise<void> {
    this.preloading ??= this.deps
      .read()
      .catch(() => undefined)
      .then((raw) => {
        this.preloaded = { raw };
      });
    return this.preloading;
  }

  /** For an avatar that already has a photo from the mail itself. */
  requestVerified(email: string) {
    const key = norm(email);
    if (key.includes('@')) this.askVerified(key);
  }

  /** Never starts a lookup. */
  peekVerified(email: string): Photo | undefined {
    const photo = this.peek(email);
    return photo?.verified ? photo : undefined;
  }

  private askVerified(key: string) {
    if (this.deps.bimi && !this.orgOf.has(key)) {
      const org = orgDomain(key, this.ownEmail);
      if (org) {
        this.orgOf.set(key, org);
        this.snapshots.delete(key);
        if (!this.hostsOf.has(`bimi:${org}`)) this.hostsOf.set(`bimi:${org}`, logoHosts(key));
      }
    }
    const org = this.orgOf.get(key);
    if (org && !this.bimiQueue.has(org) && !this.bimiInflight.has(org) && !this.isFresh(this.brands.get(`bimi:${org}`), 'brand')) {
      this.bimiQueue.add(org);
      this.scheduleFlush();
    }
  }

  /** Some senders publish their verified logo under a selector of their own (The New York Times under "nyt"), which only their mail names. */
  bimiSelector(email: string, header: string | undefined) {
    const selector = bimiSelectorOf(header);
    const key = norm(email);
    const org = this.orgOf.get(key) ?? (this.deps.bimi ? orgDomain(key, this.ownEmail) : undefined);
    if (!selector || !org || this.selectorOf.get(org) === selector) return;
    this.selectorOf.set(org, selector);
    this.orgOf.set(key, org);
    if (!this.hostsOf.has(`bimi:${org}`)) this.hostsOf.set(`bimi:${org}`, logoHosts(key));
    if (this.brands.get(`bimi:${org}`)?.[0]) return;
    this.brands.delete(`bimi:${org}`);
    if (!this.bimiInflight.has(org)) {
      this.bimiQueue.add(org);
      this.scheduleFlush();
    }
  }

  /** Forgets every saved answer for this account and looks up everyone on screen again. */
  reset() {
    this.people.clear();
    this.brands.clear();
    this.brokenUrls.clear();
    this.logged.clear();
    photoLog.clear();
    for (const key of this.listeners.keys()) this.request(key, this.names.get(key));
    this.notifyAll();
    this.scheduleSave();
  }

  /** Never starts a lookup. Stable between changes. */
  peek(email: string): Photo | undefined {
    const key = norm(email);
    if (!this.snapshots.has(key)) this.snapshots.set(key, this.resolve(key));
    return this.snapshots.get(key);
  }

  private resolve(key: string): Photo | undefined {
    // A verified logo first, as Gmail shows it ahead of a profile photo.
    const org = this.orgOf.get(key);
    const verified = org ? this.brands.get(`bimi:${org}`)?.[0] : undefined;
    if (verified && !this.brokenUrls.has(verified)) return { url: verified, kind: 'brand', verified: true };
    const person = this.people.get(key)?.[0];
    // An organisation's own picture, and any inline image (a verified sender's logo), sit like logos.
    if (person && !this.brokenUrls.has(person)) return { url: person, kind: this.brandOf.has(key) || person.startsWith('data:') ? 'brand' : 'person' };
    const domain = this.brandOf.get(key);
    const logo = domain ? this.brands.get(domain)?.[0] : undefined;
    return logo && !this.brokenUrls.has(logo) ? { url: logo, kind: 'brand' } : undefined;
  }

  /** `name` is the sender's display name, which helps tell brands from people. */
  request(email: string, name?: string) {
    const key = norm(email);
    if (!key.includes('@')) return;
    if (++this.requests % 256 === 0) this.trim();
    if (name) this.names.set(key, name);
    if (!this.brandOf.has(key)) {
      const domain = brandDomain(key, name, this.ownEmail, (d) => !!this.deps.logo?.(d));
      if (domain) {
        this.brandOf.set(key, domain);
        if (!this.hostsOf.has(domain)) this.hostsOf.set(domain, logoHosts(key));
        this.snapshots.delete(key);
      }
    }
    this.askVerified(key);
    const domain = this.brandOf.get(key);
    const saved = this.people.get(key);
    if (saved && this.isFresh(saved, 'person') && !this.logged.has(key)) {
      this.logged.add(key);
      const when = new Date(saved[1]).toTimeString().slice(0, 5);
      photoLog.add({ who: domain ?? personLabel(key), kind: domain ? 'brand' : 'person', steps: [`saved answer from ${when}: ${saved[0] ? `photo ${tag(saved[0])}` : 'no photo'}`], result: saved[0] ? 'hit' : 'miss' });
    }
    let asked = false;
    // Everyone is asked of the backend: for an organisation that's the logo Gmail itself shows, which beats a favicon.
    if (!this.queued.has(key) && !this.inflight.has(key) && !this.isFresh(this.people.get(key), 'person')) {
      this.queued.add(key);
      asked = true;
    }
    // Organisations also get their site's logo, for when Gmail has none.
    if (domain && !this.brandQueue.has(domain) && !this.brandInflight.has(domain) && !this.isFresh(this.brands.get(domain), 'brand')) {
      this.brandQueue.add(domain);
      asked = true;
    }
    if (asked) this.scheduleFlush();
  }

  /** Learned elsewhere (contact suggestions, the account itself). */
  remember(email: string, url: string | undefined) {
    if (!url || this.brokenUrls.has(url)) return;
    const key = norm(email);
    if (this.people.get(key)?.[0] === url) return;
    this.people.set(key, [url, this.now()]);
    this.notify(key);
    this.scheduleSave();
  }

  /** Dropped, so the next request looks the person up again, and a lookup answering with it again counts as no photo. */
  broken(email: string, url: string) {
    if (this.brokenUrls.has(url)) return;
    if (this.brokenUrls.size > 500) this.brokenUrls.delete(this.brokenUrls.values().next().value!);
    this.brokenUrls.add(url);
    const key = norm(email);
    if (this.people.get(key)?.[0] === url) this.people.delete(key);
    this.notify(key);
  }

  isBroken(url: string) {
    return this.brokenUrls.has(url);
  }

  subscribe(email: string, fn: () => void): () => void {
    const key = norm(email);
    let set = this.listeners.get(key);
    if (!set) this.listeners.set(key, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (!set!.size) this.listeners.delete(key);
    };
  }

  private isFresh(entry: Stored | undefined, kind: Photo['kind']): boolean {
    if (!entry) return false;
    const [url, at] = entry;
    const ttl =
      kind === 'brand'
        ? url ? PHOTO_LIMITS.brandHitTtlMs : PHOTO_LIMITS.brandMissTtlMs
        : url ? PHOTO_LIMITS.hitTtlMs : PHOTO_LIMITS.missTtlMs;
    return this.now() - at < ttl;
  }

  private scheduleFlush() {
    if (this.flushTimer !== undefined) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, this.deps.batchDelayMs ?? 16);
  }

  private async flush() {
    const scope = this.scope;
    if (!scope) return;
    await this.loaded;
    if (this.scope !== scope) return;
    await Promise.all([this.flushPeople(scope), this.flushBrands(scope), this.flushBimi(scope)]);
  }

  /** Whatever queues meanwhile goes in the next batch. */
  private async flushPeople(scope: string) {
    if (this.peopleBusy) return;
    this.peopleBusy = true;
    try {
      await this.lookupPeople(scope);
    } finally {
      this.peopleBusy = false;
      if (this.queued.size) this.scheduleFlush();
    }
  }

  private async lookupPeople(scope: string) {
    const lookup = this.deps.lookup();
    if (!lookup) {
      if (!this.logged.has('*lookup')) {
        this.logged.add('*lookup');
        photoLog.add({ who: '*', kind: 'person', steps: ['this connection has no photo lookup'], result: 'error' });
      }
      return;
    }
    // Requests answered by the stored cache leave the queue.
    for (const key of [...this.queued]) if (this.isFresh(this.people.get(key), 'person')) this.queued.delete(key);
    const batch = [...this.queued].slice(0, PHOTO_LIMITS.batch);
    for (const key of batch) {
      this.queued.delete(key);
      this.inflight.add(key);
    }
    if (!batch.length) return;
    let found: Record<string, string> | undefined;
    let failure = '';
    try {
      found = await lookup(batch);
    } catch (err) {
      found = undefined;
      failure = String((err as { code?: string; message?: string })?.code ?? (err as Error)?.message ?? err);
    }
    // The backend may say how it got each answer, under keys that aren't addresses.
    const how = readHow(found);
    if (this.scope !== scope) return;
    const now = this.now();
    for (const key of batch) {
      this.inflight.delete(key);
      const url = found?.[key];
      if (url && !this.brokenUrls.has(url)) this.people.set(key, [url, now]);
      else if (found) this.people.set(key, [null, now]);
      // A failed lookup is a miss that expires soon.
      else if (!this.people.has(key)) this.people.set(key, [null, now - PHOTO_LIMITS.missTtlMs + PHOTO_LIMITS.errorTtlMs]);
      photoLog.add({
        who: personLabel(key),
        kind: 'person',
        steps: how.steps[key] ?? [found ? `lookup: ${url ? 'photo' : 'no photo'}` : `lookup failed: ${failure}`],
        result: url ? 'hit' : found ? 'miss' : 'error',
      });
      this.notify(key);
    }
    this.scheduleSave();
    if (found) void this.dropSilhouettes(scope, batch);
  }

  /** Google hands some senders (a company's Workspace mailbox) its silhouette as a photo. Checked after the answer is in, so a slow read never holds up a batch; a silhouette becomes no photo, and a brand logo shows instead. */
  private async dropSilhouettes(scope: string, keys: string[]) {
    const check = this.deps.placeholder;
    if (!check) return;
    let dropped = false;
    await Promise.all(
      keys.map(async (key) => {
        const url = this.people.get(key)?.[0];
        if (!url || url.startsWith('data:') || url.endsWith(MONOGRAM_MARK) || !(await check(url).catch(() => false))) return;
        if (this.scope !== scope || this.people.get(key)?.[0] !== url) return;
        this.people.set(key, [null, this.now()]);
        photoLog.add({ who: personLabel(key), kind: 'person', steps: [`photo ${tag(url)} is Google's generic silhouette: no photo`], result: 'miss' });
        this.notify(key);
        dropped = true;
      }),
    );
    if (dropped) this.scheduleSave();
  }

  private async flushBrands(scope: string) {
    const measure = this.deps.imageWidth ?? imageWidth;
    const domains = [...this.brandQueue].filter((d) => !this.isFresh(this.brands.get(d), 'brand'));
    this.brandQueue.clear();
    if (!domains.length) return;
    domains.forEach((d) => this.brandInflight.add(d));
    const worker = async () => {
      for (let domain = domains.shift(); domain; domain = domains.shift()) {
        // The sender's own subdomain first, then its domain; the source's own logo by domain only.
        const own = this.deps.logo?.(domain);
        const hosts = own ? [domain] : (this.hostsOf.get(domain) ?? [domain]).filter((h) => h === domain || h.endsWith(`.${domain}`));
        if (!hosts.includes(domain)) hosts.push(domain);
        const steps: string[] = [];
        let url = '';
        let width = 0;
        for (const host of hosts) {
          url = own ?? faviconUrl(host);
          width = await measure(url).catch(() => 0);
          steps.push(`${own ? 'own logo' : `favicon ${host}`}: ${width === 0 ? "didn't load" : width < MIN_LOGO_PX ? `${width}px, generic` : `${width}px`}`);
          if (width >= MIN_LOGO_PX) break;
        }
        this.brandInflight.delete(domain);
        if (this.scope !== scope) return;
        const now = this.now();
        // Didn't load at all: retry sooner than a genuine "no logo".
        const at = width === 0 ? now - PHOTO_LIMITS.brandMissTtlMs + PHOTO_LIMITS.brandErrorTtlMs : now;
        const found = width >= MIN_LOGO_PX;
        photoLog.add({ who: domain, kind: 'brand', steps, result: found ? 'hit' : width === 0 ? 'error' : 'miss' });
        this.brands.set(domain, [found ? url : null, at]);
        for (const [key, d] of this.brandOf) if (d === domain) this.notify(key);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PHOTO_LIMITS.brandConcurrency, domains.length) }, worker));
    this.scheduleSave();
  }

  /** The sender's own host first (email.newyorktimes.com), then its organisation domain. */
  private async flushBimi(scope: string) {
    const ask = this.deps.bimi;
    const orgs = [...this.bimiQueue].filter((d) => !this.isFresh(this.brands.get(`bimi:${d}`), 'brand'));
    this.bimiQueue.clear();
    if (!ask || !orgs.length) return;
    orgs.forEach((d) => this.bimiInflight.add(d));
    for (const org of orgs) {
      const hosts = this.hostsOf.get(`bimi:${org}`) ?? [org];
      if (!hosts.includes(org)) hosts.push(org);
      const steps: string[] = [];
      let url: string | undefined;
      let unavailable = false;
      const selectors = [this.selectorOf.get(org), undefined];
      ask: for (const selector of selectors.filter((s, i) => i === selectors.length - 1 || s)) {
        for (const host of hosts) {
          const records = await ask(host, selector).catch(() => undefined);
          const where = `${selector ?? 'default'}._bimi.${host}`;
          if (!records) {
            unavailable = true;
            steps.push(`verified logo ${where}: DNS not reachable`);
            break ask;
          }
          url = records.map(bimiLogo).find(Boolean);
          steps.push(`verified logo ${where}: ${url ? tag(url) : 'none'}`);
          if (url) break ask;
        }
      }
      this.bimiInflight.delete(org);
      if (this.scope !== scope) return;
      const now = this.now();
      photoLog.add({ who: org, kind: 'brand', steps, result: url ? 'hit' : unavailable ? 'error' : 'miss' });
      // Not reachable: ask again sooner than after a genuine "none".
      this.brands.set(`bimi:${org}`, [url ?? null, unavailable ? now - PHOTO_LIMITS.brandMissTtlMs + PHOTO_LIMITS.brandErrorTtlMs : now]);
      for (const [key, d] of this.orgOf) if (d === org) this.notify(key);
    }
    this.scheduleSave();
  }

  private notify(key: string) {
    this.snapshots.delete(key);
    this.listeners.get(key)?.forEach((fn) => fn());
  }

  private notifyAll() {
    this.snapshots.clear();
    for (const set of this.listeners.values()) set.forEach((fn) => fn());
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    const scope = this.scope;
    if (!scope) return;
    this.saveTimer = setTimeout(() => void this.save(scope), this.deps.saveDelayMs ?? 2_000);
  }

  private async save(scope: string) {
    if (this.scope !== scope) return;
    const newest = (map: Map<string, Stored>, max: number) =>
      Object.fromEntries([...map.entries()].sort(([, a], [, b]) => b[1] - a[1]).slice(0, max));
    const raw = ((await this.deps.read().catch(() => undefined)) ?? {}) as Store;
    const next: Store = {
      ...raw,
      [scope]: { v: STORE_VERSION, savedAt: this.now(), photos: newest(storable(this.people), PHOTO_LIMITS.perAccount), brands: newest(this.brands, PHOTO_LIMITS.brandsPerAccount) },
    };
    const kept = Object.entries(next)
      .sort(([, a], [, b]) => (b?.savedAt ?? 0) - (a?.savedAt ?? 0))
      .slice(0, PHOTO_LIMITS.accounts);
    await this.deps.write(Object.fromEntries(kept)).catch(() => undefined);
  }
}

export const photos = new PhotoCache({
  logo: (domain) => {
    try {
      return import.meta.env.DEV && backend().kind === 'demo' ? demoLogo(domain) : undefined;
    } catch {
      return undefined;
    }
  },
  lookup: () => {
    try {
      const b = backend();
      return b.lookupPhotos ? (emails) => b.lookupPhotos!(emails) : undefined;
    } catch {
      return undefined;
    }
  },
  placeholder: isGooglePlaceholder,
  read: () => readKey(PHOTOS_KEY),
  write: (store) => writeKey(PHOTOS_KEY, store),
  bimi: async (host, selector) => {
    const runtime = (globalThis as { browser?: { runtime?: { id?: string; sendMessage?: (m: unknown) => Promise<unknown> } } }).browser?.runtime;
    if (!runtime?.id || !runtime.sendMessage) return undefined;
    const res = (await runtime.sendMessage({ type: 'bimi', domain: host, ...(selector ? { selector } : {}) }).catch(() => undefined)) as { ok?: boolean; records?: string[] } | undefined;
    return res?.ok ? (res.records ?? []) : undefined;
  },
});

/** For an avatar that has a photo already: Gmail puts the verified logo first. */
export function useVerifiedLogo(email: string | undefined): Photo | undefined {
  const key = email ? norm(email) : '';
  const photo = useSyncExternalStore(
    (fn) => (key ? photos.subscribe(key, fn) : () => undefined),
    () => (key ? photos.peekVerified(key) : undefined),
  );
  useEffect(() => {
    if (key) photos.requestVerified(key);
  }, [key]);
  return photo;
}

/** A person's profile photo or an organisation's brand logo. `name` helps tell a brand ("Stripe") from a person. Each address is looked up at most once per TTL; avatars rendered together share one request. */
export function usePersonPhoto(email: string | undefined, name?: string): Photo | undefined {
  const key = email ? norm(email) : '';
  const photo = useSyncExternalStore(
    (fn) => (key ? photos.subscribe(key, fn) : () => undefined),
    () => (key ? photos.peek(key) : undefined),
  );
  useEffect(() => {
    if (key) photos.request(key, name);
  }, [key, name]);
  return photo;
}
