/** Gmail's smart annotations rebuilt locally, by plain text matching on the message; nothing leaves the browser. */
import { isMe, type Me } from '../lib/format';
import type { Address, Message, ThreadSummary } from '../data/types';
import { parseDay, startOfDay } from './freshness';

export type PackageStatus = 'ordered' | 'shipped' | 'out-for-delivery' | 'delivered' | 'problem';

interface CodeInfo {
  kind: 'code';
  code: string;
  /** Keeps the sender's grouping ("482 913"). */
  display: string;
  service: string;
}
export interface PackageInfo {
  kind: 'package';
  status: PackageStatus;
  merchant?: string;
  carrier?: string;
  tracking?: string;
  /** Ties a "shipped" email to its "delivered" one when there's no tracking number. */
  orderNo?: string;
  eta?: string;
  trackUrl?: string;
}
export interface ReceiptInfo {
  kind: 'receipt';
  merchant: string;
  orderNo?: string;
  total?: string;
  items: string[];
  url?: string;
}
export interface BillInfo {
  kind: 'bill';
  merchant: string;
  amount?: string;
  due?: string;
  autopay?: string;
  url?: string;
}
interface TripInfo {
  kind: 'flight';
  airline: string;
  confirmation?: string;
  flight?: string;
  route?: { from: string; to: string };
  when?: string;
  url?: string;
}
interface StayInfo {
  kind: 'stay';
  name: string;
  checkIn?: string;
  checkOut?: string;
  confirmation?: string;
  url?: string;
}
export interface DealInfo {
  kind: 'deal';
  discount?: string;
  expires?: string;
  code?: string;
  url?: string;
}
interface PickupInfo {
  kind: 'pickup';
  what: string;
  by?: string;
}
export type SmartInfo = CodeInfo | PackageInfo | ReceiptInfo | BillInfo | TripInfo | StayInfo | DealInfo | PickupInfo;

export interface MessageText {
  /** Table cells joined with a tab. */
  lines: string[];
  text: string;
  /** "Key\tValue" rows and "Key: Value" lines, keys lowercased. */
  facts: Map<string, string>;
  links: { text: string; href: string }[];
}

const BLOCK = new Set(['P', 'DIV', 'TR', 'BR', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TBODY', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'HR']);

function htmlLines(html: string): { lines: string[]; links: { text: string; href: string }[] } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style, script, head, [style*="display:none"], [style*="display: none"]').forEach((n) => n.remove());
  const links = [...doc.querySelectorAll('a[href]')].map((a) => ({
    text: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
    href: a.getAttribute('href') ?? '',
  }));
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const block = BLOCK.has(el.tagName);
    if (el.tagName === 'TD' || el.tagName === 'TH') out += '\t';
    if (block) out += '\n';
    el.childNodes.forEach(walk);
    if (block) out += '\n';
  };
  walk(doc.body);
  const lines = out
    .split('\n')
    .map((l) => l.replace(/^[\t ]+|[\t ]+$/g, '').replace(/[ ]{2,}/g, ' '))
    .filter(Boolean);
  return { lines, links };
}

