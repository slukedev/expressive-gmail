/** Gemini for the demo mailbox. No model: a few conversations have hand-written answers, the rest are built from the mail with plain rules. */
import { BackendError } from '../backend';
import type { GeminiRequest, GeminiResult, GeminiSource, ProofreadFix, RefineMode } from '../gemini';
import type { Message, Thread, ThreadSummary } from '../types';
import { GEMINI_FIXTURES } from './fixtures/gemini';

export interface DemoGeminiEnv {
  thread(id: string): Thread;
  /** Newest first. */
  search(q: string): ThreadSummary[];
  me: { name: string; email: string };
  now(): number;
  /** User label names by id, for AI Inbox topics. */
  labelName(id: string): string | undefined;
}

export type DemoGeminiMode = 'ready' | 'plan' | 'smart-features' | 'fail';

const firstName = (name?: string, email?: string) => (name?.split(/\s+/)[0] || email?.split('@')[0] || 'there').replace(/^./, (c) => c.toUpperCase());

/** Without quoted history or a sign-off. */
function ownText(m: Message): string {
  const lines = (m.bodyText ?? m.snippet).split('\n');
  const cut = lines.findIndex((l) => /^On .+wrote:\s*$/.test(l.trim()) || l.startsWith('>') || /^-{2,}\s*(Original|Forwarded)/i.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trim();
}

/** Not "Hi all," or "Thanks,". */
function gist(text: string): string {
  const body = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(hi|hey|hello|dear|thanks|thank you|best|cheers|love|regards|best regards)\b[^.!?]{0,30}[,!]?$/i.test(l) && !/^[A-Z]\.?$/.test(l) && l.split(' ').length > 2)
    .join(' ');
  const sentences = body.match(/[^.!?]+[.!?]+/g) ?? [body];
  // "Love that." says little; the next sentence usually says what.
  const sentence = sentences.find((x) => x.trim().split(/\s+/).length >= 4) ?? sentences[0]!;
  const trimmed = sentence.trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177).replace(/\s+\S*$/, '')}…` : trimmed;
}

function source(t: ThreadSummary): GeminiSource {
  const from = t.participants[t.participants.length - 1];
  return { threadId: t.id, subject: t.subject || '(no subject)', from: from?.name || from?.email, date: t.lastDate };
}

function summarize(t: Thread, me: DemoGeminiEnv['me']): string {
  const fixed = GEMINI_FIXTURES[t.id]?.summary;
  if (fixed) return fixed;
  const msgs = t.messages.filter((m) => !m.isDraft);
  if (!msgs.length) return 'This conversation has no messages yet.';
  const who = (m: Message) => (m.from.email.toLowerCase() === me.email.toLowerCase() ? 'You' : firstName(m.from.name, m.from.email));
  const picked = msgs.length <= 4 ? msgs : [msgs[0]!, ...msgs.slice(-3)];
  const lines = picked.map((m) => `- **${who(m)}**: ${gist(ownText(m))}`);
  const last = msgs[msgs.length - 1]!;
  if (/\?/.test(ownText(last)) && who(last) !== 'You') lines.push(`- ${who(last)} is waiting on an answer.`);
  return lines.join('\n');
}

function replies(t: Thread, me: DemoGeminiEnv['me']): { label: string; text: string }[] {
  const fixed = GEMINI_FIXTURES[t.id]?.replies;
  if (fixed) return fixed;
  const last = [...t.messages].reverse().find((m) => !m.isDraft && m.from.email.toLowerCase() !== me.email.toLowerCase());
  if (!last) return [];
  const name = firstName(last.from.name, last.from.email);
  const text = ownText(last);
  const sign = `\n\n${firstName(me.name, me.email)}`;
  if (/\?/.test(text)) {
    return [
      { label: 'Yes, that works', text: `Hi ${name},\n\nYes, that works for me. Thanks for checking.${sign}` },
      { label: 'Let me check', text: `Hi ${name},\n\nGood question. Let me check and get back to you by tomorrow.${sign}` },
      { label: 'Not this time', text: `Hi ${name},\n\nThanks for asking, but I can't make that work this time. Could we find another option?${sign}` },
    ];
  }
  return [
    { label: 'Thanks', text: `Hi ${name},\n\nThanks for letting me know.${sign}` },
    { label: 'Sounds good', text: `Hi ${name},\n\nSounds good to me.${sign}` },
  ];
}

