/** Tiny, fast, good enough for fixture jitter. Returns [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Local midnight of the day `daysAgo` before `now`, then `hh:mm` local. */
export function dayAt(now: number, daysAgo: number, hh: number, mm: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "Tue, Oct 6, 2026 at 9:41 AM", the way a quoted reply header reads. */
export function formatQuoteDate(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "October 6, 2026" */
export function formatLongDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Oct 6" */
export function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Tuesday, October 6" */
export function formatWeekdayDate(ms: number): string {
  const d = new Date(ms);
  const long = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return `${long[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
}

/** "2026-10-06" local. */
export function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** For snippets and search of HTML-only mail. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&times;/g, '×')
    .replace(/&middot;/g, '·')
    .replace(/&rsquo;/g, '’')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t\f\r]+/g, ' ')
    .replace(/ ([,.;:!?)])/g, '$1')
    .replace(/\( /g, '(')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function snippetOf(text: string, max = 160): string {
  const c = collapse(text);
  if (c.length <= max) return c;
  const cut = c.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd();
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard (not url-safe). Works without Buffer. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  const n = bytes.length;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]! + B64[(v >> 6) & 63]! + B64[v & 63]!;
  }
  if (i < n) {
    const a = bytes[i]!;
    const b = i + 1 < n ? bytes[i + 1]! : 0;
    const v = (a << 16) | (b << 8);
    out += B64[(v >> 18) & 63]! + B64[(v >> 12) & 63]!;
    out += i + 1 < n ? B64[(v >> 6) & 63]! + '=' : '==';
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v =
      (B64.indexOf(clean[i]!) << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]!) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]!) : 0);
    out[o++] = (v >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (v >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = v & 255;
  }
  return out.slice(0, o);
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s{2,}/g, ' '))}`;
}

/** "Thursday evening", the way ride receipts name a trip. */
export function tripName(ms: number): string {
  const d = new Date(ms);
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]!;
  const h = d.getHours();
  const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
  return `${day} ${part}`;
}
