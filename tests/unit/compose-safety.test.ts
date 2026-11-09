import type { MailBackend } from '../../src/app/data/backend';
import type { Draft, OutgoingMessage } from '../../src/app/data/types';

vi.mock('../../src/app/ui/Snackbar', () => ({ snack: () => 0, snackbarManager: { close: () => {} } }));

const { keys, queryClient, setBackend } = await import('../../src/app/data/client');
const { useUi } = await import('../../src/app/state/ui');
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../../src/app/state/settings');
const { composeFromMailto, switchMode } = await import('../../src/app/features/compose/open');
const { saveAndClose } = await import('../../src/app/features/compose/status');
const { scheduleDraftSave, resetDraftTimers } = await import('../../src/app/features/compose/send');
const { normalizeUrl, sanitizeForEditor } = await import('../../src/app/features/compose/paste');
const { appendQuote, signatureBlock, withoutQuotes } = await import('../../src/app/features/compose/signatureDom');

afterEach(() => {
  useUi.setState({ composes: [] });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
  resetDraftTimers();
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