const STOP = new Set('a an and are about any anything at be can could did do does email emails for from get has have how i in is it its last me my of on or show summarize tell that the this to up was were what when where which who why will with would you your week today yesterday month find list mail inbox'.split(' '));

function keywords(question: string): string[] {
  return [...new Set(question.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];
}

/** The sentence in a conversation that says most about the question's words. */
function bestSentence(t: Thread, words: string[], when = false): string {
  let best = '';
  let score = 0;
  for (const m of t.messages.filter((x) => !x.isDraft)) {
    for (const sentence of ownText(m).split(/(?<=[.!?])\s+|\n+/)) {
      const lower = sentence.toLowerCase();
      // A deadline ("by November 15") answers "when" better than a date in passing.
      const day = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun)\\w*';
      const deadline = new RegExp(`\\b(by|until|before)\\s+${day}`, 'i').test(sentence) ? 3 : new RegExp(`\\bon\\s+${day}`, 'i').test(sentence) ? 1 : 0;
      const n = words.filter((w) => lower.includes(w)).length + (/\d/.test(sentence) ? 0.5 : 0) + (when ? deadline : 0);
      if (n > score && sentence.split(' ').length > 3) {
        score = n;
        best = sentence.trim();
      }
    }
  }
  return best || gist(ownText(t.messages.filter((x) => !x.isDraft).at(-1)!));
}

