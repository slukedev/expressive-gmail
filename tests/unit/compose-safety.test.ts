import type { MailBackend } from '../../src/app/data/backend';
import type { Draft, OutgoingMessage } from '../../src/app/data/types';

const snacks = vi.hoisted(() => [] as string[]);
vi.mock('../../src/app/ui/Snackbar', () => ({ snack: (text: string) => (snacks.push(text), 0), snackbarManager: { close: () => {} } }));

const { keys, queryClient, setBackend } = await import('../../src/app/data/client');
const { useUi } = await import('../../src/app/state/ui');
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../../src/app/state/settings');
const { composeFromMailto, editDraft, switchMode } = await import('../../src/app/features/compose/open');
const { saveAndClose } = await import('../../src/app/features/compose/status');
const { toOutgoing } = await import('../../src/app/features/compose/send');
const { scheduleDraftSave } = await import('../../src/app/features/compose/send');
const { normalizeUrl, outgoingHtml, sanitizeForEditor } = await import('../../src/app/features/compose/paste');
const { appendQuote, signatureBlock, withoutQuotes } = await import('../../src/app/features/compose/signatureDom');

afterEach(() => {
  useUi.setState({ composes: [] });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
  vi.useRealTimers();
});

const opened = () => useUi.getState().composes.at(-1)!;

describe('mailto: links from a message', () => {
  it('put the body in as text, so markup in it never reaches the message', () => {
    composeFromMailto('mailto:priya@example.com?subject=Hi&body=%3Cimg%20src%3Dhttps%3A%2F%2Ftracker.example.com%2Fp.gif%3E%0Asecond%20line');
    const d = opened();
    expect(d.to.map((a) => a.email)).toEqual(['priya@example.com']);
    expect(d.subject).toBe('Hi');
    expect(d.html).toBe('&lt;img src=https://tracker.example.com/p.gif&gt;<br>second line');
  });

  it('survive a malformed escape and read cc and bcc', () => {
    expect(() => composeFromMailto('mailto:a%ZZ@example.com?cc=b@example.com&bcc=c@example.com')).not.toThrow();
    const d = opened();
    expect(d.cc.map((a) => a.email)).toEqual(['b@example.com']);
    expect(d.bcc.map((a) => a.email)).toEqual(['c@example.com']);
  });
});

describe('html entering the editor', () => {
  it('loses scripts, handlers, styles for the page and unsafe links, and keeps formatting', () => {
    const out = sanitizeForEditor('<style>body{display:none}</style><p style="color:red"><b>Hi</b><img src="https://example.com/a.png" onerror="alert(1)"><a href="javascript:alert(1)">x</a><a href="https://example.com">ok</a></p><script>alert(1)</script>');
    expect(out).toBe('<p style="color:red"><b>Hi</b><img src="https://example.com/a.png"><a>x</a><a href="https://example.com">ok</a></p>');
  });

  it.each(['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/hosts', 'vbscript:x'])('refuses %s as a link address', (url) => {
    expect(normalizeUrl(url)).toBeNull();
  });

  it('still takes a host with a port', () => {
    expect(normalizeUrl('example.com:8080/a')).toBe('https://example.com:8080/a');
  });
});

