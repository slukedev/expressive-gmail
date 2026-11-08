import { BackendError } from '../../src/app/data/backend';
import type { GeminiResult } from '../../src/app/data/gemini';
import { SessionBackend } from '../../src/session/backend';
import { GmailGemini, chatQuestion, diffFixes, draftFrom, threadRefOf, toMarkdown } from '../../src/session/gemini-page';
import { GmailPage, GmailPageError } from '../../src/session/gmail-page';
import { threadUrlId, toLegacyHexId } from '../../src/session/ids';
import { FakeTokens } from './helpers';

/** What a promise rejected with, of any kind. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
}

const CAFE = 'thread-f:1846473264892611537';
const TRIP = 'thread-f:1846500000000000007';
const MINE = 'thread-a:r-5170422411232245581';

/**
 * Time that only moves when the driver sleeps, with Gmail's reactions
 * scheduled on it, so streaming and timeouts run the same way every time.
 */
function fakeClock() {
  let t = 0;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    later(ms: number, fn: () => void) {
      timers.push({ at: t + ms, fn });
    },
    async sleep(ms: number) {
      const end = t + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        t = next.at;
        next.fn();
      }
      t = end;
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

interface FakeOptions {
  lang?: string;
  /** The search box's placeholder; "Ask Gmail" when AI search is on. */
  placeholder?: string;
  /** An AI Overview from an earlier search still in the page; Gmail writes the new answer into it after `searchDelay`. */
  staleOverview?: boolean;
  searchDelay?: number;
  /** How Gmail takes a search: its button (the default), only a form submit, or only its search address. */
  searchBy?: 'button' | 'submit' | 'address';
  /** The overview has none of the class names the driver knows, only its caption and disclaimer. */
  plainOverview?: boolean;
  /** Pieces of the answer, written one every 400 ms after a spinner. */
  answer?: (string | ((text: Element) => void))[];
  /** Gmail's Help me write button in its compose windows. */
  helpMeWrite?: boolean;
  /** Create does nothing. */
  deadCreate?: boolean;
  /** Pieces of the draft Gemini writes into the body. */
  draft?: string[];
  /** Pressing Summarize this email shows nothing. */
  deadSummary?: boolean;
  /** Extra hooks in the page at load. */
  extra?: string;
  /**
   * The conversation has the user's own saved draft reply ("msg-a:r-user"): shown open when the
   * conversation opens, or brought up by Reply in place of a new one.
   */
  userDraft?: 'open' | 'on-reply';
  /**
   * Gmail's Gemini side panel, as a Google AI plan shows it: Ask Gemini in the header opens it,
   * and an answer streams in under the question it repeats. Conversations then have no Summarize chip.
   */
  panel?: string[];
  /** The panel's Submit stays disabled until its editor hears this event, as Gmail's does for text it didn't see typed. */
  panelNeeds?: 'beforeinput';
  /**
   * The panel as Safari showed it in a real account: each answer carries a screen reader label,
   * "Collecting info..." stays up for seconds, and there's no Stop button to say it's still working.
   */
  panelQuiet?: boolean;
  /** Asked to write, the panel opens a compose window with this draft and only says "Done." */
  panelOpensDraft?: { subject: string; body: string };
}

/**
 * A stand-in for Gmail's page with the Gemini hooks the driver reads: the
 * search box and its AI Overview (with a spinner while it writes), a
 * conversation with its Summarize chip and card, and a compose window with
 * Help me write, its prompt popup and Discard draft. Like Gmail it acts a beat
 * after a press and renders only on a real navigation.
 */
function fakeGmail(options: FakeOptions = {}) {
  const clock = fakeClock();
  const doc = document.implementation.createHTMLDocument('Gmail');
  doc.documentElement.lang = options.lang ?? 'en';
  const location = {
    href: 'https://mail.google.com/mail/u/0/#inbox',
    get hash() {
      return new URL(this.href).hash;
    },
    replace(url: string) {
      const changed = new URL(url).hash !== this.hash;
      this.href = url;
      visited.push(this.hash);
      if (changed) clock.later(50, render);
    },
  };
  const history = {
    state: null,
    replaceState(_s: unknown, _t: string, url: string) {
      location.href = new URL(url, location.href).toString();
    },
  };
  const win = { document: doc, location, history } as unknown as Window;
  /** Every press of Send, and every compose window discarded. Send should never be pressed. */
  const sent: string[] = [];
  const discarded: string[] = [];
  const searched: string[] = [];
  /** Every address Gmail was sent to. */
  const visited: string[] = [];

  const searchBy = options.searchBy ?? 'button';
  const button = searchBy === 'button' ? '<button aria-label="Search mail">s</button>' : '';
  doc.body.innerHTML = `<form role="search"><input name="q" placeholder="${options.placeholder ?? 'Ask Gmail'}">${button}</form><div role="main"></div>${options.extra ?? ''}`;
  if (options.staleOverview) {
    doc.querySelector('[role="main"]')!.insertAdjacentHTML('beforeend', '<div class="JLWipf"><p>Your flight leaves at 9.</p></div>');
  }
  const box = doc.querySelector<HTMLInputElement>('input[name="q"]')!;
  doc.querySelector('[aria-label="Search mail"]')?.addEventListener('click', () => search(box.value));
  doc.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    if (searchBy === 'submit') search(box.value);
  });
  function search(query: string) {
    searched.push(query);
    clock.later(options.searchDelay ?? 200, () => {
      const main = doc.querySelector('[role="main"]')!;
      const reused = main.querySelector<HTMLElement>('.JLWipf');
      main.replaceChildren();
      const overview = reused ?? doc.createElement('div');
      if (!options.plainOverview) overview.className = 'JLWipf';
      overview.innerHTML = `${options.plainOverview ? '<div><span>AI Overview</span></div>' : '<h2>AI Overview</h2>'}<div class="text"></div><div role="progressbar"></div><button aria-label="Good response">up</button><span>Gemini can make mistakes, so double-check it</span>`;
      main.append(overview);
      const pieces = options.answer ?? [];
      pieces.forEach((piece, i) =>
        clock.later(400 * (i + 1), () => {
          const into = overview.querySelector('.text')!;
          if (typeof piece === 'string') into.insertAdjacentHTML('beforeend', piece);
          else piece(into);
        }),
      );
      clock.later(400 * pieces.length + 100, () => overview.querySelector('[role="progressbar"]')?.remove());
    });
  }

  function render() {
    const hash = location.hash;
    const main = doc.querySelector('[role="main"]')!;
    const query = /^#search\/(.+)$/.exec(hash);
    if (query && searchBy === 'address') search(decodeURIComponent(query[1]!));
    const thread = /^#all\/(.+)$/.exec(hash);
    if (thread) {
      main.innerHTML = `<h2 class="hP" data-thread-perm-id="${CAFE}" data-legacy-thread-id="${toLegacyHexId(CAFE)}">Café opening</h2>${options.panel ? '' : '<div role="button">Summarize this email</div>'}<span role="button" class="ams bkH">Reply</span>`;
      if (options.userDraft === 'open') clock.later(50, () => openCompose('#msg-a:r-user', 'See you there'));
      main.querySelector('.ams')!.addEventListener('click', () => clock.later(100, () => (options.userDraft === 'on-reply' ? openCompose('#msg-a:r-user', 'See you there') : openCompose())));
      main.querySelector('[role="button"]')!.addEventListener('click', () => {
        if (options.deadSummary) return;
        clock.later(300, () => {
          const card = doc.createElement('div');
          card.className = 'eJPjde';
          card.innerHTML = '<h3>Summary</h3><ul><li>Opening moved to <b>May 3</b>.</li><li>Ada asks for a headcount.</li></ul><button>Thumbs down</button>';
          main.prepend(card);
        });
      });
    }
    if (hash === '#inbox?compose=new') openCompose();
  }

  function openCompose(draftId?: string, text = '') {
    const n = draftId ? 'user' : String(doc.querySelectorAll('[data-compose]').length + 1);
    const dialog = doc.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.dataset.compose = n;
    dialog.innerHTML = `<div class="M9"><input type="hidden" name="draft" value="${draftId ?? `#msg-a:r${n}`}">
      <input name="subjectbox" value="">
      <div g_editable="true" contenteditable="true" role="textbox" aria-label="Message Body">${text}</div>
      <div role="button" class="T-I aoO" data-tooltip="Send">Send</div>
      ${options.helpMeWrite === false ? '' : '<div role="button" class="wG J-Z-I bDl" command="sdt" data-tooltip="Help me write"></div>'}
      <div role="button" class="og" data-tooltip="Discard draft ‪(⌘⇧D)‬"></div></div>`;
    const body = dialog.querySelector<HTMLElement>('[g_editable]')!;
    dialog.querySelector('.aoO')!.addEventListener('click', () => sent.push(n));
    dialog.querySelector('.og')!.addEventListener('click', () => clock.later(100, () => (discarded.push(n), dialog.remove())));
    dialog.querySelector('[command="sdt"]')?.addEventListener('click', () =>
      clock.later(150, () => {
        const popup = doc.createElement('div');
        popup.className = 'jKzJCd';
        popup.innerHTML = '<textarea aria-label="Prompt"></textarea><button>Create</button>';
        popup.querySelector('button')!.addEventListener('click', () => {
          if (options.deadCreate) return;
          const prompt = popup.querySelector('textarea')!.value;
          const pieces = options.draft ?? [`Draft for: ${prompt}`];
          pieces.forEach((piece, i) => clock.later(500 * (i + 1), () => body.insertAdjacentHTML('beforeend', `<div>${piece}</div>`)));
          clock.later(500 * pieces.length, () => (dialog.querySelector<HTMLInputElement>('[name="subjectbox"]')!.value = 'Saturday plans'));
        });
        dialog.append(popup);
      }),
    );
    doc.body.append(dialog);
  }

  /** What the side panel was asked, and where Gmail was when it was. */
  const asked: { question: string; at: string }[] = [];
  if (options.panel) {
    doc.body.insertAdjacentHTML(
      'afterbegin',
      `<div class="Zmxtcf e5IPTd"><span><button aria-label="Ask Gemini">g</button></span></div>
      <div class="ccYpFf" hidden><header class="qzAKKe"><div class="qC38hb"><h2 class="DYX8s">Gemini</h2></div></header>
        <div class="turns"><p>Hi Ada, how can I help?</p></div>
        <div class="zVSmpd"><div role="combobox" aria-label="Ask Gemini" class="Pv5YRd"><div contenteditable="true"></div></div><button aria-label="Send">send</button></div></div>`,
    );
    const panel = doc.querySelector<HTMLElement>('.ccYpFf')!;
    if (options.panelNeeds) {
      const submit = panel.querySelector('[aria-label="Send"]')!;
      submit.setAttribute('aria-disabled', 'true');
      panel.querySelector('[contenteditable]')!.addEventListener(options.panelNeeds, () => clock.later(100, () => submit.removeAttribute('aria-disabled')));
    }
    doc.querySelector('.e5IPTd button')!.addEventListener('click', () => clock.later(200, () => panel.removeAttribute('hidden')));
    panel.querySelector('[aria-label="Send"]')!.addEventListener('click', (e) => {
      if ((e.currentTarget as Element).getAttribute('aria-disabled') === 'true') return;
      const editable = panel.querySelector('[contenteditable]')!;
      const question = editable.textContent ?? '';
      asked.push({ question, at: location.hash });
      editable.textContent = '';
      const turns = panel.querySelector('.turns')!;
      turns.insertAdjacentHTML('beforeend', `<div class="you">${question}</div>`);
      if (options.panelOpensDraft) {
        const { subject, body } = options.panelOpensDraft;
        clock.later(300, () => {
          openCompose(undefined, body);
          doc.querySelector<HTMLInputElement>('[data-compose]:last-of-type [name="subjectbox"]')!.value = subject;
          turns.insertAdjacentHTML('beforeend', '<div class="model"><p>Done.</p></div>');
        });
        return;
      }
      clock.later(300, () => {
        const label = options.panelQuiet ? '<span class="sr">Gemini response</span>' : '';
        // Safari's panel put its label and status in a list item that stays, empty, above the answer.
        const status = `${label}<span class="status">${options.panelQuiet ? 'Collecting info...' : 'Thinking…'}</span>`;
        turns.insertAdjacentHTML('beforeend', `<div class="model">${options.panelQuiet ? `<ul><li>${status}</li></ul>` : status}</div>`);
        if (!options.panelQuiet) turns.insertAdjacentHTML('beforeend', '<button aria-label="Stop response">stop</button>');
        const model = turns.querySelector('.model:last-of-type')!;
        const first = options.panelQuiet ? 3_000 : 600;
        options.panel!.forEach((piece, i) =>
          clock.later(first + 600 * i, () => {
            if (i === 0) model.querySelector('.status')!.remove();
            model.insertAdjacentHTML('beforeend', piece);
          }),
        );
        clock.later(600 * options.panel!.length + 200, () => turns.querySelector('[aria-label="Stop response"]')?.remove());
      });
    });
  }

  const shown = (el: Element) => el.isConnected && !el.closest('[hidden]');
  const page = new GmailPage({ window: win, sleep: clock.sleep, now: clock.now, shown, stepTimeoutMs: 2_000 });
  const diagnostics: string[] = [];
  const gemini = new GmailGemini({ page, window: win, sleep: clock.sleep, now: clock.now, shown, stepTimeoutMs: 2_000, answerTimeoutMs: 5_000, diagnostic: (line) => diagnostics.push(line) });
  const composes = () => [...doc.querySelectorAll('[data-compose]')];
  return { gemini, page, doc, location, clock, sent, discarded, searched, composes, visited, diagnostics, asked };
}

const run = (g: ReturnType<typeof fakeGmail>, request: Parameters<GmailGemini['run']>[0], id = 'r1', drafts?: string[]) => {
  const texts: string[] = [];
  const result = g.gemini.run(request, id, { onText: (t) => texts.push(t), drafts });
  return { result, texts };
};

describe('GmailGemini: Ask Gmail', () => {
  it('streams the overview as it grows, waits out the spinner, and maps citations to sync thread ids', async () => {
    const g = fakeGmail({
      answer: [
        '<p>The café opens on <b>May 3</b> <a href="#inbox/' + toLegacyHexId(CAFE) + '" title="Café opening">1</a>.</p>',
        `<ul><li>Ada wants a headcount <span data-thread-id="#${TRIP}">2</span></li></ul>`,
        // The list grows in place, as Gemini writes it.
        (text) => text.querySelector('ul')!.insertAdjacentHTML('beforeend', `<li>Book the van <a href="#inbox/${toLegacyHexId(CAFE)}">1</a></li>`),
      ],
    });
    const { result, texts } = run(g, { kind: 'search', query: 'when does the café open?' });
    const answer = (await result) as Extract<GeminiResult, { kind: 'answer' }>;

    expect(answer.text).toBe('The café opens on **May 3** [1].\n\n- Ada wants a headcount [2]\n- Book the van [1]');
    expect(answer.sources).toEqual([
      { threadId: CAFE, subject: 'Café opening' },
      { threadId: TRIP, subject: '' },
    ]);
    // Each event carries the whole answer so far, growing, ending on the final text.
    expect(texts.length).toBeGreaterThanOrEqual(3);
    texts.slice(1).forEach((t, i) => expect(t.startsWith(texts[i]!.slice(0, 20))).toBe(true));
    expect(texts.at(-1)).toBe(answer.text);
    expect(g.searched).toEqual(['when does the café open?']);
    // The address Gmail's search went to is put back.
    expect(g.location.hash).toBe('#inbox');
  });

  it("doesn't take an earlier search's overview, still in the page, for the answer", async () => {
    // Gmail takes longer than an answer's settle time to start, then rewrites the same element.
    const g = fakeGmail({ staleOverview: true, searchDelay: 2_500, answer: ['<p>Ada asked for 12 chairs.</p>'] });
    const answer = await run(g, { kind: 'search', query: 'how many chairs did Ada ask for?' }).result;
    expect(answer).toMatchObject({ kind: 'answer', text: 'Ada asked for 12 chairs.' });
  });

  it.each([
    ['a form submit', 'submit'],
    ['its search address, when the box takes nothing', 'address'],
  ] as const)('asks through %s when Gmail shows no search button, and finds an overview by its caption alone', async (_, searchBy) => {
    const g = fakeGmail({ searchBy, plainOverview: true, answer: ['<p>The lease is due back on <b>November 15</b>.</p>'] });
    const answer = await run(g, { kind: 'search', query: 'when is the lease due?' }).result;
    expect(answer).toMatchObject({ kind: 'answer', text: 'The lease is due back on **November 15**.' });
    expect(g.searched).toEqual(['when is the lease due?']);
  });

  it('says Ask Gmail is missing when the search box is the plain one, without searching', async () => {
    const g = fakeGmail({ placeholder: 'Search mail', answer: ['<p>x</p>'] });
    const err = await rejection(run(g, { kind: 'chat', turns: [{ role: 'user', text: 'what is new?' }] }).result);
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ code: 'unsupported' });
    expect(g.searched).toEqual([]);
    // Using it showed chat isn't there, whatever the hooks suggested.
    const status = await g.gemini.status();
    expect(status.ready && status.features).not.toContain('chat');
  });
});

describe('GmailGemini: conversations', () => {
  it('opens the conversation, asks for its summary and reads the card without its caption or buttons', async () => {
    const g = fakeGmail();
    const answer = await run(g, { kind: 'summarize', threadId: CAFE }).result;
    expect(answer).toEqual({ kind: 'answer', text: '- Opening moved to **May 3**.\n- Ada asks for a headcount.', sources: [] });
  });

  it('fails naming the step when the summary never appears', async () => {
    const g = fakeGmail({ deadSummary: true });
    const err = await rejection(run(g, { kind: 'summarize', threadId: CAFE }).result);
    expect(err).toBeInstanceOf(GmailPageError);
    expect((err as GmailPageError).step).toBe('show the summary');
    // The log says what Gmail showed instead: its AI controls and which hooks matched, never the mail.
    const log = g.diagnostics.find((l) => l.startsWith('gemini summarize failed'))!;
    expect(log).toContain('summaryCard 0/0');
    expect(log).toMatch(/div\[role=button\] "Summarize this email" in div\[role=main\]/);
    expect(log).not.toContain('Café opening');
  });

  it('without a Summarize chip, asks the side panel in the open conversation and reads only its answer', async () => {
    const g = fakeGmail({ panel: ['<p>Opening moved to <b>May 3</b>.</p>', '<ul><li>Ada asks for a headcount.</li></ul>'] });
    const { result, texts } = run(g, { kind: 'summarize', threadId: CAFE });
    expect(await result).toEqual({ kind: 'answer', text: 'Opening moved to **May 3**.\n\n- Ada asks for a headcount.', sources: [] });
    expect(g.asked).toEqual([{ question: 'Summarize this email', at: `#all/${toLegacyHexId(CAFE)}` }]);
    // Streamed as it grew, never the "Thinking…" placeholder or the repeated question.
    expect(texts[0]).toBe('Opening moved to **May 3**.');
    expect(texts.some((t) => /Thinking|Summarize this email/.test(t))).toBe(false);
  });

  it('waits out a slow status line with no Stop button, leaving out the label, the emptied list item and source numbers', async () => {
    const cite = '<span class="cite" role="link" aria-label="Café opening">1</span>';
    const g = fakeGmail({ panel: [`<ul><li><b>Date</b>: Opening moved to May 3. ${cite}</li><li><b>Ask</b>: Ada wants a headcount. ${cite} ${cite}</li></ul>`], panelQuiet: true });
    const { result, texts } = run(g, { kind: 'summarize', threadId: CAFE });
    expect(await result).toEqual({ kind: 'answer', text: '- **Date**: Opening moved to May 3.\n- **Ask**: Ada wants a headcount.', sources: [] });
    expect(texts.some((t) => /Gemini response|Collecting info|^-\s*$/m.test(t))).toBe(false);
    // Its shape goes to the log, never its words.
    expect(g.diagnostics.find((l) => l.startsWith('gemini panel answered:'))).not.toMatch(/May 3|headcount/);
  });

  it('waits for Submit to come on, entering the text another way when the editor ignored the first', async () => {
    const g = fakeGmail({ panel: ['<p>Opening moved to May 3.</p>'], panelNeeds: 'beforeinput' });
    const answer = await run(g, { kind: 'summarize', threadId: CAFE }).result;
    expect(answer).toMatchObject({ kind: 'answer', text: 'Opening moved to May 3.' });
    expect(g.asked).toHaveLength(1);
    expect(g.diagnostics.find((l) => l.startsWith('gemini panel:'))).toContain('Submit came on after input events');
  });

  it('asks a question about mail in general from the inbox, not from a conversation left open', async () => {
    const g = fakeGmail({ panel: ['<p>Your flight leaves at 9.</p>'] });
    await run(g, { kind: 'summarize', threadId: CAFE }).result;
    const answer = await run(g, { kind: 'chat', turns: [{ role: 'user', text: 'When is my flight?' }] }, 'r2').result;
    expect(answer).toMatchObject({ kind: 'answer', text: 'Your flight leaves at 9.' });
    expect(g.asked.at(-1)).toEqual({ question: 'When is my flight?', at: '#inbox' });
  });

  it('opens a conversation with a "thread-a:" id by its Gmail URL id', async () => {
    const g = fakeGmail({ deadSummary: true });
    await rejection(run(g, { kind: 'summarize', threadId: MINE }).result);
    // It has no legacy hex id; Gmail's own address for it is the way in, and the address is put back after.
    expect(g.visited).toEqual([`#all/${threadUrlId(MINE)}`]);
    expect(g.location.hash).toBe('#inbox');
  });
});