export function messageText(m: Pick<Message, 'bodyHtml' | 'bodyText' | 'snippet' | 'subject'>): MessageText {
  const { lines, links } = m.bodyHtml
    ? htmlLines(m.bodyHtml)
    : { lines: (m.bodyText ?? m.snippet ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean), links: [] as { text: string; href: string }[] };
  if (!m.bodyHtml) {
    const re = /https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g;
    for (const l of lines) for (const u of l.match(re) ?? []) links.push({ text: l, href: u });
  }
  const facts = new Map<string, string>();
  for (const l of lines) {
    const tab = l.split('\t').map((s) => s.trim()).filter(Boolean);
    if (tab.length === 2 && tab[0].length <= 40) facts.set(tab[0].toLowerCase().replace(/[:#]\s*$/, '').trim(), tab[1]);
    const colon = l.match(/^([A-Za-z][A-Za-z #./-]{1,38}):\s+(.{1,120})$/);
    if (colon) facts.set(colon[1].toLowerCase().trim(), colon[2].trim());
  }
  return { lines, text: lines.join('\n').replace(/\t/g, ' '), facts, links };
}

function fact(t: MessageText, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const exact = t.facts.get(k);
    if (exact) return exact;
  }
  for (const [key, v] of t.facts) if (keys.some((k) => key.startsWith(k))) return v;
  return undefined;
}

function link(t: MessageText, re: RegExp): string | undefined {
  return t.links.find((l) => re.test(l.text) && /^https?:/i.test(l.href))?.href;
}

const MONEY = /(?:US)?\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|€\s?\d+(?:[.,]\d{2})?|£\s?\d+(?:\.\d{2})?|\d+(?:[.,]\d{2})?\s?(?:USD|EUR|GBP)\b/;

export function senderName(from: Address): string {
  return from.name?.replace(/\s+(team|support|alerts?|notifications?|no-?reply)$/i, '').trim() || from.email.split('@')[1]?.split('.')[0] || from.email;
}

const CODE_CONTEXT = /\b(code|verification|verify|passcode|pass code|one[- ]time|otp|2fa|two[- ]factor|security code|sign[- ]?in|log[- ]?in|pin|confirmation code|access code)\b/i;
// "code" that isn't about a one-time code.
const NOT_CODE_CONTEXT = /\b(code review|source code|zip code|postal code|area code|dress code|discount code|promo code|coupon code|code of conduct|code freeze|the code|this code base|codebase|qr code)\b/gi;
const NOT_A_CODE = /^(19|20)\d{2}$/;

/** Digits only, plus the sender's spacing. */
export function findCode(...sources: (string | undefined)[]): { code: string; display: string } | null {
  for (const raw of sources) {
    if (!raw) continue;
    // Blank out the false cues but keep offsets, so cue positions line up with raw.
    const clean = raw.replace(NOT_CODE_CONTEXT, (s) => ' '.repeat(s.length));
    const cues = [...clean.matchAll(new RegExp(CODE_CONTEXT.source, 'gi'))].map((c) => [c.index, c.index + c[0].length]);
    if (!cues.length) continue;
    // Spaced or dashed digit groups first ("482 913"), then plain runs (also "G-123456"), then mixed letters and digits.
    const patterns = [
      /(?<![\d$€£.,])(\d{3,4})[ -](\d{3,4})(?![\d%])/g,
      /(?<![\d$€£.,:/])(?:\b[A-Z]-)?(\d{4,8})(?![\d%:/-]|[.,]\d|\s?(?:%|am|pm|kb|mb|minutes?|hours?|days?)\b)/gi,
      /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])([A-Z0-9]{6,8})\b/g,
    ];
    let first: { code: string; display: string } | null = null;
    for (const re of patterns) {
      for (const m of raw.matchAll(re)) {
        // Keep the sender's grouping but drop a prefix like "G-".
        const display = (m.length > 2 && m[2] ? m[0] : m[1] ?? m[0]).trim();
        const code = display.replace(/[ -]/g, '');
        if (NOT_A_CODE.test(code)) continue;
        const start = m.index;
        const end = start + m[0].length;
        // Skip phone numbers, card endings, amounts.
        const before = raw.slice(Math.max(0, start - 24), start).toLowerCase();
        if (/(ending|ends in|card|account|order|phone|call|tel|#|pr|issue|ticket|pull request|room|unit|suite|apt)\s*$/.test(before)) continue;
        // Part of a longer dashed, dotted or bracketed number: a phone line.
        if (/(\d[-.]|\)\s?)$/.test(raw.slice(Math.max(0, start - 2), start)) || /^[-.]\d/.test(raw.slice(end, end + 2))) continue;
        // A zip code after a state ("IL 62704").
        if (/\b[A-Z]{2}\s$/.test(raw.slice(Math.max(0, start - 4), start))) continue;
        const found = { code, display };
        // A code sits right next to the word for it; anything else is a fallback.
        if (cues.some(([a, b]) => (start >= b && start - b <= 40) || (end <= a && a - end <= 20))) return found;
        first ??= found;
      }
    }
    if (first) return first;
  }
  return null;
}

// Status words like "delivered" don't count: newsletters "deliver" too.
const SHIP_CONTEXT = /\b(package|parcel|shipment|ship(ping)? (update|confirmation)|order|tracking|courier|carrier)\b/i;

export function packageStatus(text: string): PackageStatus | null {
  const t = text.toLowerCase();
  if (/delivery (exception|attempt(ed)?|failed)|could not be delivered|delayed|return(ed)? to sender/.test(t)) return 'problem';
  if (/\bdelivered\b/.test(t) && !/\b(will be|to be|get|be) delivered\b/.test(t)) return 'delivered';
  if (/out for delivery|arriving today|arrives today/.test(t)) return 'out-for-delivery';
  if (/\b(has shipped|have shipped|order shipped|shipped|on (its|the) way|in transit|dispatched|handed (it )?to)\b/.test(t)) return 'shipped';
  if (/\border (has been |was |is )?(placed|confirmed)\b|\bwe('ve| have) received your order\b/.test(t)) return 'ordered';
  return null;
}

const CARRIERS: { name: string; re: RegExp; url: (n: string) => string }[] = [
  { name: 'UPS', re: /\b1Z[0-9A-Z]{16}\b/, url: (n) => `https://www.ups.com/track?tracknum=${n}` },
  { name: 'USPS', re: /\b(9[2-5]\d{20}|9[2-5]\d{18}|[A-Z]{2}\d{9}US)\b/, url: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}` },
  { name: 'FedEx', re: /\b(\d{12}|\d{15})\b/, url: (n) => `https://www.fedex.com/fedextrack/?trknbr=${n}` },
  { name: 'DHL', re: /\b\d{10}\b/, url: (n) => `https://www.dhl.com/global-en/home/tracking.html?tracking-id=${n}` },
];

function trackingNumber(t: MessageText): { number: string; carrier?: string; url?: string } | null {
  const labelled = fact(t, 'tracking number', 'tracking no', 'tracking #', 'tracking id', 'tracking');
  const named = /\b(ups|usps|fedex|dhl|ontrac|lasership|amazon logistics|royal mail|canada post|australia post)\b/i.exec(t.text)?.[1];
  if (labelled) {
    const number = labelled.replace(/\s+/g, '');
    const carrier = CARRIERS.find((c) => c.re.test(number))?.name ?? named;
    const def = CARRIERS.find((c) => c.name === carrier);
    return { number: labelled, carrier: fact(t, 'carrier', 'shipped with', 'courier') ?? carrier, url: def?.url(number) };
  }
  for (const c of CARRIERS.slice(0, 2)) {
    const m = c.re.exec(t.text);
    if (m) return { number: m[0], carrier: c.name, url: c.url(m[0]) };
  }
  // FedEx and DHL numbers are plain digits; only trust them with the carrier named.
  if (named) {
    const c = CARRIERS.find((x) => x.name.toLowerCase() === named.toLowerCase());
    const m = c?.re.exec(t.text);
    if (c && m) return { number: m[0], carrier: c.name, url: c.url(m[0]) };
  }
  return null;
}

function orderNumber(t: MessageText): string | undefined {
  const n =
    /\border\s*(?:#|no\.?|number|id)?\s*:?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{4,})\b/i.exec(t.text)?.[1] ??
    fact(t, 'order number', 'order no', 'order #', 'order id');
  return n?.replace(/^#/, '');
}

const DISCOUNT = /\b(?:up to\s+)?\d{1,2}% off\b|\bsave (?:up to\s+)?(?:\d{1,2}%|\$\d+(?:\.\d{2})?)|\$\d+(?:\.\d{2})? off\b|\bfree shipping\b|\bbuy one,? get one\b|\bbogo\b|\bhalf off\b/i;
const EXPIRY = /\b(?:ends|expires|through|until|ending|last day|valid through|offer ends)\s+(today|tonight|tomorrow|this weekend|(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?|midnight)\b/i;
const PROMO_CODE = /\b(?:use code|promo code|discount code|coupon code|with code|code)\s*:?\s*["“]?([A-Z][A-Z0-9]{3,15})\b/;

export function findDeal(text: string): DealInfo | null {
  const discount = DISCOUNT.exec(text)?.[0];
  const expiry = EXPIRY.exec(text);
  const code = PROMO_CODE.exec(text)?.[1];
  if (!discount && !code) return null;
  return {
    kind: 'deal',
    discount: discount ? discount[0].toUpperCase() + discount.slice(1) : undefined,
    expires: expiry ? `${expiry[0].split(/\s+/)[0][0].toUpperCase()}${expiry[0].split(/\s+/)[0].slice(1).toLowerCase()} ${expiry[1]}` : undefined,
    code,
  };
}

/** Most specific first. */
export function analyzeMessage(m: Message, categories: string[] = m.labelIds): SmartInfo[] {
  const t = messageText(m);
  const merchant = senderName(m.from);
  const head = `${m.subject}\n${m.snippet}`;
  const out: SmartInfo[] = [];
  const promo = categories.includes('CATEGORY_PROMOTIONS');

  const code = !promo ? findCode(m.subject, m.snippet, t.text) : null;
  if (code) out.push({ kind: 'code', ...code, service: merchant });

  const status = packageStatus(m.subject) ?? packageStatus(t.lines.slice(0, 8).join(' '));
  const tracking = trackingNumber(t);
  // A food-delivery receipt says "delivered" too; without a tracking number the receipt wins.
  const receiptish = /\breceipt\b|\bpayment received\b/i.test(head);
  if (status && !promo && (tracking || (SHIP_CONTEXT.test(head) && !receiptish))) {
    out.push({
      kind: 'package',
      status,
      merchant:
        /\bfrom ((?:\p{Lu}|\d)[\p{L}\p{N}&'’. ]{1,40})/u.exec(m.subject)?.[1]?.trim() ??
        /\byour ((?:\p{Lu}|\d)[\p{L}\p{N}&'’. ]{1,40}?) order\b/iu.exec(m.subject)?.[1]?.trim() ??
        /^((?:\p{Lu})[\p{L}\p{N}&'’. ]{1,40}?) (?:shipped|has shipped)/mu.exec(t.text)?.[1],
      carrier: tracking?.carrier,
      tracking: tracking?.number,
      orderNo: orderNumber(t),
      eta: fact(t, 'estimated delivery', 'expected delivery', 'arriving', 'delivery date', 'delivery window', 'estimated arrival'),
      trackUrl: link(t, /track/i) ?? tracking?.url,
    });
  }

  const checkIn = fact(t, 'check-in', 'check in', 'arrival');
  const checkOut = fact(t, 'check-out', 'check out', 'departure');
  const flightNo = fact(t, 'flight') ?? /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b(?=.*\b(economy|business|first|seat|depart))/i.exec(t.text)?.[0];
  const routeMatch = /\b([A-Z]{3})\b[^\n]{0,40}?\bto\b[^\n]{0,4}?\b([A-Z]{3})\b/.exec(fact(t, 'outbound', 'departure', 'route', 'itinerary') ?? t.text);
  if ((flightNo || /\bflight\b|boarding pass|itinerary/i.test(head)) && routeMatch) {
    out.push({
      kind: 'flight',
      airline: merchant,
      confirmation: fact(t, 'confirmation', 'confirmation code', 'booking reference', 'record locator') ?? /confirmation[:\s]+([A-Z0-9]{6})\b/i.exec(head)?.[1],
      flight: flightNo?.split(',')[0],
      route: { from: routeMatch[1], to: routeMatch[2] },
      when: fact(t, 'outbound', 'departure', 'departs', 'date'),
      url: link(t, /manage|check[- ]?in|booking|trip/i),
    });
  } else if (checkIn && checkOut) {
    out.push({ kind: 'stay', name: merchant, checkIn, checkOut, confirmation: fact(t, 'confirmation', 'reservation', 'booking'), url: link(t, /manage|reservation|booking/i) });
  }

  const due = fact(t, 'due date', 'due by', 'payment due', 'due');
  const amountDue = fact(t, 'amount due', 'balance due', 'minimum payment', 'statement balance', 'total due');
  if (amountDue || (due && /\bbill\b|statement|invoice|payment due/i.test(head))) {
    out.push({
      kind: 'bill',
      merchant,
      amount: amountDue ?? MONEY.exec(head)?.[0],
      due,
      autopay: fact(t, 'autopay', 'auto pay', 'automatic payment'),
      url: link(t, /view bill|pay|statement|invoice/i),
    });
  } else if (!out.some((s) => s.kind === 'package' || s.kind === 'flight' || s.kind === 'stay')) {
    const orderNo = orderNumber(t);
    const total = fact(t, 'total', 'order total', 'grand total', 'total paid', 'amount paid', 'amount charged', 'charged');
    if ((orderNo || /receipt|payment received|your order|order confirm/i.test(head)) && total && MONEY.test(total)) {
      const items = t.lines
        .filter((l) => l.includes('\t') && MONEY.test(l) && !/total|subtotal|tax|shipping|tip|discount/i.test(l))
        .map((l) => l.split('\t').filter(Boolean)[0])
        .filter((s): s is string => !!s && !MONEY.test(s))
        .slice(0, 4);
      out.push({ kind: 'receipt', merchant, orderNo: orderNo?.replace(/^#/, ''), total, items, url: link(t, /view (order|receipt)|order details|manage/i) });
    }
  }

  const pickupBy = fact(t, 'pick up by', 'pickup by', 'ready until');
  if (pickupBy) out.push({ kind: 'pickup', what: t.lines.find((l) => /ready for pick ?up/i.test(l)) ?? m.subject, by: pickupBy });

  if ((promo || m.headers.listUnsubscribe) && !categories.includes('SPAM')) {
    const deal = findDeal(`${m.subject}\n${m.snippet}\n${t.text.slice(0, 3000)}`);
    if (deal) out.push({ ...deal, url: deal.url ?? t.links.find((l) => /shop|buy|deal|sale|offer/i.test(l.text))?.href });
  }
  return out;
}

export type RowSmart =
  | { kind: 'code'; code: string; display: string }
  | { kind: 'package'; status: PackageStatus }
  | { kind: 'invite' }
  | { kind: 'bill'; amount?: string }
  | { kind: 'deal'; discount?: string; expires?: string; code?: string }
  | { kind: 'nudge'; days: number };

/** Subject and snippet only, without opening the thread. */
export function analyzeRow(t: ThreadSummary, me: Me, now = Date.now()): RowSmart | null {
  if (t.labelIds.includes('SPAM') || t.labelIds.includes('TRASH')) return null;
  const head = `${t.subject}\n${t.snippet}`;
  const promo = t.labelIds.includes('CATEGORY_PROMOTIONS');
  if (!promo) {
    const code = findCode(t.subject, t.snippet);
    if (code) return { kind: 'code', ...code };
  }
  const status = packageStatus(t.subject) ?? packageStatus(t.snippet);
  // "Out for delivery" and "shipped" are specific enough; "delivered" needs a shipping word nearby.
  if (status && !promo && (status !== 'delivered' || SHIP_CONTEXT.test(head))) return { kind: 'package', status };
  if (/^(updated )?invitation:/i.test(t.subject) || t.attachments.some((a) => a.mimeType === 'text/calendar' || /\.ics$/i.test(a.filename))) {
    return { kind: 'invite' };
  }
  if (/\bbill\b.*\bready\b|amount due|payment due/i.test(head)) return { kind: 'bill', amount: MONEY.exec(head)?.[0] };
  if (promo) {
    const deal = findDeal(head);
    if (deal) return { kind: 'deal', discount: deal.discount, expires: deal.expires, code: deal.code };
  }
  const toMe = !!me && !!t.recipients?.some((r) => isMe(r.email, me));
  const days = Math.floor((now - t.lastDate) / 86_400_000);
  const personal = !t.labelIds.some((l) => l.startsWith('CATEGORY_') && l !== 'CATEGORY_PERSONAL');
  if (
    t.labelIds.includes('INBOX') &&
    personal &&
    !t.labelIds.includes('UNREAD') &&
    days >= 3 &&
    days <= 14 &&
    (toMe || (!t.recipients && !!me && !isMe(t.participants[t.participants.length - 1]?.email ?? '', me))) &&
    /\?/.test(t.snippet)
  ) {
    return { kind: 'nudge', days };
  }
  return null;
}

export const PACKAGE_STEPS: { status: PackageStatus; label: string }[] = [
  { status: 'ordered', label: 'Ordered' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'out-for-delivery', label: 'Out for delivery' },
  { status: 'delivered', label: 'Delivered' },
];

export function packageLabel(s: PackageStatus): string {
  return { ordered: 'Ordered', shipped: 'Shipped', 'out-for-delivery': 'Out for delivery', delivered: 'Delivered', problem: 'Delivery problem' }[s];
}

export interface CalendarEvent {
  uid: string;
  method?: string;
  title: string;
  start: number;
  end?: number;
  allDay: boolean;
  location?: string;
  description?: string;
  organizer?: Address;
  attendees: (Address & { status?: string })[];
  sequence?: number;
  raw: string;
}

function unfold(ics: string) {
  return ics.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function icsUnescape(s: string) {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function icsDate(value: string, params: string): { ms: number; allDay: boolean } {
  const v = value.trim();
  if (/VALUE=DATE(?!-TIME)/.test(params) || /^\d{8}$/.test(v)) {
    return { ms: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)).getTime(), allDay: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return { ms: Date.parse(v), allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  const tz = /TZID=("?)([^";:]+)\1/i.exec(params)?.[2];
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false };
  if (tz) {
    const zoned = zonedToUtc(+y, +mo - 1, +d, +h, +mi, +(s ?? 0), tz);
    if (zoned !== null) return { ms: zoned, allDay: false };
  }
  return { ms: new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)).getTime(), allDay: false };
}

/** Wall-clock time in an IANA zone to epoch ms. */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number | null {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return null;
  }
  const wall = Date.UTC(y, mo, d, h, mi, s);
  const offsetAt = (ms: number) => {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second) - ms;
  };
  // Two passes settle the offset across DST changes.
  let guess = wall - offsetAt(wall);
  guess = wall - offsetAt(guess);
  return guess;
}

function mailto(value: string, params: string): Address {
  const email = value.replace(/^mailto:/i, '').trim();
  const cn = /CN=("([^"]*)"|[^;:]*)/i.exec(params);
  return { email, name: cn ? (cn[2] ?? cn[1]).trim() || undefined : undefined };
}

/** The first VEVENT. */
export function parseIcs(ics: string): CalendarEvent | null {
  const text = unfold(ics);
  if (!/BEGIN:VEVENT/i.test(text)) return null;
  const method = /^METHOD:(.+)$/im.exec(text)?.[1]?.trim();
  const body = text.slice(text.search(/BEGIN:VEVENT/i), text.search(/END:VEVENT/i));
  const ev: CalendarEvent = { uid: '', method, title: '(No title)', start: 0, allDay: false, attendees: [], raw: ics };
  // Properties of nested components (VALARM) belong to them.
  let depth = 0;
  for (const line of body.split(/\r?\n/)) {
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:/i.test(line)) depth--;
    if (depth !== 1) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [name, ...paramParts] = line.slice(0, idx).split(';');
    const params = paramParts.join(';');
    const value = line.slice(idx + 1);
    switch (name.toUpperCase()) {
      case 'UID':
        ev.uid = value.trim();
        break;
      case 'SUMMARY':
        ev.title = icsUnescape(value).trim() || ev.title;
        break;
      case 'LOCATION':
        ev.location = icsUnescape(value).trim() || undefined;
        break;
      case 'DESCRIPTION':
        ev.description = icsUnescape(value).trim() || undefined;
        break;
      case 'DTSTART': {
        const d = icsDate(value, params);
        ev.start = d.ms;
        ev.allDay = d.allDay;
        break;
      }
      case 'DTEND':
        ev.end = icsDate(value, params).ms;
        break;
      case 'SEQUENCE':
        ev.sequence = Number(value) || 0;
        break;
      case 'ORGANIZER':
        ev.organizer = mailto(value, params);
        break;
      case 'ATTENDEE':
        ev.attendees.push({ ...mailto(value, params), status: /PARTSTAT=([A-Z-]+)/i.exec(params)?.[1] });
        break;
    }
  }
  return ev.start ? ev : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
function stamp(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

export type Rsvp = 'ACCEPTED' | 'TENTATIVE' | 'DECLINED';

/** iMIP REPLY (RFC 6047). */
export function buildIcsReply(ev: CalendarEvent, me: Address, answer: Rsvp, now = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Expressive Gmail//RSVP//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(ev.start)}`,
    ...(ev.end ? [`DTEND:${stamp(ev.end)}`] : []),
    `SEQUENCE:${ev.sequence ?? 0}`,
    `SUMMARY:${esc(ev.title)}`,
    ...(ev.organizer ? [`ORGANIZER${ev.organizer.name ? `;CN=${esc(ev.organizer.name)}` : ''}:mailto:${ev.organizer.email}`] : []),
    `ATTENDEE;PARTSTAT=${answer}${me.name ? `;CN=${esc(me.name)}` : ''}:mailto:${me.email}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n');
}

/** RFC 5545: at most 75 octets, continuation lines start with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = '';
  for (const ch of line) {
    const limit = out.length ? 74 : 75;
    if (bytes.encode(current + ch).length > limit) {
      out.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.join('\r\n ');
}

/** Google Calendar's "add event" link. */
export function googleCalendarUrl(ev: CalendarEvent): string {
  const dates = ev.allDay
    ? `${new Date(ev.start).toISOString().slice(0, 10).replace(/-/g, '')}/${new Date(ev.end ?? ev.start + 86_400_000).toISOString().slice(0, 10).replace(/-/g, '')}`
    : `${stamp(ev.start)}/${stamp(ev.end ?? ev.start + 3_600_000)}`;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates });
  if (ev.location) p.set('location', ev.location);
  if (ev.description) p.set('details', ev.description.slice(0, 1500));
  return `https://calendar.google.com/calendar/render?${p}`;
}

const SCRIPTS: [RegExp, string][] = [
  [/[\u3040-\u30ff]/, 'Japanese'],
  [/[\uac00-\ud7af]/, 'Korean'],
  [/[\u4e00-\u9fff]/, 'Chinese'],
  [/[\u0600-\u06ff]/, 'Arabic'],
  [/[\u0590-\u05ff]/, 'Hebrew'],
  [/[\u0400-\u04ff]/, 'Russian'],
  [/[\u0e00-\u0e7f]/, 'Thai'],
  [/[\u0900-\u097f]/, 'Hindi'],
  [/[\u0370-\u03ff]/, 'Greek'],
];
const STOPWORDS: [string, string[]][] = [
  ['Spanish', ['que', 'de', 'el', 'los', 'por', 'para', 'con', 'una', 'está', 'muy', 'pero', 'hola']],
  ['Portuguese', ['que', 'não', 'você', 'para', 'com', 'uma', 'um', 'obrigado', 'obrigada', 'olá', 'está', 'muito', 'mas', 'o', 'os', 'as', 'e', 'em', 'do', 'da', 'no', 'na', 'é', 'seu', 'sua', 'até', 'se', 'ao', 'das', 'dos']],
  ['French', ['le', 'les', 'des', 'est', 'pour', 'avec', 'une', 'vous', 'nous', 'mais', 'bonjour', 'très']],
  ['German', ['und', 'der', 'die', 'das', 'ist', 'nicht', 'mit', 'für', 'auch', 'wir', 'ich', 'liebe']],
  ['Italian', ['che', 'il', 'per', 'con', 'una', 'sono', 'non', 'anche', 'ciao', 'grazie', 'molto']],
];
const ENGLISH = ['the', 'and', 'you', 'that', 'for', 'with', 'this', 'are', 'have', 'your', 'will', 'just'];

/** For the "Translate message" offer. Null for English. */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 2000);
  for (const [re, name] of SCRIPTS) {
    const count = (sample.match(new RegExp(re.source, 'g')) ?? []).length;
    if (count >= 6) return name;
  }
  const words = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 8) return null;
  const score = (list: string[]) => words.filter((w) => list.includes(w)).length / words.length;
  const en = score(ENGLISH);
  let best: [string, number] | null = null;
  for (const [name, list] of STOPWORDS) {
    const s = score(list);
    if (!best || s > best[1]) best = [name, s];
  }
  return best && best[1] > 0.12 && best[1] > en * 1.5 ? best[0] : null;
}

export function translateUrl(text: string): string {
  return `https://translate.google.com/?sl=auto&tl=en&op=translate&text=${encodeURIComponent(text.slice(0, 4500))}`;
}

/** Signs Gmail would flag with "Be careful with this message". */
export function phishingSignals(m: Message, html: string | undefined): string[] {
  const out: string[] = [];
  const fromDomain = m.from.email.split('@')[1]?.toLowerCase() ?? '';
  const replyDomain = m.replyTo?.[0]?.email.split('@')[1]?.toLowerCase();
  const asks = /\b(password|verify your account|confirm your (identity|account)|suspended|unusual (sign-?in|activity)|gift card|wire transfer|bank details|ssn|social security)\b/i.test(`${m.subject} ${m.bodyText ?? ''} ${html ?? ''}`);
  if (replyDomain && replyDomain !== fromDomain && asks) out.push(`Replies go to ${replyDomain}, not ${fromDomain}`);
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const a of doc.querySelectorAll('a[href]')) {
      const text = (a.textContent ?? '').trim();
      const href = a.getAttribute('href') ?? '';
      const shown = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i.exec(text);
      if (!shown || !/^https?:/i.test(href)) continue;
      try {
        const shownHost = new URL(/^https?:/i.test(text) ? text : `https://${text}`).hostname.replace(/^www\./, '');
        const realHost = new URL(href).hostname.replace(/^www\./, '');
        if (shownHost !== realHost && !realHost.endsWith(`.${shownHost}`)) {
          out.push(`A link shows ${shownHost} but goes to ${realHost}`);
          break;
        }
      } catch {
        // Unparseable link; nothing to compare.
      }
    }
  }
  const display = m.from.name ?? '';
  if (/@/.test(display) && !display.toLowerCase().includes(fromDomain)) out.push(`The sender name shows an address that isn't ${m.from.email}`);
  return out;
}

/** A free-text estimate ("Tuesday, October 6"). Times of day and ranges without a date never count as passed. */
export function etaPassed(eta: string | undefined, now = Date.now()): boolean {
  const day = parseDay(eta, now);
  return day !== null && day < startOfDay(now);
}
