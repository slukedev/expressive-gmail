import { BackendError } from '../app/data/backend';
import type { Contact } from '../app/data/types';
import { arr, at, parseGmailJson, str } from './json';
import { accountIndexFromPath, sizedPhoto } from './account';
import type { TokenSource } from './session';
import { redactedShape, tag } from './shape';
import { cap } from '../shared/bounded';

/**
 * Recipient autocomplete and profile photos through People Stack, the service
 * Gmail's own compose and hovercards use. Bodies are positional protobuf JSON:
 * Autocomplete is `[client, query, [1, 2], maxResults]` and Lookup
 * `[client, [1, 2], [[email], ...]]` (field layout from mautrix/gvoice's
 * reverse-engineered protos; 134 is the client id Gmail web sends, per
 * crouton-labs/capture). Signed with SAPISIDHASH like Google's own web clients.
 * Unverified against live Gmail beyond those sources, so every reader below
 * goes by shape and falls back to a loose search.
 */
const PEOPLE_STACK = 'https://peoplestack-pa.clients6.google.com/$rpc/peoplestack.PeopleStackAutocompleteService';

/** Gmail web's public API key (as hardcoded by InboxSDK); a key captured from Gmail's traffic wins. */
export const FALLBACK_API_KEY = 'AIzaSyBm7aDMG9actsWSlx-MvrYsepwdnLgz69I';

const GMAIL_CLIENT = 134;
/** Enough to merge with local suggestions and still fill the menu after filtering. */
const AUTOCOMPLETE_MAX = 15;
const LOOKUP_BATCH = 25;

export interface PeopleStackShape {
  client: number;
  flags: number[];
}

/** What Gmail web sent (October 2026), used until the page shows its own. */
const GMAIL_SHAPE: PeopleStackShape = { client: GMAIL_CLIENT, flags: [1, 2] };

/** Matches PHOTO_HOW_KEY in the app's photo cache. */
const PHOTO_HOW_KEY = '#how';

function autocompleteBody(query: string, max = AUTOCOMPLETE_MAX, shape: PeopleStackShape = GMAIL_SHAPE): unknown[] {
  return [shape.client, query, shape.flags, max];
}

function lookupBody(emails: string[], shape: PeopleStackShape = GMAIL_SHAPE): unknown[] {
  return [shape.client, shape.flags, emails.map((email) => [email])];
}

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
/** Google's generated letter avatar. Gmail shows it, so we do, marked so a real photo wins over it. */
const MONOGRAM = 1;
export const MONOGRAM_MARK = '#monogram';
const photoOf = (url: string, type: unknown) => (type === MONOGRAM ? `${sizedPhoto(url)}${MONOGRAM_MARK}` : sizedPhoto(url));
const best = (urls: (string | undefined)[]) => urls.find((u) => u && !u.endsWith(MONOGRAM_MARK)) ?? urls.find(Boolean);

interface Method {
  email: string;
  name?: string;
  photo?: string;
  /** False when the method carried no display info, so the person's applies. */
  described: boolean;
}

/**
 * A ContactMethod is `[displayInfo, [email], ...]` with displayInfo
 * `[[photoUrl, photoType], [name, givenName], ...]`.
 */
function asMethod(node: unknown): Method | undefined {
  const email = str(at(node, 1, 0))?.trim();
  if (!email || !EMAIL.test(email)) return undefined;
  const info = at(node, 0);
  const name = str(at(info, 1, 0))?.trim();
  const url = str(at(info, 0, 0));
  const photo = url && isPhoto(url) ? photoOf(url, at(info, 0, 1)) : undefined;
  return { email, ...(name ? { name } : {}), ...(photo ? { photo } : {}), described: Array.isArray(info) };
}

function methodsIn(node: unknown, depth = 0, out: Method[] = []): Method[] {
  const list = arr(node);
  if (!list || depth > 8) return out;
  const method = asMethod(list);
  if (method) out.push(method);
  else for (const child of list) methodsIn(child, depth + 1, out);
  return out;
}

