// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BackendError, type BackendEvent, type MailBackend } from '../../src/app/data/backend';
import { readsAsQuestion, type GeminiRequest } from '../../src/app/data/gemini';
import { createDemoBackend } from '../../src/app/data/demo';
import { applyFixes, proofread } from '../../src/app/data/demo/gemini';
import { createMergedBackend } from '../../src/app/data/accounts/merged';
import { accountKey, qualify } from '../../src/app/data/accounts/ids';
import { parseBlocks, plainText, textToHtml } from '../../src/app/features/gemini/GeminiText';
import { NOW } from '../demo/helpers';

describe('readsAsQuestion', () => {
  it('answers questions and leaves searches alone', () => {
    expect(readsAsQuestion('when is my lease renewal due?')).toBe(true);
    expect(readsAsQuestion('what did Priya decide about onboarding')).toBe(true);
    expect(readsAsQuestion('catch me up on work')).toBe(true);
    // Operators always mean a search, even phrased as a question.
    expect(readsAsQuestion('from:priya what is this?')).toBe(false);
    expect(readsAsQuestion('lease?')).toBe(false);
    expect(readsAsQuestion('lease renewal pdf')).toBe(false);
  });
});

describe('Gemini text', () => {
  it('splits paragraphs and both kinds of list, and keeps lines inside a paragraph', () => {
    const blocks = parseBlocks('Lead line\nsecond line\n\n- one\n- two\n\n1. first\n2) second\n\nTail');
    expect(blocks).toEqual([
      { kind: 'p', text: 'Lead line\nsecond line' },
      { kind: 'ul', items: ['one', 'two'] },
      { kind: 'ol', items: ['first', 'second'] },
      { kind: 'p', text: 'Tail' },
    ]);
  });

  it('drops citations and bold marks for the clipboard, and escapes HTML for the editor', () => {
    expect(plainText('The **lease** ends Dec 31 [1].')).toBe('The lease ends Dec 31.');
    expect(textToHtml('Hi <Dana>,\n\nLine one\nline two [2]')).toBe('<p>Hi &lt;Dana&gt;,</p><p>Line one<br>line two</p>');
  });
});

describe('demo Proofread', () => {
  it('fixes spelling, capitals and spacing without two fixes touching the same text', () => {
    const text = 'hey dana, i definately think teh plan works  . see you friday';
    const fixes = proofread(text);
    for (let i = 1; i < fixes.length; i++) expect(fixes[i]!.start).toBeGreaterThanOrEqual(fixes[i - 1]!.end);
    expect(applyFixes(text, fixes)).toBe('Hey dana, I definitely think the plan works. See you Friday');
  });

  it('finds nothing in clean text', () => {
    expect(proofread('Thanks, Priya. I will send it on Friday.')).toEqual([]);
  });
});

describe('demo Gemini', () => {
  const backend = (gemini?: 'plan' | 'fail', geminiDelayMs = 0) => createDemoBackend({ now: () => NOW, liveMail: false, gemini, geminiDelayMs });

  it('streams growing text before resolving with the whole answer', async () => {
    const b = backend(undefined, 1);
    const seen: string[] = [];
    b.subscribe!((e: BackendEvent) => e.type === 'gemini' && e.requestId === 'r1' && seen.push(e.text));
    const result = await b.gemini!({ kind: 'summarize', threadId: 't-onboarding-v4' }, 'r1');
    expect(result.kind).toBe('answer');
    const text = result.kind === 'answer' ? result.text : '';
    expect(seen.length).toBeGreaterThan(3);
    // Every update is the answer so far, never a fragment from the middle.
    seen.reduce((prev, cur) => (expect(cur.startsWith(prev)).toBe(true), cur), '');
    expect(text.startsWith(seen.at(-1)!)).toBe(true);
  });

  it('stops a running request', async () => {
    const b = backend(undefined, 50);
    const running = b.gemini!({ kind: 'search', query: 'what is the lease renewal about?' }, 'r2');
    await b.cancelGemini!('r2');
    await expect(running).rejects.toThrow('Stopped');
  });

  it('cites the conversation that answers a question about the mailbox', async () => {
    const result = await backend().gemini!({ kind: 'search', query: 'when is my lease renewal due?' }, 'r3');
    if (result.kind !== 'answer') throw new Error(result.kind);
    expect(result.sources[0]?.threadId).toBe('t-lease-renewal');
    expect(result.text).toMatch(/November 15\.? \[1\]/);
  });

  it('says why it is unavailable instead of answering', async () => {
    const b = backend('plan');
    expect(await b.geminiStatus!()).toEqual({ ready: false, block: 'plan' });
    await expect(b.gemini!({ kind: 'briefing' }, 'r4')).rejects.toBeInstanceOf(BackendError);
  });
});

describe('Gemini across accounts', () => {
  const MAIN = 'alex.rivera@example.com';
  const STUDIO = 'alex@riverastudio.example.net';
  const make = (persona: 'main' | 'studio', gemini?: 'plan') => createDemoBackend({ now: () => NOW, liveMail: false, persona, gemini, geminiDelayMs: 0 });

  function merged(main: MailBackend, studio: MailBackend) {
    return createMergedBackend([
      { key: accountKey(MAIN), email: MAIN, backend: main },
      { key: accountKey(STUDIO), email: STUDIO, backend: studio },
    ]);
  }

  it('asks the account a conversation belongs to, and qualifies the ids it answers with', async () => {
    const studioAsked: GeminiRequest[] = [];
    const studio = make('studio');
    const spy: MailBackend = Object.assign(Object.create(studio), {
      gemini: (r: GeminiRequest, id: string) => (studioAsked.push(r), studio.gemini!(r, id)),
    });
    const m = merged(make('main'), spy);
    const id = qualify(accountKey(STUDIO), 'st-harbor-kickoff');
    const result = await m.gemini!({ kind: 'chat', turns: [{ role: 'user', text: 'Summarize this email' }], threadId: id }, 'r5');
    expect(studioAsked).toEqual([{ kind: 'chat', turns: [{ role: 'user', text: 'Summarize this email' }], threadId: 'st-harbor-kickoff' }]);
    if (result.kind !== 'answer') throw new Error(result.kind);
    expect(result.sources.map((s) => s.threadId)).toEqual([id]);
  });

  it('sends mailbox questions to the first account whose Gemini can run', async () => {
    const m = merged(make('main', 'plan'), make('studio'));
    expect((await m.geminiStatus!()).ready).toBe(true);
    const result = await m.gemini!({ kind: 'briefing' }, 'r6');
    if (result.kind !== 'briefing') throw new Error(result.kind);
    for (const t of result.todos) expect(t.threadId.startsWith(`${accountKey(STUDIO)}`)).toBe(true);
  });
});