/** Find the mail it's about, then answer from it with citations. */
function answerAboutMail(question: string, env: DemoGeminiEnv): { text: string; sources: GeminiSource[] } {
  const q = question.toLowerCase();
  if (/\b(catch me up|unread|what did i miss|what's new|whats new)\b/.test(q)) {
    const unread = env.search('is:unread in:inbox').slice(0, 5);
    if (!unread.length) return { text: 'You’re all caught up. Nothing in your inbox is unread.', sources: [] };
    const lines = unread.map((t, i) => {
      const thread = env.thread(t.id);
      const last = thread.messages.filter((m) => !m.isDraft).at(-1)!;
      return `- **${t.subject || '(no subject)'}**: ${firstName(last.from.name, last.from.email)} wrote, “${gist(ownText(last))}” [${i + 1}]`;
    });
    return { text: `You have ${unread.length === 5 ? 'a few' : unread.length} unread conversations worth a look:\n\n${lines.join('\n')}`, sources: unread.map(source) };
  }
  if (/\b(waiting on|need(s)? (a |my )?(reply|answer|response)|haven'?t (replied|answered))\b/.test(q)) {
    const asks = env
      .search('in:inbox -from:me')
      .filter((t) => {
        const last = env.thread(t.id).messages.filter((m) => !m.isDraft).at(-1);
        return last && last.from.email.toLowerCase() !== env.me.email.toLowerCase() && /\?/.test(ownText(last));
      })
      .slice(0, 4);
    if (!asks.length) return { text: 'Nobody in your inbox is waiting on a reply from you.', sources: [] };
    return {
      text: `These look like they need an answer from you:\n\n${asks.map((t, i) => `- **${t.subject}** from ${source(t).from} [${i + 1}]`).join('\n')}`,
      sources: asks.map(source),
    };
  }
  const words = keywords(question);
  const hits = new Map<string, { t: ThreadSummary; score: number; words: number }>();
  for (const w of words) {
    for (const t of env.search(w).slice(0, 12)) {
      const prev = hits.get(t.id);
      // Each shared word counts once, more in the subject.
      hits.set(t.id, { t, score: (prev?.score ?? 0) + (t.subject.toLowerCase().includes(w) ? 3 : 1), words: (prev?.words ?? 0) + 1 });
    }
  }
  const sorted = [...hits.values()].sort((a, b) => b.words - a.words || b.score - a.score || b.t.lastDate - a.t.lastDate);
  const best = sorted[0];
  // Only matches about as relevant as the best; one stray shared word isn't an answer.
  const ranked = sorted.filter((h) => best && h.words >= Math.max(1, best.words - 1) && h.score >= best.score * 0.6 && (h.words > 1 || words.length < 2)).slice(0, 3);
  if (!ranked.length) {
    return { text: `I couldn’t find anything in your mail about that. Try naming a person, a company or a word from the subject.`, sources: [] };
  }
  const when = /^when\b|\bdue\b|\bdeadline\b/i.test(question);
  if (ranked.length === 1) {
    const { t } = ranked[0]!;
    return { text: `From **${t.subject || '(no subject)'}**: ${bestSentence(env.thread(t.id), words, when)} [1]`, sources: [source(t)] };
  }
  const lines = ranked.map(({ t }, i) => `- **${t.subject || '(no subject)'}**: ${bestSentence(env.thread(t.id), words, when)} [${i + 1}]`);
  return { text: `I found ${ranked.length} conversations about that:\n\n${lines.join('\n')}`, sources: ranked.map((r) => source(r.t)) };
}

function actionItems(t: Thread, env: DemoGeminiEnv): string {
  const fixed = GEMINI_FIXTURES[t.id]?.actions;
  if (fixed) return fixed;
  const items: string[] = [];
  for (const m of t.messages.filter((x) => !x.isDraft)) {
    for (const s of ownText(m).split(/(?<=[.!?])\s+|\n+/)) {
      if (/\b(can you|could you|please|let's|we need|i'll|i will|by (monday|tuesday|wednesday|thursday|friday|tomorrow))\b/i.test(s)) {
        const who = m.from.email.toLowerCase() === env.me.email.toLowerCase() ? 'You' : firstName(m.from.name, m.from.email);
        items.push(`- **${who}**: ${s.trim().replace(/^[-•\d.]+\s*/, '')}`);
      }
    }
  }
  return items.length ? `Action items in this conversation:\n\n${items.slice(0, 6).join('\n')}` : 'I didn’t find any action items in this conversation.';
}

function chat(request: Extract<GeminiRequest, { kind: 'chat' }>, env: DemoGeminiEnv): GeminiResult {
  const question = [...request.turns].reverse().find((t) => t.role === 'user')?.text ?? '';
  const q = question.toLowerCase();
  if (request.threadId) {
    const t = env.thread(request.threadId);
    const self: GeminiSource[] = [source(t)];
    if (/\bsummar|tl;?dr|recap|what('s| is) this\b/.test(q)) return { kind: 'answer', text: summarize(t, env.me).replace(/$/, ' [1]'), sources: self };
    if (/\b(action items?|to-?dos?|next steps|tasks)\b/.test(q)) return { kind: 'answer', text: actionItems(t, env), sources: self };
    if (/\b(reply|respond|answer|write back|draft)\b/.test(q)) {
      const r = replies(t, env.me)[0];
      return { kind: 'answer', text: r ? `Here’s a reply you could send:\n\n${r.text}` : 'There’s nothing here that needs a reply.', sources: [] };
    }
    if (!/\b(inbox|other emails|my mail|all my)\b/.test(q)) {
      const words = keywords(question);
      const msgs = t.messages.filter((m) => !m.isDraft);
      const hit = msgs.filter((m) => words.some((w) => ownText(m).toLowerCase().includes(w))).at(-1);
      if (hit) {
        const sentence = ownText(hit).split(/(?<=[.!?])\s+|\n+/).find((s) => words.some((w) => s.toLowerCase().includes(w))) ?? gist(ownText(hit));
        const who = hit.from.email.toLowerCase() === env.me.email.toLowerCase() ? 'You' : hit.from.name || hit.from.email;
        return { kind: 'answer', text: `${who} wrote: “${sentence.trim()}” [1]`, sources: self };
      }
      return { kind: 'answer', text: `This conversation doesn’t say. ${summarize(t, env.me).split('\n')[0]?.replace(/^- /, 'What it does cover: ')} [1]`, sources: self };
    }
  }
  return { kind: 'answer', ...answerAboutMail(question, env) };
}

function signOff(me: DemoGeminiEnv['me']) {
  return `\n\nBest,\n${firstName(me.name, me.email)}`;
}

/** From the prompt's own words. */
function write(request: Extract<GeminiRequest, { kind: 'write' }>, env: DemoGeminiEnv): GeminiResult {
  const prompt = request.prompt.trim().replace(/[.!]+$/, '');
  let to = 'there';
  if (request.threadId) {
    const t = env.thread(request.threadId);
    const other = [...t.messages].reverse().find((m) => !m.isDraft && m.from.email.toLowerCase() !== env.me.email.toLowerCase());
    if (other) to = firstName(other.from.name, other.from.email);
    const fixed = GEMINI_FIXTURES[t.id]?.write;
    if (fixed && /\b(yes|accept|agree|confirm|works)\b/i.test(prompt)) return { kind: 'draft', text: fixed };
  } else if (request.to?.[0]) {
    to = firstName(undefined, request.to[0]);
  }
  // "ask Dana to move the 1:1 to Friday" -> the request in the second person.
  const ask = prompt
    .replace(/^(please\s+)?(write|draft|compose|send)\s+(an?\s+)?(email|message|note|reply)\s+(to\s+\w+\s+)?/i, '')
    .replace(/^(ask|tell|remind|let)\s+(\w+)\s+(to\s+|that\s+|know\s+(that\s+)?)?/i, (_m, verb: string, name: string) => {
      if (to === 'there') to = name.replace(/^./, (c) => c.toUpperCase());
      return verb.toLowerCase() === 'ask' ? 'could you ' : '';
    })
    .replace(/^(saying|that|about)\s+/i, '');
  const sentence = ask ? ask.replace(/^./, (c) => c.toUpperCase()) : 'I wanted to follow up';
  const body = /^could you/i.test(sentence) ? `${sentence}? It would really help me plan the rest of the week.` : `${sentence}. Let me know if you have any questions.`;
  const subject = !request.threadId && !request.subject ? sentence.replace(/^could you /i, '').replace(/^./, (c) => c.toUpperCase()).slice(0, 60) : undefined;
  return { kind: 'draft', text: `Hi ${to},\n\n${body}${signOff(env.me)}`, ...(subject ? { subject } : {}) };
}

const FORMAL: [RegExp, string][] = [
  [/\b(hey|hi)\b/gi, 'Hello'],
  [/\bthanks\b/gi, 'Thank you'],
  [/\bcan't\b/gi, 'cannot'],
  [/\bwon't\b/gi, 'will not'],
  [/\bdon't\b/gi, 'do not'],
  [/\bI'm\b/g, 'I am'],
  [/\bit's\b/gi, 'it is'],
  [/\bI'll\b/g, 'I will'],
  [/\bwanna\b/gi, 'would like to'],
  [/\bgonna\b/gi, 'going to'],
  [/\bASAP\b/g, 'at your earliest convenience'],
  [/\bcheers\b/gi, 'Kind regards'],
];

const REPHRASE: [RegExp, string][] = [
  [/\bI wanted to\b/g, 'I’d like to'],
  [/\blet me know\b/gi, 'tell me'],
  [/\bquick\b/gi, 'short'],
  [/\bget back to you\b/gi, 'follow up'],
  [/\bthat works\b/gi, 'that suits me'],
  [/\bsounds good\b/gi, 'works for me'],
  [/\bjust\b\s*/gi, ''],
];

function refine(text: string, mode: RefineMode): string {
  const paras = text.split(/\n{2,}/);
  switch (mode) {
    case 'polish':
      return proofreadApply(text);
    case 'formalize':
      return FORMAL.reduce((s, [re, to]) => s.replace(re, to), proofreadApply(text));
    case 'shorten':
      return paras
        .map((p) => (p.split(/\s+/).length > 12 ? (p.match(/[^.!?]+[.!?]+/)?.[0] ?? p).trim() : p))
        .join('\n\n');
    case 'elaborate': {
      const i = paras.findIndex((p, n) => n > 0 && p.split(/\s+/).length > 4);
      const at = i < 0 ? Math.min(1, paras.length) : i + 1;
      const extra = 'To give a bit more context, I want to make sure we’re aligned before anything moves forward, and I’m happy to talk it through if that’s easier.';
      return [...paras.slice(0, at), extra, ...paras.slice(at)].join('\n\n');
    }
    case 'rephrase':
      return REPHRASE.reduce((s, [re, to]) => s.replace(re, to), text);
  }
}

const MISSPELLED: Record<string, string> = {
  teh: 'the',
  recieve: 'receive',
  recieved: 'received',
  definately: 'definitely',
  alot: 'a lot',
  seperate: 'separate',
  occured: 'occurred',
  untill: 'until',
  wich: 'which',
  thier: 'their',
  tommorow: 'tomorrow',
  tomorow: 'tomorrow',
  accomodate: 'accommodate',
  calender: 'calendar',
  goverment: 'government',
  acheive: 'achieve',
  begining: 'beginning',
  beleive: 'believe',
  freind: 'friend',
  wierd: 'weird',
  shedule: 'schedule',
  adress: 'address',
};

export function proofread(text: string): ProofreadFix[] {
  const fixes: ProofreadFix[] = [];
  const add = (start: number, end: number, replacement: string, kind: string) => {
    if (!fixes.some((f) => start < f.end && end > f.start)) fixes.push({ start, end, replacement, kind });
  };
  for (const m of text.matchAll(/ +([,.!?])/g)) add(m.index!, m.index! + m[0].length, m[1]!, 'Punctuation');
  const first = text.match(/^\s*([a-z])/);
  if (first) add(first[0].length - 1, first[0].length, first[1]!.toUpperCase(), 'Capitalization');
  for (const m of text.matchAll(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|april|june|july|august|september|october|november|december)\b/g)) {
    add(m.index!, m.index! + m[0].length, m[0][0]!.toUpperCase() + m[0].slice(1), 'Capitalization');
  }
  for (const m of text.matchAll(/\b[\p{L}']+\b/gu)) {
    const word = m[0];
    const fix = MISSPELLED[word.toLowerCase()];
    if (fix) add(m.index!, m.index! + word.length, word[0] === word[0]!.toUpperCase() ? fix[0]!.toUpperCase() + fix.slice(1) : fix, 'Spelling');
  }
  for (const m of text.matchAll(/(^|[\s(])i(?=[\s',.!?])/g)) add(m.index! + m[1]!.length, m.index! + m[1]!.length + 1, 'I', 'Capitalization');
  for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) if (!/^(that|had|ha|bye)$/i.test(m[1]!)) add(m.index!, m.index! + m[0].length, m[1]!, 'Repeated word');
  for (const m of text.matchAll(/(?<=[.!?]\s+)([a-z])/g)) add(m.index!, m.index! + 1, m[1]!.toUpperCase(), 'Capitalization');
  for (const m of text.matchAll(/ {2,}/g)) add(m.index!, m.index! + m[0].length, ' ', 'Spacing');
  return fixes.sort((a, b) => a.start - b.start);
}

export function applyFixes(text: string, fixes: ProofreadFix[]): string {
  let out = '';
  let at = 0;
  for (const f of [...fixes].sort((a, b) => a.start - b.start)) {
    if (f.start < at) continue;
    out += text.slice(at, f.start) + f.replacement;
    at = f.end;
  }
  return out + text.slice(at);
}

const proofreadApply = (text: string) => applyFixes(text, proofread(text));

const DAY = 86_400_000;

/** Questions waiting on you and dated asks, then recent mail grouped by label. */
function briefing(env: DemoGeminiEnv): GeminiResult {
  const recent = env.search('in:inbox').filter((t) => env.now() - t.lastDate < 14 * DAY);
  const todos: { text: string; threadId: string; due?: number }[] = [];
  for (const t of recent) {
    const fixed = GEMINI_FIXTURES[t.id]?.todo;
    if (fixed) {
      todos.push({ text: fixed.text, threadId: t.id, ...(fixed.dueInDays !== undefined ? { due: env.now() + fixed.dueInDays * DAY } : {}) });
      continue;
    }
    const thread = env.thread(t.id);
    const last = thread.messages.filter((m) => !m.isDraft).at(-1);
    if (!last || last.from.email.toLowerCase() === env.me.email.toLowerCase() || t.labelIds.some((l) => l.startsWith('CATEGORY_') && l !== 'CATEGORY_PERSONAL')) continue;
    const ask = ownText(last).split(/(?<=[.!?])\s+|\n+/).find((s) => /\?$/.test(s.trim()) && /\b(you|your)\b/i.test(s));
    if (ask) todos.push({ text: `Reply to ${firstName(last.from.name, last.from.email)}: ${ask.trim()}`, threadId: t.id });
  }
  // Labels with a handful of conversations this week, not the catch-alls.
  const week = recent.filter((t) => env.now() - t.lastDate < 7 * DAY);
  const byLabel = new Map<string, ThreadSummary[]>();
  for (const t of week) {
    for (const l of t.labelIds) {
      const name = env.labelName(l);
      if (name) byLabel.set(name, [...(byLabel.get(name) ?? []), t]);
    }
  }
  const topics = [...byLabel.entries()]
    .filter(([, ts]) => ts.length >= 2 && ts.length <= 8)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .map(([name, ts]) => {
      const latest = ts[0]!;
      const last = env.thread(latest.id).messages.filter((m) => !m.isDraft).at(-1)!;
      const who = last.from.email.toLowerCase() === env.me.email.toLowerCase() ? 'you' : firstName(last.from.name, last.from.email);
      return {
        title: name.split('/').pop()!,
        summary: `${ts.length} conversations this week. Most recent: **${latest.subject || '(no subject)'}**, where ${who} wrote “${gist(ownText(last))}”`,
        threadIds: ts.map((t) => t.id),
        sources: ts.map(source),
      };
    });
  return { kind: 'briefing', todos: todos.slice(0, 6), topics };
}

/** Three working-hours slots over the next few weekdays. */
function schedule(request: Extract<GeminiRequest, { kind: 'schedule' }>, env: DemoGeminiEnv): GeminiResult {
  const minutes = request.durationMinutes ?? 30;
  const slots: Date[] = [];
  const day = new Date(env.now());
  const times: [number, number][] = [
    [10, 0],
    [14, 0],
    [11, 30],
  ];
  while (slots.length < 3) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const [h, m] = times[slots.length]!;
    slots.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m));
  }
  const when = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const lines = slots.map((d) => `- ${when.format(d)}`).join('\n');
  return { kind: 'draft', text: `Would any of these times work for a ${minutes}-minute meeting?\n\n${lines}\n\nIf none of them suit you, send me a couple of times that do.` };
}

/** Before it is streamed out word by word. */
export function demoGemini(request: GeminiRequest, env: DemoGeminiEnv): GeminiResult {
  switch (request.kind) {
    case 'chat':
      return chat(request, env);
    case 'summarize': {
      const t = env.thread(request.threadId);
      return { kind: 'answer', text: summarize(t, env.me), sources: [] };
    }
    case 'replies':
      return { kind: 'replies', replies: replies(env.thread(request.threadId), env.me) };
    case 'write':
      if (!request.prompt.trim()) throw new BackendError('Tell Gemini what to write first.', 'unknown');
      return write(request, env);
    case 'refine':
      return { kind: 'draft', text: refine(request.text, request.mode) };
    case 'proofread':
      return { kind: 'proofread', fixes: proofread(request.text) };
    case 'search':
      return { kind: 'answer', ...answerAboutMail(request.query, env) };
    case 'briefing':
      return briefing(env);
    case 'schedule':
      return schedule(request, env);
  }
}

/** The text a result streams as, if it streams at all. */
export function streamedText(result: GeminiResult): string | undefined {
  return result.kind === 'answer' || result.kind === 'draft' ? result.text : undefined;
}