describe('quoted mail', () => {
  it('opens below the signature, where sending would put it', () => {
    const root = document.createElement('div');
    root.innerHTML = `<div>Thanks!</div><br><br>${signatureBlock('<div>Alex</div>')}`;
    appendQuote(root, '<div class="gmail_quote">On Monday Priya wrote:</div>');
    expect([...root.children].map((c) => c.className || c.tagName)).toEqual(['DIV', 'BR', 'BR', 'gmail_signature', 'BR', 'gmail_quote']);
  });

  const hostile = `<div class="gmail_quote"><div class="compose-form" style="position:fixed;inset:0;z-index:2147483647;color:red;background:url(https://t.example.com/z.gif)">Session expired</div><img src="https://t.example.com/p.gif" srcset="https://t.example.com/p2.gif 2x"><table background="https://t.example.com/bg.gif"><tr><td>x</td></tr></table><video poster="https://t.example.com/poster.png"></video></div>`;

  it("can't cover the app or borrow its styles", () => {
    const root = document.createElement('div');
    appendQuote(root, hostile, { quoteImages: 'load' });
    const fake = [...root.querySelectorAll<HTMLElement>('div')].find((d) => d.textContent === 'Session expired')!;
    expect(fake.className).toBe('');
    expect([fake.style.position, fake.style.zIndex, fake.style.top]).toEqual(['', '', '']);
    expect(fake.style.color).toBe('red');
    expect(root.querySelector('.gmail_quote')).not.toBeNull();
  });

  it('fetches nothing from the sender until sent, then sends it whole', () => {
    const root = document.createElement('div');
    appendQuote(root, hostile, { quoteImages: 'block' });
    expect(root.innerHTML.replace(/data-blocked-[a-z]+="[^"]*"/g, '')).not.toContain('t.example.com');
    const sent = document.createElement('div');
    sent.innerHTML = outgoingHtml(root.innerHTML);
    expect(sent.querySelector('img')?.getAttribute('src')).toBe('https://t.example.com/p.gif');
    expect(sent.querySelector('img')?.getAttribute('srcset')).toBe('https://t.example.com/p2.gif 2x');
    expect(sent.querySelector('table')?.getAttribute('background')).toBe('https://t.example.com/bg.gif');
    expect(sent.querySelector('video')?.getAttribute('poster')).toBe('https://t.example.com/poster.png');
    expect(sent.innerHTML).toContain('https://t.example.com/z.gif');
    expect(sent.innerHTML).not.toContain('data-blocked-');
  });

  it("keeps a sender's own data-blocked attributes from turning into images", () => {
    const out = sanitizeForEditor('<div class="gmail_quote"><img data-blocked-src="https://t.example.com/x.gif"></div>', { quoteImages: 'block' });
    expect(outgoingHtml(out)).not.toContain('t.example.com');
  });

  it('leaves your own pictures alone in a draft with a blocked quote', () => {
    const out = sanitizeForEditor('<div><img src="https://cdn.example/me.png"></div><div class="gmail_quote"><img src="https://t.example.com/p.gif"></div>', { quoteImages: 'block' });
    expect(out).toContain('src="https://cdn.example/me.png"');
    expect(out).not.toContain(' src="https://t.example.com');
  });

  it('comes back out when a reply turns into a forward, leaving your words and signature', () => {
    const html = `<div>Thanks!</div><br><br>${signatureBlock('<div>Alex</div>')}<br><div class="gmail_quote">On Monday Priya wrote:<blockquote>…</blockquote></div>`;
    expect(withoutQuotes(html)).toBe(`<div>Thanks!</div><br><br>${signatureBlock('<div>Alex</div>')}`);
  });
});

describe('closing right after typing', () => {
  it('saves to the draft the autosave in flight created, instead of making a second one', async () => {
    vi.useFakeTimers();
    const saves: OutgoingMessage[] = [];
    let land: () => void = () => {};
    let n = 0;
    const saveDraft = vi.fn(async (m: OutgoingMessage): Promise<Draft> => {
      saves.push(m);
      const id = m.draftId ?? `d${++n}`;
      // The first save is slow; it lands only when the test says so.
      if (saves.length === 1) await new Promise<void>((r) => (land = r));
      return { id, message: { id: `m-${id}` } as Draft['message'] };
    });
    setBackend({ capabilities: { drafts: true }, saveDraft } as unknown as MailBackend);

    const key = useUi.getState().openCompose({ subject: 'Quick note', html: 'first words' });
    scheduleDraftSave(opened(), () => {});
    await vi.advanceTimersByTimeAsync(1600);
    expect(saves).toHaveLength(1);

    useUi.getState().updateCompose(key, { html: 'first words, then more' });
    saveAndClose(useUi.getState().composes.find((c) => c.key === key)!);
    await vi.advanceTimersByTimeAsync(10);
    // The close waits for the first save instead of racing it.
    expect(saves).toHaveLength(1);
    land();
    await vi.advanceTimersByTimeAsync(10);
    expect(saves).toHaveLength(2);
    expect(saves[1].draftId).toBe('d1');
    expect(saves[1].html).toBe('first words, then more');
  });
});

describe('forward then reply', () => {
  it("doesn't bring the original's files onto the reply when they finish loading late", async () => {
    let release: () => void = () => {};
    const getAttachment = vi.fn(() => new Promise<{ data: string }>((r) => (release = () => r({ data: 'QUJD' }))));
    setBackend({ capabilities: { drafts: false }, getAttachment } as unknown as MailBackend);
    const original = {
      id: 'm1',
      threadId: 't1',
      from: { name: 'Priya', email: 'priya@example.com' },
      to: [{ email: 'me@example.com' }],
      cc: [],
      subject: 'Plans',
      date: 0,
      snippet: 'Plans',
      bodyText: 'Plans',
      labelIds: [],
      headers: { messageId: '<m1@example.com>' },
      attachments: [{ id: 'a1', filename: 'map.pdf', mimeType: 'application/pdf', size: 3 }],
      isDraft: false,
    };
    queryClient.setQueryData(keys.thread('t1'), { id: 't1', subject: 'Plans', messages: [original] });
    const key = useUi.getState().openCompose({ mode: 'reply', threadId: 't1', inReplyTo: '<m1@example.com>', to: [original.from], html: '' });
    switchMode(key, 'forward');
    switchMode(key, 'reply');
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(useUi.getState().composes.find((c) => c.key === key)!.attachments).toEqual([]);
  });
});

describe('a saved draft opened again', () => {
  const saves: OutgoingMessage[] = [];
  let release: () => void = () => {};

  /** A draft with a file and a picture in its body, whose parts arrive when the test says. */
  function reopen() {
    vi.useFakeTimers();
    saves.length = 0;
    snacks.length = 0;
    const parts: Record<string, string> = { a1: 'JVBERi0=', a2: 'iVBORw==' };
    let arrive: (() => void)[] = [];
    release = () => arrive.forEach((go) => go());
    const getAttachment = vi.fn((_m: string, id: string) => new Promise<{ data: string }>((r) => arrive.push(() => r({ data: parts[id]! }))));
    const saveDraft = vi.fn(async (m: OutgoingMessage): Promise<Draft> => {
      saves.push(m);
      return { id: 'd1', message: { id: 'm-d1' } as Draft['message'] };
    });
    setBackend({ capabilities: { drafts: true }, getAttachment, saveDraft } as unknown as MailBackend);
    arrive = [];
    const key = editDraft({
      id: 'r1',
      threadId: 't9',
      from: { name: 'Me', email: 'me@example.com' },
      to: [{ email: 'lena@example.com' }],
      cc: [],
      bcc: [],
      subject: 'Lease',
      date: 0,
      snippet: 'Anbei der Vertrag',
      bodyHtml: '<div>Anbei der Vertrag.</div><div><img src="cid:logo" alt=""></div>',
      labelIds: ['DRAFT'],
      headers: {},
      attachments: [
        { id: 'a1', filename: 'lease.pdf', mimeType: 'application/pdf', size: 5 },
        { id: 'a2', filename: 'logo.png', mimeType: 'image/png', size: 9, inline: true, contentId: 'logo' },
      ],
      isDraft: true,
    } as unknown as Parameters<typeof editDraft>[0]);
    useUi.getState().updateCompose(key, { html: '<div>Anbei der Vertrag, unterschrieben.</div><div><img src="cid:logo" alt=""></div>' });
    return key;
  }
  const compose = (key: string) => useUi.getState().composes.find((c) => c.key === key)!;
  const parts = (m: OutgoingMessage) => m.attachments.map((a) => [a.filename, a.data, a.contentId]);

  it('keeps its files and inline picture: autosave waits for them, then saves them with the draft', async () => {
    const key = reopen();
    scheduleDraftSave(compose(key), () => {});
    await vi.advanceTimersByTimeAsync(1600);
    // Saving now would replace the draft with one that has no files.
    expect(saves).toHaveLength(0);

    release();
    await vi.advanceTimersByTimeAsync(0);
    // The picture is part of the body, not a file in the list (or for the attachment reminder).
    expect(compose(key).attachments.map((a) => a.filename)).toEqual(['lease.pdf']);
    scheduleDraftSave(compose(key), () => {});
    await vi.advanceTimersByTimeAsync(1600);
    expect(parts(saves.at(-1)!)).toEqual([
      ['lease.pdf', 'JVBERi0=', undefined],
      ['logo.png', 'iVBORw==', 'logo'],
    ]);
    expect(saves.at(-1)!.html).toContain('unterschrieben');
  });

  it('closed while its files load: waits, saves the edits with them, and only then says Draft saved', async () => {
    const key = reopen();
    void saveAndClose(compose(key));
    await vi.advanceTimersByTimeAsync(100);
    expect(saves).toHaveLength(0);
    expect(snacks).not.toContain('Draft saved');

    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(saves).toHaveLength(1);
    expect(saves[0]!.html).toContain('unterschrieben');
    expect(parts(saves[0]!)).toEqual([
      ['lease.pdf', 'JVBERi0=', undefined],
      ['logo.png', 'iVBORw==', 'logo'],
    ]);
    expect(snacks).toContain('Draft saved');
  });

  it("drops the inline picture once it's taken out of the body", async () => {
    const key = reopen();
    release();
    await vi.advanceTimersByTimeAsync(0);
    useUi.getState().updateCompose(key, { html: '<div>Anbei der Vertrag.</div>' });
    expect(parts(toOutgoing(compose(key)))).toEqual([['lease.pdf', 'JVBERi0=', undefined]]);
  });
});

describe('inline pictures in the editor', () => {
  it('show without their cid: address and get it back on the way out', () => {
    const shown = sanitizeForEditor('<div><img src="cid:logo" alt=""></div>');
    expect(shown).not.toContain('src=');
    expect(shown).toContain('data-cid="logo"');
    const t = document.createElement('div');
    t.innerHTML = shown;
    t.querySelector('img')!.setAttribute('src', 'data:image/png;base64,iVBORw==');
    expect(outgoingHtml(t.innerHTML)).toBe('<div><img alt="" src="cid:logo"></div>');
  });
});

describe('composing full screen by default', () => {
  const on = () => useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, composeFullScreen: true } });
  const windows = () => useUi.getState().composes.map((c) => c.window);

  it('opens new windows full screen, one at a time, folding the last page into the dock', () => {
    on();
    const open = useUi.getState().openCompose;
    open({ mode: 'new' });
    open({ mode: 'forward', threadId: 't1', window: 'open' });
    expect(windows()).toEqual(['minimized', 'full']);
    open({ mode: 'new' });
    expect(windows()).toEqual(['minimized', 'minimized', 'full']);
  });

  it('leaves inline replies, and windows asked for minimized, where they were put', () => {
    on();
    const open = useUi.getState().openCompose;
    open({ mode: 'reply', threadId: 't1', inline: true });
    open({ mode: 'new', window: 'minimized' });
    expect(windows()).toEqual(['open', 'minimized']);
  });

  it("is off by default, and a full window opened by hand doesn't count against the dock's three", () => {
    const open = useUi.getState().openCompose;
    open({ mode: 'new', window: 'full' });
    open({ mode: 'new' });
    open({ mode: 'new' });
    open({ mode: 'new' });
    expect(windows()).toEqual(['full', 'open', 'open', 'open']);
    open({ mode: 'new' });
    expect(windows()).toEqual(['full', 'minimized', 'open', 'open', 'open']);
  });
});
