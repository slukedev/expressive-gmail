/** Where a message says something is attached when nothing is, like Gmail's "Did you mean to attach files?". Only the writer's own words count. */
import { IMAGE_WORDS, LANGUAGES } from './phrases';

/** A link to a file host counts as sending the file. */
const FILE_HOST = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:drive\.google\.com|docs\.google\.com|dropbox\.com|wetransfer\.com|we\.tl|onedrive\.live\.com|1drv\.ms|sharepoint\.com|box\.com|icloud\.com|mega\.nz|disk\.yandex\.(?:ru|com)|cloud\.mail\.ru|pan\.baidu\.com)(?:[/:?#]|$)/i;

/** Reply and forward prefixes in the languages below: that subject came with the earlier mail. */
const CARRIED_SUBJECT = /^\s*(?:(?:re|fwd?|aw|wg|sv|vs|tr|rv|enc|odp|pd|antw|doorst|回复|回覆|转发|轉寄|답장|전달)\s*[:：]\s*)+/iu;

const CLAUSE_BEFORE = /[^.!?;,:。！？；，、\n]*$/u;
const CLAUSE_AFTER = /^[^.!?;,:。！？；，、\n]*/u;
const SENTENCE_BEFORE = /[^.!?。！？\n]*$/u;
const SENTENCE_AFTER = /^[^.!?。！？\n]*/u;

interface OwnContent {
  text: string;
  /** A picture in the writer's part of the body (not the quote or signature). */
  image: boolean;
  fileLink: boolean;
}

/** No quoted mail, no signature, no "> " lines. */
function ownContent(html: string): OwnContent {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('blockquote, .gmail_quote, .gmail_signature, [data-smartmail="gmail_signature"], .gmail_attr, style, script').forEach((el) => el.remove());
  const image = !!doc.body.querySelector('img');
  const fileLink = [...doc.body.querySelectorAll('a[href]')].some((a) => FILE_HOST.test(a.getAttribute('href')!.trim()));
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, div, li').forEach((el) => el.append('\n'));
  const text = (doc.body.textContent ?? '')
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    // "-- " starts a plain signature.
    .split(/\n--\s*\n/)[0]!;
  return { text, image, fileLink };
}

interface Hit {
  phrase: string;
  start: number;
  end: number;
}

const tidy = (s: string) => s.normalize('NFC').replace(/[\t \u00a0\u202f]+/g, ' ');

function* hits(shown: string): Generator<Hit> {
  // One character for one, so a match's place here is its place in what the writer typed.
  const text = shown.replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'");
  for (const lang of LANGUAGES) {
    for (const [own, patterns] of [
      [true, lang.attaching],
      [false, lang.mentions],
    ] as const) {
      for (const re of patterns) {
        for (const m of text.matchAll(re)) {
          const start = m.index;
          const end = start + m[0].length;
          const before = CLAUSE_BEFORE.exec(text.slice(Math.max(0, start - 60), start))![0];
          const after = CLAUSE_AFTER.exec(text.slice(end, end + 40))![0];
          if (lang.negatedBefore.test(before) || lang.negatedAfter?.test(after)) continue;
          if (!own && (lang.receivedBefore.test(before) || lang.receivedAfter?.test(after))) continue;
          if (lang.ignore?.test(text.slice(Math.max(0, start - 20), end + 30))) continue;
          // "Is the report attached?" asks about a file; "I've attached it, OK?" still says it's there.
          if (!own && /^[^.!?。！？\n]*[?？]/u.test(text.slice(end))) continue;
          yield { phrase: shown.slice(start, end).trim(), start, end };
        }
      }
    }
  }
}

function sentence(text: string, { start, end }: Hit) {
  return SENTENCE_BEFORE.exec(text.slice(0, start))![0] + text.slice(start, end) + SENTENCE_AFTER.exec(text.slice(end))![0];
}

/**
 * The phrase to quote back, or null. The subject only counts on new messages: a reply keeps the subject of mail that had the attachment.
 * A picture in the body is what Gmail ignores here, unless the sentence is about a picture.
 */
export function attachmentMention({ subject, html, checkSubject }: { subject: string; html: string; checkSubject: boolean }): string | null {
  const body = ownContent(html);
  if (body.fileLink) return null;
  const sources = (checkSubject && !CARRIED_SUBJECT.test(subject) ? [body.text, subject] : [body.text]).map(tidy);
  for (const text of sources) {
    for (const hit of hits(text)) {
      if (body.image && IMAGE_WORDS.test(sentence(text, hit))) continue;
      return hit.phrase;
    }
  }
  return null;
}
