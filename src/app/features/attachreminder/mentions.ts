/** Where a message says something is attached when nothing is, like Gmail's "Did you mean to attach files?". English only, like Gmail's; only the writer's own words count. */

const NOUNS =
  'file|files|pdf|pdfs|doc|docs|document|documents|copy|copies|photo|photos|picture|pictures|image|images|screenshot|screenshots|scan|scans|invoice|invoices|receipt|receipts|resume|cv|spreadsheet|sheet|deck|slides|contract|form|forms|report|draft|agenda|itinerary|zip';

/** `own`: the writer says they attached it, so "thanks" or "your" nearby doesn't change that. */
const PATTERNS: { re: RegExp; own?: boolean }[] = [
  // "I've attached", "we're enclosing", "I also attached"
  { re: /\b(?:i'?ve|i have|we'?ve|we have|i'?m|i am|we'?re|we are|i|we)\s+(?:also\s+|just\s+|now\s+)?(?:attach(?:ed|ing)|enclos(?:ed|ing))\b/, own: true },
  // "I've included the file", "including the slides"
  { re: new RegExp(`\\b(?:i'?ve|i have|we'?ve|we have|i|we|i'?m|we'?re)\\s+(?:also\\s+)?includ(?:ed|ing)\\s+(?:a|an|the|my|our|both|all|two|three)?\\s*(?:${NOUNS})\\b`), own: true },
  // "Attached is", "Attaching the deck", "Enclosed please find" at the start of a sentence
  { re: /(?:^|[.!?:]\s+|\n\s*)(?:attach(?:ed|ing)|enclosed)\b/, own: true },
  { re: /\bforgot\s+(?:to\s+attach|the\s+attachment)\b/, own: true },
  { re: /\bpfa\b/, own: true },
  // "please find attached", "see the attachment"
  { re: /\b(?:find|see|check|review|open)\s+(?:the\s+)?(?:attached|enclosed|attachments?)\b/ },
  { re: /\battached\s+(?:is|are|you'?ll find|please find|herewith|here|below)\b/ },
  // "the attached file", "an attached copy"
  { re: /\b(?:the|an?|my|our|both|two|three)\s+(?:attached|enclosed)\b/ },
  // "in the attachment", "as an attachment", "attachment below"
  { re: /\b(?:in|see|as|via|by)\s+(?:the\s+|an?\s+)?attachments?\b/ },
  { re: /\battachments?\s+(?:below|here|included|contains?|has|have)\b/ },
  // "receipts are attached", and subject lines like "Contract attached"
  { re: new RegExp(`\\b(?:${NOUNS})\\s+(?:(?:is|are)\\s+)?attached\\b`) },
];

/** "no attachment", "didn't attach", "without the attached": up to three words before. */
const NEGATED = /(?:\bno|\bnot|n't|\bwithout|\bnever)\s+(?:[\w']+\s+){0,2}$/;
/** "thanks for the attached", "got your attachment": about mail that came in, not this one. */
const RECEIVED = /(?:\bthanks?|\bthank you|\bgot|\breceived|\bsaw|\bread|\bopened|\breviewed|\blooked at|\byour|\bhis|\bher|\btheir)\s+(?:[\w']+\s+){0,3}$/;
const EMOTIONAL = /\b(?:so|very|really|pretty|quite|too|grown|getting|got|become|became|deeply|emotionally)\s+attached\b/;
const ATTACHED_TO_PERSON = /\battached\s+to\s+(?:you|him|her|them|it|this idea|the idea|my|our|his|their)\b/;

/** A link to a file host counts as sending the file. */
const FILE_LINK = /href=["']?https?:\/\/(?:[a-z0-9-]+\.)*(?:drive\.google\.com|docs\.google\.com|dropbox\.com|wetransfer\.com|we\.tl|onedrive\.live\.com|1drv\.ms|sharepoint\.com|box\.com|icloud\.com)/i;

/** No quoted mail, no signature, no "> " lines. */
function ownText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('blockquote, .gmail_quote, .gmail_signature, [data-smartmail="gmail_signature"], .gmail_attr, style, script').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p, div, li').forEach((el) => el.append('\n'));
  const text = (doc.body.textContent ?? '').replace(/\u00a0/g, ' ');
  return text
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    // "-- " starts a plain signature.
    .join('\n')
    .split(/\n--\s*\n/)[0]!
    .replace(/[ \t]+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'");
}

function find(text: string): string | null {
  const lower = text.toLowerCase();
  for (const { re, own } of PATTERNS) {
    for (const m of lower.matchAll(new RegExp(re.source, 'g'))) {
      const phrase = m[0].replace(/^[\s.!?:]+/, '');
      const start = (m.index ?? 0) + (m[0].length - phrase.length);
      const before = lower.slice(Math.max(0, start - 40), start);
      const around = lower.slice(Math.max(0, start - 20), start + phrase.length + 30);
      if (NEGATED.test(before) || (!own && RECEIVED.test(before))) continue;
      if (EMOTIONAL.test(around) || ATTACHED_TO_PERSON.test(around)) continue;
      return text.slice(start, start + phrase.length).trim();
    }
  }
  return null;
}

/** The subject only counts on new messages: a reply keeps the subject of mail that had the attachment. */
export function attachmentMention({ subject, html, checkSubject }: { subject: string; html: string; checkSubject: boolean }): string | null {
  if (FILE_LINK.test(html)) return null;
  return find(ownText(html)) ?? (checkSubject ? find(subject) : null);
}
