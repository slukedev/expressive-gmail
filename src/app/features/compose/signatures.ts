import { create } from 'zustand';
import type { Account, Address } from '../../data/types';
import { readKey, watchKey, writeKey } from '../../state/storage';

/** Gmail's model: named signatures, and per send-as address one default for new mail and one for replies. Kept in this browser; Gmail's own signature is imported once. */
export interface Signature {
  id: string;
  name: string;
  html: string;
}

export type SignatureUse = 'new' | 'reply';

/** Per lowercased address; null means "no signature" was chosen. */
type SignatureDefaults = Record<string, { new: string | null; reply: string | null }>;

export interface ComposeData {
  signatures: Signature[];
  defaults: SignatureDefaults;
  /** So a deleted one stays deleted. */
  imported: string[];
  /** Newest first. */
  recentEmoji: string[];
}

export const EMPTY_COMPOSE_DATA: ComposeData = { signatures: [], defaults: {}, imported: [], recentEmoji: [] };

const KEY = 'bg.compose.v1';

export type SignatureAccount = Pick<Account, 'email' | 'name' | 'sendAs' | 'signature'>;

/** The members of a merged scope, or the account itself. */
export function accountsOf(account: Account | undefined): SignatureAccount[] {
  if (!account) return [];
  return account.members?.length ? account.members : [account];
}

/** Once each, with the account it belongs to. */
export function sendingAddresses(account: Account | undefined): { address: Address; account: SignatureAccount }[] {
  const seen = new Set<string>();
  const out: { address: Address; account: SignatureAccount }[] = [];
  for (const a of accountsOf(account)) {
    const list = a.sendAs?.length ? a.sendAs : [{ name: a.name, email: a.email }];
    for (const address of list) {
      const key = address.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ address, account: a });
    }
  }
  return out;
}

const clean = (html: string) => html.replace(/\s+/g, ' ').trim();

/** One line of text, for lists and menus. */
export function signaturePreview(html: string) {
  return html
    .replace(/<(br|\/div|\/p|\/li|\/h\d)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function newSignatureId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Says whose it is when there are several accounts. */
function importedName(a: SignatureAccount, many: boolean) {
  return many ? a.email : 'My signature';
}

/** The first time an account is seen, its Gmail signature becomes a saved signature and the default on its addresses that have none. Same object when nothing changed. */
export function withImported(data: ComposeData, accounts: SignatureAccount[], makeId = newSignatureId): ComposeData {
  let next = data;
  const many = accounts.length > 1;
  for (const a of accounts) {
    const key = a.email.toLowerCase();
    if (next.imported.includes(key)) continue;
    const html = a.signature?.trim() ? a.signature : '';
    const signatures = [...next.signatures];
    const defaults = { ...next.defaults };
    if (html) {
      const same = signatures.find((s) => clean(s.html) === clean(html));
      const sig = same ?? { id: makeId(), name: importedName(a, many), html };
      if (!same) signatures.push(sig);
      const addresses = (a.sendAs?.length ? a.sendAs.map((x) => x.email) : [a.email]).map((e) => e.toLowerCase());
      if (!addresses.includes(key)) addresses.push(key);
      for (const e of addresses) if (!defaults[e]) defaults[e] = { new: sig.id, reply: sig.id };
    }
    next = { ...next, signatures, defaults, imported: [...next.imported, key] };
  }
  return next;
}

/** Null for none. */
export function defaultSignature(data: ComposeData, email: string | undefined, use: SignatureUse): Signature | null {
  if (!email) return null;
  const id = data.defaults[email.toLowerCase()]?.[use];
  return (id && data.signatures.find((s) => s.id === id)) || null;
}

export function setDefault(data: ComposeData, email: string, use: SignatureUse, id: string | null): ComposeData {
  const key = email.toLowerCase();
  const current = data.defaults[key] ?? { new: null, reply: null };
  return { ...data, defaults: { ...data.defaults, [key]: { ...current, [use]: id } } };
}

export function saveSignature(data: ComposeData, sig: Signature): ComposeData {
  const at = data.signatures.findIndex((s) => s.id === sig.id);
  const signatures = at < 0 ? [...data.signatures, sig] : data.signatures.map((s, i) => (i === at ? sig : s));
  return { ...data, signatures };
}

/** Addresses that used it as a default go to no signature. */
export function deleteSignature(data: ComposeData, id: string): ComposeData {
  const defaults: SignatureDefaults = {};
  for (const [email, d] of Object.entries(data.defaults)) {
    defaults[email] = { new: d.new === id ? null : d.new, reply: d.reply === id ? null : d.reply };
  }
  return { ...data, signatures: data.signatures.filter((s) => s.id !== id), defaults };
}

export function rememberEmoji(data: ComposeData, emoji: string): ComposeData {
  return { ...data, recentEmoji: [emoji, ...data.recentEmoji.filter((e) => e !== emoji)].slice(0, 16) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Anything of the wrong shape (an old version, a hand edit) dropped. */
export function sanitizeComposeData(stored: unknown): ComposeData {
  if (!isRecord(stored)) return EMPTY_COMPOSE_DATA;
  const signatures = Array.isArray(stored.signatures)
    ? stored.signatures.filter((s): s is Signature => isRecord(s) && typeof s.id === 'string' && typeof s.name === 'string' && typeof s.html === 'string')
    : [];
  const defaults: SignatureDefaults = {};
  if (isRecord(stored.defaults)) {
    for (const [email, d] of Object.entries(stored.defaults)) {
      if (!isRecord(d)) continue;
      const pick = (v: unknown) => (typeof v === 'string' ? v : null);
      defaults[email.toLowerCase()] = { new: pick(d.new), reply: pick(d.reply) };
    }
  }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { signatures, defaults, imported: strings(stored.imported), recentEmoji: strings(stored.recentEmoji) };
}

interface ComposeStore extends ComposeData {
  loaded: boolean;
  update: (fn: (d: ComposeData) => ComposeData) => void;
}

const dataOf = ({ signatures, defaults, imported, recentEmoji }: ComposeData): ComposeData => ({ signatures, defaults, imported, recentEmoji });

export const useComposeData = create<ComposeStore>((set, get) => ({
  ...EMPTY_COMPOSE_DATA,
  loaded: false,
  update: (fn) => {
    const before = dataOf(get());
    const next = fn(before);
    if (next === before) return;
    set(next);
    writeKey(KEY, next).catch(() => undefined);
  },
}));

let loading: Promise<void> | undefined;

export function loadComposeData() {
  loading ??= readKey(KEY).then((v) => {
    useComposeData.setState({ ...sanitizeComposeData(v), loaded: true });
    watchKey(KEY, (value) => useComposeData.setState(sanitizeComposeData(value)));
  });
  return loading;
}

/** Once the stored ones are known. */
export function importSignatures(account: Account | undefined) {
  if (!account || !useComposeData.getState().loaded) return;
  useComposeData.getState().update((d) => withImported(d, accountsOf(account)));
}

/** Before stored signatures load it falls back to the account's Gmail signature, so nothing changes for someone who never edits them. */
export function startingSignature(account: Account | undefined, owner: SignatureAccount | undefined, email: string | undefined, use: SignatureUse): string {
  const store = useComposeData.getState();
  if (!store.loaded) return owner?.signature ?? '';
  importSignatures(account);
  return defaultSignature(useComposeData.getState(), email ?? owner?.email, use)?.html ?? '';
}