/** `[url, type]`, as a person's photo field carries it; letter tiles skipped. */
function anyPhoto(node: unknown, depth = 0): string | undefined {
  const list = arr(node);
  if (!list || depth > 10) return undefined;
  const url = str(list[0]);
  if (url && (/^https:\/\/[^/]*\.googleusercontent\.com\//.test(url) || isImageData(url)) && isPhoto(url)) return photoOf(url, list[1]);
  for (const child of list) {
    const found = anyPhoto(child, depth + 1);
    if (found) return found;
  }
  return undefined;
}

/** Google may put the photo on one of a person's addresses or beside them on the person, so it goes to every address of theirs with no display info or the same name. */
function personContacts(result: unknown): Contact[] {
  const methods = methodsIn(result);
  const name = methods.find((m) => m.name)?.name;
  const photo = best([...methods.map((m) => m.photo), methods.length ? anyPhoto(result) : undefined]);
  return methods.map((m) => {
    const same = !m.described || !m.name || m.name === name;
    const n = m.name ?? (m.described ? undefined : name);
    const p = m.photo ?? (same ? photo : undefined);
    return { email: m.email, ...(n ? { name: n } : {}), ...(p ? { photoUrl: p } : {}) };
  });
}

/** `[[result, ...], affinityContext]`, one result per person in Google's ranking. When that layout yields nothing (Google reshuffled it), falls back to any array holding an address. */
export function parseAutocomplete(root: unknown): Contact[] {
  const results = arr(at(root, 0)) ?? [];
  const strict = collect(results.flatMap(personContacts));
  return strict.length ? strict : collect(looseEntries(root));
}

/** `[[match, ...]]`, match = `[[email], autocompletion, failure]`. Photo or null per mentioned address; unmentioned ones are left out (unknown). */
export function parseLookup(root: unknown, wanted: string[]): Map<string, string | null> {
  const want = new Set(wanted.map((e) => e.toLowerCase()));
  const out = new Map<string, string | null>();
  for (const match of arr(at(root, 0)) ?? []) {
    const methods = methodsIn(match);
    const asked = str(at(match, 0, 0))?.trim().toLowerCase();
    const emails = new Set([...(asked ? [asked] : []), ...methods.map((m) => m.email.toLowerCase())]);
    // A person's photo stands for every address of theirs.
    const photo = best([...methods.map((m) => m.photo), anyPhoto(at(match, 1))]) ?? null;
    for (const email of emails) if (want.has(email) && (photo || !out.get(email))) out.set(email, photo);
  }
  return out;
}

function contact(email: string, name?: string, photo?: string): Contact | undefined {
  const address = email.trim();
  if (!EMAIL.test(address)) return undefined;
  const out: Contact = { email: address };
  if (name?.trim()) out.name = name.trim();
  if (photo && isPhoto(photo)) out.photoUrl = sizedPhoto(photo);
  return out;
}

function isPhoto(url: string) {
  // Google's own "no photo" pictures: the default-user address, and the old all-A placeholder path.
  return (/^https:\/\//.test(url) && !/default-user|\/AAAAAAAAAAI\/AAAAAAAAAAA\//.test(url)) || isImageData(url);
}

/** About 200 KB decoded: far more than a 96px logo. */
const MAX_DATA_URL = 270_000;

/** Gmail hands out verified senders' BIMI logos as `data:image/png;base64,...`: a raster type, base64, a sane size, and matching magic bytes. */
export function isImageData(url: string): boolean {
  const m = /^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!m || url.length > MAX_DATA_URL || m[2]!.length < 16) return false;
  const head = m[2]!.slice(0, 8);
  const magic: Record<string, RegExp> = { png: /^iVBORw0K/, jpeg: /^\/9j\//, jpg: /^\/9j\//, webp: /^UklGR/, gif: /^R0lGOD/ };
  return magic[m[1]!]!.test(head);
}

function collect(found: (Contact | undefined)[]): Contact[] {
  const out: Contact[] = [];
  const seen = new Set<string>();
  for (const c of found) {
    if (!c || seen.has(c.email.toLowerCase())) continue;
    seen.add(c.email.toLowerCase());
    out.push(c);
  }
  return out;
}

/** An address in `[email]`-like arrays; its entry is the array one level up. */
function looseEntries(root: unknown): (Contact | undefined)[] {
  const out: (Contact | undefined)[] = [];
  const visit = (node: unknown, parent: unknown[] | undefined, depth: number) => {
    const list = arr(node);
    if (!list || depth > 12) return;
    const email = list.find((x): x is string => typeof x === 'string' && EMAIL.test(x.trim()));
    if (email) {
      const entry = parent ?? list;
      out.push(contact(email, firstString(entry, list, isName), firstString(entry, list, isPhoto)));
      return;
    }
    for (const child of list) visit(child, list, depth + 1);
  };
  visit(root, undefined, 0);
  return out;
}

function isName(value: string) {
  const v = value.trim();
  return v.length > 0 && v.length <= 100 && /\p{L}/u.test(v) && !EMAIL.test(v) && !/^[a-z]+:\/\//i.test(v);
}

/** First string in `entry` matching `test`, outside the `skip` branch that held the address. */
function firstString(entry: unknown[], skip: unknown[], test: (v: string) => boolean): string | undefined {
  const stack: unknown[] = [...entry].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (node === skip) continue;
    if (typeof node === 'string' && test(node)) return node;
    if (Array.isArray(node)) for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
  }
  return undefined;
}

function readCookie(cookieString: string, name: string): string | undefined {
  for (const part of cookieString.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return undefined;
}

/** `SAPISIDHASH <ts>_<sha1("<ts> <SAPISID> <origin>")>`, plus the 1P/3P variants when present. */
async function sapisidAuthorization(cookieString: string, origin: string, nowMs: number): Promise<string | undefined> {
  const ts = Math.floor(nowMs / 1000);
  const parts: string[] = [];
  for (const [cookie, scheme] of [
    ['SAPISID', 'SAPISIDHASH'],
    ['__Secure-1PAPISID', 'SAPISID1PHASH'],
    ['__Secure-3PAPISID', 'SAPISID3PHASH'],
  ] as const) {
    const value = readCookie(cookieString, cookie) ?? (cookie === 'SAPISID' ? readCookie(cookieString, '__Secure-3PAPISID') : undefined);
    if (value) parts.push(`${scheme} ${ts}_${await sha1Hex(`${ts} ${value} ${origin}`)}`);
  }
  return parts.length ? parts.join(' ') : undefined;
}

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const ADDRESS = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
/** A profile photo address (not the proxied images inside message bodies, on ci*.googleusercontent.com). */
const PROFILE_PHOTO = /^https:\/\/lh\d\.googleusercontent\.com\/(a|a-|-|ogw)\//;

/** Pictures Gmail sends beside a sender in its sync data (an inline logo or a profile photo address). No public source documents the slot, so it's read by shape: an array of at most 40 items with exactly one address among its strings, and an image string in it or one level down. */
export function senderImages(root: unknown, without?: (email: string, context: unknown[]) => void): Map<string, string> {
  const out = new Map<string, string>();
  const image = (v: unknown): v is string => typeof v === 'string' && (isImageData(v) || (PROFILE_PHOTO.test(v) && isPhoto(v)));
  // Two levels up from a sender, trimmed, so a pasted log shows what sits near it.
  const around = (path: unknown[][], node: unknown[]): unknown[] => {
    let context: unknown[] = node;
    for (const ancestor of path.slice(-2).reverse()) {
      const i = ancestor.indexOf(context);
      context = ancestor.length <= 24 ? ancestor : ancestor.slice(Math.max(0, i - 8), i + 9);
    }
    return context;
  };
  const visit = (node: unknown, depth: number, path: unknown[][]) => {
    if (!Array.isArray(node) || depth > 30) return;
    if (node.length <= 40) {
      const addresses = node.filter((v): v is string => typeof v === 'string' && ADDRESS.test(v));
      if (addresses.length === 1) {
        const found = node.find(image) ?? node.flatMap((c) => (Array.isArray(c) ? c : [])).find(image);
        const email = addresses[0]!.toLowerCase();
        if (found && !out.has(email)) out.set(email, isImageData(found) ? found : sizedPhoto(found));
        else if (!found) without?.(email, around(path, node));
      }
    }
    path.push(node);
    for (const child of node) visit(child, depth + 1, path);
    path.pop();
  };
  visit(root, 0, []);
  return out;
}

export interface PeopleStackOptions {
  fetch: typeof fetch;
  tokens: TokenSource;
  /** The page's cookies (SAPISID) and path (/mail/u/N, for X-Goog-AuthUser). */
  document: Pick<Document, 'cookie'> & { location?: { pathname?: string } | null };
  origin: string;
  now: () => number;
  report: (line: string) => void;
}

/** How long a call waits for Gmail's session (for its captured API key) before going without. */
const SESSION_WAIT_MS = 3_000;
/** After Google refuses autocomplete outright, rest a while; the UI falls back to local suggestions. */
const COOLDOWN_MS = 10 * 60_000;
/** After Google says too many requests, every call waits this long. */
const RATE_LIMIT_REST_MS = 60_000;
/** Per-address autocomplete lookups at a time, when Lookup isn't available. */
const PHOTO_CONCURRENCY = 3;
const PHOTO_MEMO = 1_000;

export class PeopleStack {
  private key: string | undefined;
  private downUntil = 0;
  /** Why calls are resting: Google refused them, or asked us to slow down. */
  private downCode: 'unsupported' | 'rate-limited' = 'unsupported';
  /** Set when Google refuses Lookup's body; photos then come from autocomplete per address. */
  private lookupOff = false;
  private readonly photos = new Map<string, string | null>();
  /** Raw answers that left someone without a photo still worth showing, per source. */
  private readonly dumpsLeft = { autocomplete: 3, lookup: 3, sync: 3 };
  /** Redacted shapes waiting to go out with the next photo answer. */
  private dumps: { source: string; shape: string }[] = [];
  /** The redacted message around senders Gmail's data gave no picture for, until one is needed. */
  private readonly syncShapes = new Map<string, string>();

  private dump(kind: keyof PeopleStack['dumpsLeft'], source: string, root: unknown) {
    if (this.dumpsLeft[kind] <= 0) return;
    this.dumpsLeft[kind]--;
    this.dumps.push({ source, shape: typeof root === 'string' ? root : redactedShape(root) });
  }

  /** Addresses whose picture came with Gmail's own message data. */
  private readonly fromGmail = new Set<string>();
  /** For Connection details. */
  private lastStatus = 0;

  constructor(private readonly o: PeopleStackOptions) {}

  async search(prefix: string): Promise<Contact[]> {
    const query = prefix.trim();
    if (!query) return [];
    const root = await this.call('Autocomplete', (s) => autocompleteBody(query, AUTOCOMPLETE_MAX, s));
    const found = parseAutocomplete(root);
    for (const c of found) if (c.photoUrl) this.remember(c.email.toLowerCase(), c.photoUrl);
    if (found.some((c) => !c.photoUrl) || !found.length) this.dump('autocomplete', 'Autocomplete answer with someone left without a photo', root);
    return found;
  }

  /** Remembers the sender pictures in a sync response and hands the response back. */
  learn<T>(root: T): T {
    try {
      const keep = this.dumpsLeft.sync > 0;
      const images = senderImages(root, (email, context) => {
        if (!keep || this.syncShapes.has(email) || this.syncShapes.size >= 100) return;
        this.syncShapes.set(email, redactedShape(context));
      });
      for (const [email, url] of images) {
        this.remember(email, url);
        cap(this.fromGmail.add(email), 5000);
      }
    } catch {
      // A picture is never worth failing a mail read over.
    }
    return root;
  }

  /** One Lookup per batch, the call Gmail makes for every sender it shows (`[134, [1, 2], [["someone@gmail.com"]]]`); autocomplete per address when Lookup is refused. Under PHOTO_HOW_KEY the result says how each address was answered. */
  async lookupPhotos(emails: string[]): Promise<Record<string, string>> {
    const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))].slice(0, LOOKUP_BATCH);
    const steps: Record<string, string[]> = {};
    const step = (email: string, text: string) => (steps[email] ??= []).push(text);
    for (const email of wanted) {
      if (!this.photos.has(email)) continue;
      const url = this.photos.get(email);
      step(email, this.fromGmail.has(email) ? `Gmail's message data: ${url?.startsWith('data:') ? 'inline image' : 'photo'}` : `remembered: ${url ? 'photo' : 'no photo'}`);
    }
    let queue = wanted.filter((e) => !this.photos.has(e));
    if (queue.length && this.lookupOff) queue.forEach((e) => step(e, 'Lookup: off after an earlier refusal'));
    else if (queue.length && this.o.now() < this.downUntil) queue.forEach((e) => step(e, `Lookup: resting (${this.downCode})`));
    else if (queue.length) {
      const asked = queue;
      try {
        const root = await this.call('Lookup', (s) => lookupBody(asked, s), false);
        const found = parseLookup(root, asked);
        if (asked.some((e) => !found.get(e))) this.dump('lookup', 'Lookup answer with someone left without a photo', root);
        for (const email of asked) {
          const url = found.get(email);
          step(email, `Lookup HTTP 200: ${found.has(email) ? (url ? `photo ${tag(url)}` : 'no photo') : 'not in the answer'}`);
        }
        // An answer that names nobody may be a layout we can't read; autocomplete settles those.
        if (found.size) {
          for (const email of asked) this.remember(email, found.get(email) ?? null);
          queue = [];
        }
      } catch (err) {
        const code = err instanceof BackendError ? err.code : 'error';
        asked.forEach((e) => step(e, `Lookup ${this.lastStatus ? `HTTP ${this.lastStatus}` : code}`));
        if (code === 'unsupported') {
          this.lookupOff = true;
          this.o.report('contacts: Lookup refused; photos come from autocomplete instead');
        } else queue = [];
      }
    }
    const worker = async () => {
      for (let email = queue.shift(); email; email = queue.shift()) {
        if (this.o.now() < this.downUntil) {
          step(email, 'autocomplete: resting');
          return;
        }
        try {
          const match = (await this.search(email)).find((c) => c.email.toLowerCase() === email);
          step(email, `autocomplete: ${match?.photoUrl ? 'photo' : match ? 'no photo' : 'not found'}`);
          this.remember(email, match?.photoUrl ?? null);
        } catch (err) {
          // Unknown rather than "no photo": the UI asks again later. Told to slow down, stop here.
          const code = err instanceof BackendError ? err.code : 'error';
          step(email, `autocomplete ${this.lastStatus ? `HTTP ${this.lastStatus}` : code}`);
          if (code === 'rate-limited') return;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, queue.length) }, worker));
    const out: Record<string, string> = {};
    for (const email of wanted) {
      const url = this.photos.get(email);
      if (url) out[email] = url;
    }
    for (const email of wanted) {
      const context = this.syncShapes.get(email);
      if (!this.photos.get(email) && context) {
        this.syncShapes.delete(email);
        this.dump('sync', `Gmail message data around a sender with no photo (*@${email.split('@')[1]})`, context);
      }
    }
    const shape = this.shapes();
    const dumps = this.dumps;
    this.dumps = [];
    out[PHOTO_HOW_KEY] = JSON.stringify({
      ...(dumps.length ? { dumps } : {}),
      steps,
      template: shape.Lookup ? `Lookup [${shape.Lookup.client}, ${JSON.stringify(shape.Lookup.flags)}] seen in Gmail's own requests` : undefined,
    });
    return out;
  }

  /** The client id and flags Gmail's own People Stack calls used, once the page has made one. */
  private shapes(): Partial<Record<'Lookup' | 'Autocomplete', PeopleStackShape>> {
    const raw = this.o.tokens.current()?.peopleStack;
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, PeopleStackShape>;
      const valid = (v: PeopleStackShape | undefined) =>
        v && typeof v.client === 'number' && Array.isArray(v.flags) && v.flags.every((f) => typeof f === 'number') ? v : undefined;
      return { Lookup: valid(parsed.Lookup), Autocomplete: valid(parsed.Autocomplete) };
    } catch {
      return {};
    }
  }

  private remember(email: string, url: string | null) {
    if (url === null && this.photos.get(email)) return;
    this.photos.delete(email);
    if (this.photos.size >= PHOTO_MEMO) this.photos.delete(this.photos.keys().next().value!);
    this.photos.set(email, url);
  }

  /** `cool`: a refusal rests every call for a while. */
  private async call(method: 'Autocomplete' | 'Lookup', build: (shape: PeopleStackShape) => unknown[], cool = true): Promise<unknown> {
    this.lastStatus = 0;
    if (this.o.now() < this.downUntil) {
      throw new BackendError('Google contact suggestions are unavailable right now.', this.downCode, this.downCode === 'rate-limited');
    }
    const { tokens: source, document: doc } = this.o;
    const tokens = (await source.waitUntilReady(SESSION_WAIT_MS).catch(() => undefined)) ?? source.current();
    const index = accountIndexFromPath(tokens?.syncPath ?? doc.location?.pathname ?? '');
    const authorization = await sapisidAuthorization(doc.cookie, this.o.origin, this.o.now());
    if (!authorization) {
      this.o.report('contacts: no SAPISID cookie visible to the content script');
      throw new BackendError('You are signed out of Google. Sign in again to continue.', 'unauthenticated');
    }
    // Keys are restricted per API: the one Gmail used for People Stack, then the known web key, then any other.
    const keys = [...new Set([this.key, tokens?.peopleApiKey, FALLBACK_API_KEY, tokens?.apiKey].filter((k): k is string => !!k))];
    const label = method.toLowerCase();
    let status = 0;
    for (const key of keys) {
      let response: Response;
      try {
        response = await this.o.fetch(`${PEOPLE_STACK}/${method}`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json+protobuf',
            'X-Goog-Api-Key': key,
            'X-Goog-AuthUser': String(index),
            'X-User-Agent': 'grpc-web-javascript/0.1',
            Authorization: authorization,
          },
          body: JSON.stringify(build(this.shapes()[method] ?? GMAIL_SHAPE)),
        });
      } catch {
        // CORS refusals land here too, indistinguishable from being offline.
        this.o.report(`contacts: ${label} request failed (network or CORS)`);
        throw new BackendError("Couldn't reach Google. Check your connection.", 'network', true);
      }
      if (response.ok) {
        this.key = key;
        const text = await response.text();
        try {
          return parseGmailJson(text);
        } catch {
          this.o.report(`contacts: unreadable ${label} response (${text.slice(0, 40).replace(/\s+/g, ' ')})`);
          throw new BackendError('Google sent contact suggestions this version of Expressive Gmail does not understand.', 'unknown');
        }
      }
      status = response.status;
      this.lastStatus = status;
      const keyName = key === FALLBACK_API_KEY ? 'built-in key' : key === tokens?.peopleApiKey ? "Gmail's People Stack key" : 'another captured key';
      this.o.report(`contacts: ${label} answered HTTP ${status} with ${keyName}`);
      // 400 and 403 are what a key that isn't enabled for this API gets; try the next one.
      if (status !== 400 && status !== 403) break;
    }
    if (status === 429) {
      this.rest(RATE_LIMIT_REST_MS, 'rate-limited');
      throw new BackendError('Google is rate limiting contact suggestions.', 'rate-limited', true);
    }
    if (status >= 500) throw new BackendError(`Google had a server error (${status}).`, 'network', true);
    // A session Google stopped accepting for a moment (it renews its sign-in headers); worth asking again later.
    if (status === 401) throw new BackendError(`Google asked to sign in again for contact suggestions (HTTP ${status}).`, 'unauthenticated', true);
    if (cool) this.rest(COOLDOWN_MS, 'unsupported');
    throw new BackendError(`Google refused contact suggestions (HTTP ${status}).`, 'unsupported');
  }

  private rest(ms: number, code: 'unsupported' | 'rate-limited') {
    this.downUntil = Math.max(this.downUntil, this.o.now() + ms);
    this.downCode = code;
  }
}
