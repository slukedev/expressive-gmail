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
    if (deal) out.push({ ...deal, url: deal.url ?? link(t, /shop|buy|deal|sale|offer/i) });
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
  /** For an all-day event, its calendar dates as written (YYYYMMDD, end exclusive). No time zone can move them. */
  days?: { start: string; end: string };
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

/** Outlook names zones the Windows way; CLDR's windowsZones maps them to IANA names. */
const WINDOWS_ZONES: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Aleutian Standard Time': 'America/Adak',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Mountain Standard Time': 'America/Denver',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Venezuela Standard Time': 'America/Caracas',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Western Standard Time': 'America/La_Paz',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'Greenland Standard Time': 'America/Godthab',
  'Montevideo Standard Time': 'America/Montevideo',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  'UTC': 'Etc/UTC',
  'Coordinated Universal Time': 'Etc/UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Jordan Standard Time': 'Asia/Amman',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kiev',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Calcutta',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Katmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Myanmar Standard Time': 'Asia/Rangoon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Chatham Islands Standard Time': 'Pacific/Chatham',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
  'Line Islands Standard Time': 'Pacific/Kiritimati',
};

interface ZoneRule {
  /** Minutes east of UTC. */
  offset: number;
  /** Local wall time the rule starts at each year: month (0-11), weekday (0 Sunday), which one (-1 last), hour, minute. */
  yearly?: { month: number; weekday: number; nth: number; hour: number; minute: number };
}
/** A VTIMEZONE: the zone's standard and daylight rules, for TZIDs that aren't IANA names. */
type ZoneRules = ZoneRule[];

function icsDate(value: string, params: string, zones: Map<string, ZoneRules>): { ms: number; allDay: boolean; day?: string } {
  const v = value.trim();
  if (/VALUE=DATE(?!-TIME)/i.test(params) || /^\d{8}$/.test(v)) {
    const day = v.slice(0, 8);
    return { ms: new Date(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8)).getTime(), allDay: true, day };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!m) return { ms: Date.parse(v), allDay: false };
  const [, y, mo, d, h, mi, s, z] = m;
  const tz = /TZID=("?)([^";:]+)\1/i.exec(params)?.[2]?.trim();
  if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false };
  if (tz) {
    const iana = WINDOWS_ZONES[tz] ?? tz;
    const zoned = zonedToUtc(+y, +mo - 1, +d, +h, +mi, +(s ?? 0), iana) ?? ruledToUtc(+y, +mo - 1, +d, +h, +mi, +(s ?? 0), zones.get(tz));
    if (zoned !== null) return { ms: zoned, allDay: false };
  }
  return { ms: new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)).getTime(), allDay: false };
}

/** Wall-clock time in an IANA zone to epoch ms. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number | null {
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

/** Wall-clock time under a VTIMEZONE's own rules: the rule that started most recently before it wins. */
function ruledToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, rules: ZoneRules | undefined): number | null {
  if (!rules?.length) return null;
  const wall = Date.UTC(y, mo, d, h, mi, s);
  const fixed = rules.find((r) => !r.yearly) ?? rules[0]!;
  const yearly = rules.filter((r) => r.yearly);
  if (yearly.length < 2) return wall - fixed.offset * 60_000;
  const startOf = (r: ZoneRule, year: number) => {
    const { month, weekday, nth, hour, minute } = r.yearly!;
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    let day = 1 + ((weekday - first + 7) % 7) + (nth > 0 ? (nth - 1) * 7 : 0);
    if (nth < 0) while (day + 7 <= days) day += 7;
    return Date.UTC(year, month, day, hour, minute);
  };
  let current: ZoneRule | undefined;
  let latest = -Infinity;
  for (const r of yearly) {
    for (const year of [y - 1, y]) {
      const at = startOf(r, year);
      if (at <= wall && at > latest) {
        latest = at;
        current = r;
      }
    }
  }
  return wall - (current ?? fixed).offset * 60_000;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function zoneRule(lines: string[]): ZoneRule | undefined {
  const prop = (name: string) => lines.find((l) => l.toUpperCase().startsWith(`${name}:`))?.slice(name.length + 1).trim();
  const to = /^([+-])(\d{2})(\d{2})/.exec(prop('TZOFFSETTO') ?? '');
  if (!to) return undefined;
  const offset = (to[1] === '-' ? -1 : 1) * (+to[2]! * 60 + +to[3]!);
  const rrule = prop('RRULE') ?? '';
  const month = /BYMONTH=(\d{1,2})/i.exec(rrule)?.[1];
  const byday = /BYDAY=([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)/i.exec(rrule);
  const start = /T(\d{2})(\d{2})/.exec(prop('DTSTART') ?? '');
  if (!month || !byday) return { offset };
  return {
    offset,
    yearly: { month: +month - 1, weekday: WEEKDAYS.indexOf(byday[2]!.toUpperCase()), nth: +(byday[1] ?? 1), hour: +(start?.[1] ?? 0), minute: +(start?.[2] ?? 0) },
  };
}

/** Each VTIMEZONE's rules by TZID. */
function zoneRules(lines: string[]): Map<string, ZoneRules> {
  const zones = new Map<string, ZoneRules>();
  let tzid: string | undefined;
  let rules: ZoneRules = [];
  let part: string[] | undefined;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VTIMEZONE') {
      tzid = undefined;
      rules = [];
    } else if (upper === 'END:VTIMEZONE') {
      if (tzid) zones.set(tzid, rules);
    } else if (upper === 'BEGIN:STANDARD' || upper === 'BEGIN:DAYLIGHT') {
      part = [];
    } else if (upper === 'END:STANDARD' || upper === 'END:DAYLIGHT') {
      const rule = part && zoneRule(part);
      if (rule) rules.push(rule);
      part = undefined;
    } else if (part) {
      part.push(line);
    } else if (upper.startsWith('TZID:')) {
      tzid = line.slice(5).trim();
    }
  }
  return zones;
}