describe('GmailGemini: Help me write', () => {
  it('writes through the prompt popup, streams the body, returns the subject Gemini chose, and discards the compose', async () => {
    const g = fakeGmail({ draft: ['Hi Ada,', 'Saturday works for me.', 'Priya'] });
    const { result, texts } = run(g, { kind: 'write', prompt: 'say yes to saturday' });
    expect(await result).toEqual({ kind: 'draft', text: 'Hi Ada,\n\nSaturday works for me.\n\nPriya', subject: 'Saturday plans' });
    expect(texts[0]).toBe('Hi Ada,');
    expect(g.sent).toEqual([]);
    expect(g.composes()).toEqual([]);
    expect(g.discarded).toEqual(['1']);
  });

  it('without Help me write in compose, writes in the side panel and keeps only the draft', async () => {
    const g = fakeGmail({
      helpMeWrite: false,
      // Gmail lists the chat's turns, so the whole answer is one list item.
      panel: ["<ul><li><p>Here's a draft:</p><p><b>Subject:</b> Moving our 1:1</p><p>Hi Dana,</p><p>Could we move our 1:1 on Friday?</p><p>Let me know if you'd like changes.</p></li></ul>"],
    });
    expect(await run(g, { kind: 'write', prompt: 'Ask dana to move our 1:1 on Friday' }).result).toEqual({
      kind: 'draft',
      text: 'Hi Dana,\n\nCould we move our 1:1 on Friday?',
      subject: 'Moving our 1:1',
    });
    expect(g.asked[0]!.question).toMatch(/^Suggest the text of an email: Ask dana to move our 1:1 on Friday\. Show it here in the chat without opening or saving a draft/);
    // The compose window it opened to look for Help me write is gone, unsent.
    expect(g.composes()).toEqual([]);
    expect(g.sent).toEqual([]);

    const refined = await run(g, { kind: 'refine', text: 'hey can we move friday\n\nthx', mode: 'formalize' }, 'r2').result;
    expect(refined).toMatchObject({ kind: 'draft' });
    expect(g.asked[1]!.question).toBe('Make more formal this email text, keeping what it says. Answer with only the new text, with no notes before or after it: "hey can we move friday thx"');
    // One miss can be Gmail loading slowly, so Refine looked in compose once more.
    expect(g.discarded).toHaveLength(2);

    // Two in a row: from now on it goes straight to the panel.
    await run(g, { kind: 'refine', text: 'see you then', mode: 'shorten' }, 'r3').result;
    expect(g.asked).toHaveLength(3);
    expect(g.discarded).toHaveLength(2);
  });

  it('refuses to refine a message too long for the side panel rather than cutting it short', async () => {
    const g = fakeGmail({ helpMeWrite: false, panel: ['unused'] });
    await expect(run(g, { kind: 'refine', text: 'word '.repeat(1_000), mode: 'polish' }).result).rejects.toThrow(/too long for Gemini to refine/);
    expect(g.asked).toEqual([]);
    expect(g.composes()).toEqual([]);
  });

  it('reads the draft from a compose window the panel opens instead of answering, then discards it', async () => {
    const g = fakeGmail({ helpMeWrite: false, panel: [], panelOpensDraft: { subject: 'Catching up soon', body: '<div>Hi Dana,</div><div><br></div><div>Free for coffee next week?</div>' } });
    expect(await run(g, { kind: 'write', prompt: 'ask dana to catch up' }).result).toEqual({
      kind: 'draft',
      text: 'Hi Dana,\n\nFree for coffee next week?',
      subject: 'Catching up soon',
    });
    // Neither the compose this opened to look for Help me write nor Gemini's own is left behind.
    expect(g.composes()).toEqual([]);
    expect(g.discarded).toHaveLength(2);
    expect(g.sent).toEqual([]);
  });

  it('discards the compose it opened when Gmail never writes the draft, naming the step', async () => {
    const g = fakeGmail({ deadCreate: true });
    const err = await rejection(run(g, { kind: 'write', prompt: 'hello' }).result);
    expect((err as GmailPageError).step).toBe('write a draft');
    expect(g.composes()).toEqual([]);
    expect(g.sent).toEqual([]);
  });

  it("replies alongside the user's own open draft reply and leaves that draft alone", async () => {
    const g = fakeGmail({ userDraft: 'open', draft: ['Count me in.'] });
    const { result } = run(g, { kind: 'write', prompt: 'say yes', threadId: CAFE }, 'r1', ['msg-a:r-user']);
    expect(await result).toMatchObject({ kind: 'draft', text: 'Count me in.' });
    expect(g.discarded).toEqual(['2']);
    expect(g.composes().map((d) => (d as HTMLElement).dataset.compose)).toEqual(['user']);
  });

  it("won't write into the user's draft when Reply brings it up, and leaves it as it was", async () => {
    const g = fakeGmail({ userDraft: 'on-reply' });
    const err = await rejection(run(g, { kind: 'write', prompt: 'say yes', threadId: CAFE }, 'r1', ['msg-a:r-user']).result);
    expect(err).toMatchObject({ code: 'unsupported', message: expect.stringContaining('already has a draft reply') });
    expect(g.discarded).toEqual([]);
    expect(g.composes().map((d) => (d as HTMLElement).dataset.compose)).toEqual(['user']);
    expect(g.doc.querySelector('[data-compose="user"] [g_editable]')!.textContent).toBe('See you there');
  });

  it("reports a missing Help me write as unsupported, discards the compose, and stops listing write", async () => {
    const g = fakeGmail({ helpMeWrite: false, extra: '<div class="e5IPTd"></div>' });
    expect(await g.gemini.status()).toMatchObject({ ready: true, features: expect.arrayContaining(['write']) });
    const err = await rejection(run(g, { kind: 'write', prompt: 'hello' }).result);
    expect(err).toMatchObject({ code: 'unsupported', message: expect.stringContaining("didn't show a Help me write button") });
    expect(g.composes()).toEqual([]);
    const status = await g.gemini.status();
    expect(status.ready && status.features).not.toContain('write');
  });
});

