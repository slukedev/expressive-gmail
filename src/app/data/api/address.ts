/**
 * RFC 5322 address lists: parsing what Gmail hands us and formatting what we send. Edge cases handled:
 * commas count only outside quotes, angle brackets and comments ("Doe, Jane" <jane@x.com>); escaped quotes are unescaped;
 * groups ("Team: a@x.com;", "undisclosed-recipients:;") yield their members; comment names ("a@x.com (Jane)") become the name;
 * an unclosed "<" or quote reads to the end of the entry; entries without "@" are skipped;
 * a decoded encoded-word name may hold a bare comma or colon (Doe, Jane <j@x.com>), so a fragment with no "@" joins the next
 * bracketed address and a colon only starts a group when a ";" follows; a name that just repeats the address is dropped.
 * Encoded words are already decoded (by the Gmail API, or the raw MIME parser).
 */
import type { Address } from '../types';
import { encodeWords, isAscii } from './encoded-words';

interface RawEntry {
  display: string;
  angle?: string;
  comment: string;
}

function splitEntries(input: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let display = '';
  let angle: string | undefined;
  let comment = '';
  let inQuote = false;
  let inAngle = false;
  let commentDepth = 0;
  const hasGroupEnd = input.includes(';');

  const flush = () => {
    entries.push({ display, angle, comment });
    display = '';
    angle = undefined;
    comment = '';
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < input.length) {
        display += input[++i];
      } else if (ch === '"') {
        inQuote = false;
      } else {
        display += ch;
      }
      continue;
    }
    if (commentDepth > 0) {
      if (ch === '\\' && i + 1 < input.length) comment += input[++i];
      else if (ch === '(') {
        commentDepth++;
        comment += ch;
      } else if (ch === ')') {
        commentDepth--;
        if (commentDepth > 0) comment += ch;
      } else comment += ch;
      continue;
    }
    if (inAngle) {
      if (ch === '>') inAngle = false;
      else angle = (angle ?? '') + ch;
      continue;
    }
    switch (ch) {
      case '"':
        inQuote = true;
        break;
      case '(':
        commentDepth = 1;
        break;
      case '<':
        inAngle = true;
        angle = '';
        break;
      case ':':
        // A real group always ends in ";", so without one the colon is just text (a decoded name such as "Re: Team <a@x.com>").
        if (hasGroupEnd) {
          display = '';
          comment = '';
        } else {
          display += ch;
        }
        break;
      case ';':
      case ',':
        flush();
        break;
      default:
        display += ch;
    }
  }
  flush();
  return entries;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

export function parseAddressList(input: string | undefined | null): Address[] {
  if (!input) return [];
  const out: Address[] = [];
  // Name fragments split off by an unquoted comma (a decoded encoded-word name) carry to the next entry.
  let carry = '';
  for (const entry of splitEntries(input)) {
    const comment = collapse(entry.comment);
    let display = collapse(entry.display);
    if (entry.angle === undefined && !display.includes('@')) {
      if (display) carry = carry ? `${carry}, ${display}` : display;
      continue;
    }
    if (carry && entry.angle !== undefined) display = display ? `${carry}, ${display}` : carry;
    carry = '';
    let email: string;
    let name: string | undefined;
    if (entry.angle !== undefined) {
      email = collapse(entry.angle).replace(/\s/g, '');
      name = display || comment || undefined;
    } else {
      email = display.replace(/\s/g, '');
      name = comment || undefined;
    }
    if (!email.includes('@')) continue;
    if (name && name.toLowerCase() === email.toLowerCase()) name = undefined;
    out.push(name ? { name, email } : { email });
  }
  return out;
}

export function parseAddress(input: string | undefined | null): Address | undefined {
  return parseAddressList(input)[0];
}

/** RFC 5322 specials force a display name into a quoted string. */
const SPECIALS = /[()<>[\]:;@\\,."]/;

function stripCrlf(s: string): string {
  return s.replace(/[\r\n]+/g, ' ');
}

/** Non-ASCII names are encoded per RFC 2047. */
export function formatAddress(address: Address): string {
  const email = stripCrlf(address.email).trim();
  const name = address.name ? collapse(stripCrlf(address.name)) : '';
  if (!name) return email;
  if (!isAscii(name)) return `${encodeWords(name, ' ')} <${email}>`;
  if (SPECIALS.test(name)) return `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>`;
  return `${name} <${email}>`;
}

export function formatAddressList(list: Address[]): string {
  return list.map(formatAddress).join(', ');
}

/** By lowercased email, first occurrence order. */
export function dedupeAddresses<T extends Address>(list: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of list) {
    const key = a.email.toLowerCase();
    if (seen.has(key)) {
      // Fill in a name learned later.
      const existing = out.find((x) => x.email.toLowerCase() === key);
      if (existing && !existing.name && a.name) existing.name = a.name;
      continue;
    }
    seen.add(key);
    out.push({ ...a });
  }
  return out;
}
