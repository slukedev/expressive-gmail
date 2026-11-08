/** Editing Gmail search strings token by token. */
export function tokenize(q: string): string[] {
  return q.match(/-?\w+:"[^"]*"|-?\w+:\([^)]*\)|"[^"]*"|\S+/g) ?? [];
}

export function hasToken(q: string, pred: (t: string) => boolean) {
  return tokenize(q).some(pred);
}

export function setOperator(q: string, op: string, value: string | null): string {
  const tokens = tokenize(q).filter((t) => !t.toLowerCase().startsWith(`${op}:`));
  if (value !== null && value !== '') tokens.push(`${op}:${/\s/.test(value) ? `"${value}"` : value}`);
  return tokens.join(' ').trim();
}

export function toggleToken(q: string, token: string): string {
  const tokens = tokenize(q);
  const i = tokens.findIndex((t) => t.toLowerCase() === token.toLowerCase());
  if (i >= 0) tokens.splice(i, 1);
  else tokens.push(token);
  return tokens.join(' ').trim();
}

export function getOperator(q: string, op: string): string | undefined {
  const t = tokenize(q).find((x) => x.toLowerCase().startsWith(`${op}:`));
  return t?.slice(op.length + 1).replace(/^"|"$/g, '');
}

export interface AdvancedSearch {
  from: string;
  to: string;
  subject: string;
  words: string;
  without: string;
  sizeOp: 'larger' | 'smaller';
  size: string;
  sizeUnit: 'M' | 'K';
  within: string;
  date: string;
  scope: string;
  hasAttachment: boolean;
  excludeChats: boolean;
}

export const EMPTY_ADVANCED: AdvancedSearch = {
  from: '',
  to: '',
  subject: '',
  words: '',
  without: '',
  sizeOp: 'larger',
  size: '',
  sizeUnit: 'M',
  within: '1d',
  date: '',
  scope: 'all',
  hasAttachment: false,
  excludeChats: false,
};

const q = (v: string) => (/\s/.test(v.trim()) ? `(${v.trim()})` : v.trim());

export function buildAdvancedQuery(a: AdvancedSearch): string {
  const parts: string[] = [];
  if (a.from.trim()) parts.push(`from:${q(a.from)}`);
  if (a.to.trim()) parts.push(`to:${q(a.to)}`);
  if (a.subject.trim()) parts.push(`subject:${q(a.subject)}`);
  if (a.words.trim()) parts.push(a.words.trim());
  if (a.without.trim()) parts.push(`-{${a.without.trim()}}`);
  if (a.size.trim()) parts.push(`${a.sizeOp}:${a.size.trim()}${a.sizeUnit}`);
  if (a.date) {
    // <input type=date> gives YYYY-MM-DD; read it as a local date, not UTC midnight.
    const [y, m, dd] = a.date.split('-').map(Number);
    const d = new Date(y, m - 1, dd);
    const days = { '1d': 1, '3d': 3, '1w': 7, '2w': 14, '1m': 30, '2m': 60, '6m': 182, '1y': 365 }[a.within] ?? 1;
    const fmt = (x: Date) => `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`;
    parts.push(`after:${fmt(new Date(d.getTime() - days * 86_400_000))}`, `before:${fmt(new Date(d.getTime() + (days + 1) * 86_400_000))}`);
  }
  if (a.scope !== 'all') parts.push(a.scope);
  if (a.hasAttachment) parts.push('has:attachment');
  if (a.excludeChats) parts.push('-in:chats');
  return parts.join(' ');
}