describe('GmailGemini: suggested replies', () => {
  it('reads chips whose words live only in their aria-label, inside Gmail\'s current toolbar', async () => {
    const chip = (t: string) => `<button class="Rju2Ue-aoh" aria-label="Suggested reply, ${t}"><span class="Rju2Ue-aoi"></span></button>`;
    const g = fakeGmail({ extra: `<div role="toolbar" aria-label="Suggested replies">${chip('Got it, thanks!')}${chip('Done.')}</div>` });
    const answer = await run(g, { kind: 'replies', threadId: CAFE }).result;
    expect(answer).toEqual({ kind: 'replies', replies: [{ label: 'Got it, thanks!', text: 'Got it, thanks!' }, { label: 'Done.', text: 'Done.' }] });
  });
});

describe('GmailGemini: cancel', () => {
  it('stops mid-stream: the call rejects with Stopped and the compose is gone once cancel resolves', async () => {
    const g = fakeGmail({ draft: ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'] });
    const texts: string[] = [];
    let cancelled: Promise<void> | undefined;
    const result = g.gemini.run({ kind: 'write', prompt: 'long' }, 'w1', {
      onText: (t) => {
        texts.push(t);
        cancelled ??= g.gemini.cancel('w1');
      },
    });
    const err = await rejection(result);
    expect(err).toMatchObject({ message: 'Stopped', code: 'unknown' });
    await cancelled;
    expect(g.composes()).toEqual([]);
    expect(texts).toEqual(['One.']);
  });

  it('cancels a request still queued behind another without it touching the page', async () => {
    const g = fakeGmail({ draft: ['Hi.', 'Bye.'], answer: ['<p>x</p>'] });
    const first = run(g, { kind: 'write', prompt: 'first' }, 'a').result;
    const second = run(g, { kind: 'search', query: 'what did Ada say about chairs?' }, 'b').result;
    const stopped = rejection(second);
    await g.gemini.cancel('b');
    expect(await stopped).toMatchObject({ message: 'Stopped' });
    expect(await first).toMatchObject({ kind: 'draft', text: 'Hi.\n\nBye.' });
    expect(g.searched).toEqual([]);
  });
});

describe('GmailGemini: status', () => {
  const cases: [string, FakeOptions, object][] = [
    ['Ask Gmail', {}, { ready: true, features: ['chat', 'summary', 'write', 'refine', 'search', 'inbox'] }],
    ['only AI Inbox', { placeholder: 'Search mail', extra: '<div class="CL u7KLgd"></div>' }, { ready: true, features: ['summary', 'write', 'refine', 'inbox'] }],
    ['only suggested replies (no Gemini hook to infer from)', { placeholder: 'Search mail', extra: '<div class="B6t8wd"></div>' }, { ready: true, features: ['replies'] }],
    ['Proofread and Help me schedule in a compose menu', { extra: '<div role="menuitem">Proofread</div><div aria-label="Help me schedule"></div>' }, { ready: true, features: ['chat', 'summary', 'write', 'refine', 'proofread', 'search', 'inbox', 'schedule'] }],
    ['no Gemini at all', { placeholder: 'Search mail' }, { ready: false, block: 'plan' }],
    // Gmail sells Gemini to accounts without it from the same places; an offer isn't Gemini.
    ['only an offer to try Gemini in the header', { placeholder: 'Search mail', extra: '<div class="e5IPTd"><button aria-label="Try Gemini">Try Gemini</button></div>' }, { ready: false, block: 'plan' }],
    ['only the promotional callout', { placeholder: 'Search mail', extra: '<div data-rp-placement-id="gemkick-pep-icon-callout-id">Meet Gemini in Gmail</div>' }, { ready: false, block: 'plan' }],
    ['an upgrade chip where Help me write goes', { placeholder: 'Search mail', extra: '<div data-tooltip="Help me write: upgrade to Google AI Pro"></div>' }, { ready: false, block: 'plan' }],
    ['the real header button, with an offer elsewhere', { placeholder: 'Search mail', extra: '<div class="e5IPTd"><button aria-label="Ask Gemini"></button></div><a aria-label="Get Google One">Get Google One</a>' }, { ready: true, features: expect.arrayContaining(['chat', 'summary', 'write']) }],
    ['Gmail in French', { lang: 'fr' }, { ready: false, block: 'page', detail: expect.stringContaining('needs Gmail in English') }],
  ];
  it.each(cases)('%s', async (_name, options, want) => {
    expect(await fakeGmail(options).gemini.status()).toMatchObject(want);
  });

  it("reports 'page' when Gmail's page isn't there", async () => {
    const g = fakeGmail();
    g.doc.body.replaceChildren();
    expect(await g.gemini.status()).toMatchObject({ ready: false, block: 'page' });
  });

  it('keeps an answer for a few minutes, then looks again', async () => {
    const g = fakeGmail({ placeholder: 'Search mail' });
    expect(await g.gemini.status()).toMatchObject({ ready: false, block: 'plan' });
    g.doc.body.insertAdjacentHTML('beforeend', '<div class="CL u7KLgd"></div>');
    await g.clock.sleep(10_000);
    expect(await g.gemini.status()).toMatchObject({ ready: false });
    await g.clock.sleep(30_000);
    expect(await g.gemini.status()).toMatchObject({ ready: true });
  });

  it('refuses to run with Gmail in another language, without touching the page', async () => {
    const g = fakeGmail({ lang: 'fr', answer: ['<p>x</p>'] });
    const err = await rejection(run(g, { kind: 'search', query: 'what did Ada say?' }).result);
    expect(err).toMatchObject({ code: 'unsupported', message: expect.stringContaining('"fr"') });
    expect(g.searched).toEqual([]);
  });
});

describe('reading answers', () => {
  it.each([
    ['a legacy hex link', `<a href="#inbox/${toLegacyHexId(CAFE)}">1</a>`, CAFE],
    ['a search result link', `<a href="https://mail.google.com/mail/u/0/#search/caf%C3%A9/${toLegacyHexId(TRIP)}">2</a>`, TRIP],
    ['data-legacy-thread-id', `<span data-legacy-thread-id="${toLegacyHexId(TRIP)}">2</span>`, TRIP],
    ['data-thread-id with its #', `<span data-thread-id="#${CAFE}">1</span>`, CAFE],
    ["Gmail's URL id for a thread it started", `<a href="#inbox/${threadUrlId(MINE)}">3</a>`, MINE],
    ['a link to something else', '<a href="#settings/general">x</a>', undefined],
  ])('%s', (_name, html, want) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(threadRefOf(host.firstElementChild!)).toBe(want);
  });

  it('numbers sources by first mention and drops a trailing list of bare citations', () => {
    const host = document.createElement('div');
    host.innerHTML = `<p>Two things <a href="#inbox/${toLegacyHexId(TRIP)}">a</a> and <a href="#inbox/${toLegacyHexId(CAFE)}">b</a>, again <a href="#inbox/${toLegacyHexId(TRIP)}">a</a>.</p><h4>Sources</h4><ol><li><a href="#inbox/${toLegacyHexId(TRIP)}">Trip</a></li></ol>`;
    const { text, sources } = toMarkdown(host, () => true);
    expect(text).toBe('Two things [1] and [2], again [1].');
    expect(sources.map((s) => s.threadId)).toEqual([TRIP, CAFE]);
  });
});

describe('draftFrom', () => {
  it("reads Gemini's draft card as a subject and a body, leaving recipients out, even run together on one line", () => {
    expect(draftFrom("- To: dana@example.com Subject: Moving our 1:1 Body: Hi Dana, could we move Friday's 1:1 to the afternoon? Let me know what works. Best, Ada")).toEqual({
      subject: 'Moving our 1:1',
      text: "Hi Dana,\n\ncould we move Friday's 1:1 to the afternoon? Let me know what works.\n\nBest,\nAda",
    });
    // No "Body:" label, the subject run straight into the greeting.
    expect(draftFrom("- Subject: Visiting soon Hi Mom, Hello! I'd like to visit soon. Best, Ada")).toEqual({
      subject: 'Visiting soon',
      text: "Hi Mom,\n\nHello! I'd like to visit soon.\n\nBest,\nAda",
    });
    // With its own lines, the body keeps them as they are.
    expect(draftFrom('To: dana@example.com\nSubject: Moving our 1:1\nBody: Hi Dana,\n\nCould we move it?\n\nThanks,\nAda')).toEqual({
      subject: 'Moving our 1:1',
      text: 'Hi Dana,\n\nCould we move it?\n\nThanks,\nAda',
    });
  });

  it('keeps the line breaks of a draft laid out with its own (pre-wrap) lines', () => {
    const root = document.createElement('div');
    root.innerHTML = '<ul><li><div style="white-space: pre-wrap">To: dana@example.com\nSubject: Lunch\nBody: Hi Dana,\n\nLunch Friday?\n\nAda</div></li></ul>';
    document.body.append(root);
    const text = toMarkdown(root, () => true, { refs: false }).text;
    root.remove();
    expect(draftFrom(text)).toEqual({ subject: 'Lunch', text: 'Hi Dana,\n\nLunch Friday?\n\nAda' });
  });
});

describe('diffFixes', () => {
  /** Applies fixes back to front, as the app would. */
  const apply = (text: string, fixes: ReturnType<typeof diffFixes>) => [...fixes].reverse().reduce((t, f) => t.slice(0, f.start) + f.replacement + t.slice(f.end), text);
  it.each([
    ['Their going too the store tomorow.', "They're going to the store tomorrow."],
    ['Thanks for the the update', 'Thanks for the update.'],
    ['see you monday', 'See you on Monday!'],
    ['Hello', 'Hi there, hello'],
  ])('fixes for %j rebuild the corrected text', (original, revised) => {
    const fixes = diffFixes(original, revised);
    expect(apply(original, fixes)).toBe(revised);
    for (const f of fixes) expect(original.slice(f.start, f.end)).not.toBe(f.replacement);
  });

  it('ignores whitespace Gmail rewrote on its own', () => {
    expect(diffFixes('One line.\nTwo lines.', 'One line.\n\nTwo  lines.')).toEqual([]);
  });

  it('names a one-word change by what changed', () => {
    expect(diffFixes('i agree', 'I agree').map((f) => f.kind)).toEqual(['Capitalization']);
    expect(diffFixes('teh plan', 'the plan').map((f) => f.kind)).toEqual(['Spelling']);
  });
});

describe('chatQuestion', () => {
  it('folds the last turns in and grounds the question in the open conversation', () => {
    const q = chatQuestion(
      [
        { role: 'user', text: 'who is coming?' },
        { role: 'model', text: 'Ada and Priya.' },
        { role: 'user', text: 'and when?' },
      ],
      'Café opening',
    );
    expect(q).toBe('I asked: who is coming? You said: Ada and Priya. Now: About the email "Café opening": and when?');
  });

  it('drops earlier turns rather than send Ask Gmail an essay', () => {
    const q = chatQuestion([
      { role: 'user', text: 'x'.repeat(300) },
      { role: 'model', text: 'y'.repeat(300) },
      { role: 'user', text: 'and the date?' },
    ]);
    expect(q.length).toBeLessThanOrEqual(400);
    expect(q).toContain('and the date?');
  });
});

describe('SessionBackend with Gemini', () => {
  const backend = (options: ConstructorParameters<typeof SessionBackend>[0]) =>
    new SessionBackend({ tokens: new FakeTokens(), fetch: async () => new Response('', { status: 500 }), sleep: async () => {}, ...options });

  it("has no Gemini methods without Gmail's page", () => {
    const g = fakeGmail();
    const b = backend({ gemini: g.gemini });
    expect(b.gemini).toBeUndefined();
    expect(b.geminiStatus).toBeUndefined();
  });

  it('streams as gemini events with the request id, and reads a stalled step as advice', async () => {
    const g = fakeGmail({ answer: ['<p>Ada asked for 12 chairs.</p>'], deadSummary: true });
    const b = backend({ page: g.page, gemini: g.gemini });
    const events: unknown[] = [];
    b.subscribe((e) => events.push(e));
    await b.gemini!({ kind: 'search', query: 'how many chairs did Ada ask for?' }, 'q7');
    expect(events.at(-1)).toEqual({ type: 'gemini', requestId: 'q7', text: 'Ada asked for 12 chairs.' });

    const err = await rejection(b.gemini!({ kind: 'summarize', threadId: CAFE }, 'q8'));
    expect(err).toBeInstanceOf(BackendError);
    expect((err as Error).message).toBe('Gmail stopped responding before it could show the summary. Try again in a moment, or use Gemini in classic Gmail.');
  });
});