/** The colon that ends the parameters: one inside a quoted value (CN="Doe: PM") doesn't count. */
function splitProperty(line: string): { name: string; params: string; value: string } | null {
  let quoted = false;
  const cuts: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ';') cuts.push(i);
    else if (!quoted && ch === ':') {
      const head = line.slice(0, i);
      const first = cuts[0] ?? i;
      return { name: head.slice(0, first), params: cuts.length ? head.slice(first + 1) : '', value: line.slice(i + 1) };
    }
  }
  return null;
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
  const zones = zoneRules(text.split(/\r?\n/));
  const body = text.slice(text.search(/BEGIN:VEVENT/i), text.search(/END:VEVENT/i));
  const ev: CalendarEvent = { uid: '', method, title: '(No title)', start: 0, allDay: false, attendees: [], raw: ics };
  let endDay: string | undefined;
  // Properties of nested components (VALARM) belong to them.
  let depth = 0;
  for (const line of body.split(/\r?\n/)) {
    if (/^BEGIN:/i.test(line)) depth++;
    else if (/^END:/i.test(line)) depth--;
    if (depth !== 1) continue;
    const prop = splitProperty(line);
    if (!prop) continue;
    const { name, params, value } = prop;
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
        const d = icsDate(value, params, zones);
        ev.start = d.ms;
        ev.allDay = d.allDay;
        if (d.day) ev.days = { start: d.day, end: nextDay(d.day) };
        break;
      }
      case 'DTEND': {
        const d = icsDate(value, params, zones);
        ev.end = d.ms;
        endDay = d.day;
        break;
      }
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
  if (ev.days && endDay && endDay > ev.days.start) ev.days.end = endDay;
  if (!ev.allDay) delete ev.days;
  return ev.start ? ev : null;
}

/** The calendar day after YYYYMMDD. */
function nextDay(day: string): string {
  const d = new Date(Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8) + 1));
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
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
    ...(ev.allDay && ev.days
      ? [`DTSTART;VALUE=DATE:${ev.days.start}`, `DTEND;VALUE=DATE:${ev.days.end}`]
      : [`DTSTART:${stamp(ev.start)}`, ...(ev.end ? [`DTEND:${stamp(ev.end)}`] : [])]),
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
  const dates = ev.allDay && ev.days ? `${ev.days.start}/${ev.days.end}` : `${stamp(ev.start)}/${stamp(ev.end ?? ev.start + 3_600_000)}`;
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates });
  if (ev.location) p.set('location', ev.location);
  if (ev.description) p.set('details', ev.description.slice(0, 1500));
  return `https://calendar.google.com/calendar/render?${p}`;
}

const KANA = /[\u3040-\u30ff]/g;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/g;
const HANGUL = /[\uac00-\ud7af\u1100-\u11ff]/g;
const SCRIPTS: [RegExp, string][] = [
  [/[\u0600-\u06ff]/g, 'Arabic'],
  [/[\u0590-\u05ff]/g, 'Hebrew'],
  [/[\u0400-\u04ff]/g, 'Russian'],
  [/[\u0e00-\u0e7f]/g, 'Thai'],
  [/[\u0900-\u097f]/g, 'Hindi'],
  [/[\u0370-\u03ff]/g, 'Greek'],
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
  const letters = (sample.match(/\p{L}/gu) ?? []).length;
  const count = (re: RegExp) => (sample.match(re) ?? []).length;
  // A name or a short phrase in another script doesn't make the message that language. One CJK character carries about a word, so a third of the letters is enough there; other scripts need half.
  const cjk = (n: number) => n >= 6 && n >= letters / 3;
  const kana = count(KANA);
  const han = count(HAN);
  const hangul = count(HANGUL);
  if (kana && cjk(kana + han)) return 'Japanese';
  if (hangul && cjk(hangul + han)) return 'Korean';
  if (!kana && !hangul && cjk(han)) return 'Chinese';
  for (const [re, name] of SCRIPTS) {
    const n = count(re);
    if (n >= 6 && n >= letters / 2) return name;
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

/** What the translate offer reads: the body only, and never mail I wrote. */
export function messageLanguage(m: Pick<Message, 'from' | 'bodyHtml' | 'bodyText' | 'snippet' | 'subject'>, me: Me): string | null {
  return isMe(m.from.email, me) ? null : detectLanguage(messageText(m).text);
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
