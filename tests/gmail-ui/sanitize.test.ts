// What Gmail strips from HTML mail, and how it folds quoted history behind "...".
import { isTrackingPixel, sanitizeEmail, splitQuoted, textToHtml } from '../../src/app/lib/sanitize';

const clean = (html: string, opts: Partial<Parameters<typeof sanitizeEmail>[1]> = {}) =>
  sanitizeEmail(html, { blockRemoteImages: false, ...opts });
const dom = (html: string) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};

describe('sanitizeEmail', () => {
  it.each([
    ['script', '<p>Hi</p><script>alert(1)</script>', 'script'],
    ['iframe', '<p>Hi</p><iframe src="https://evil.example.com"></iframe>', 'iframe'],
    ['object/embed', '<object data="x.swf"></object><embed src="x.swf">', 'object, embed'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example.com"><p>Hi</p>', 'meta'],
    ['base href', '<base href="https://evil.example.com/"><a href="/login">Log in</a>', 'base'],
    ['form', '<form action="https://evil.example.com/steal"><input name="password"><button>Sign in</button></form>', 'form'],
  ])('removes %s', (_l, html, selector) => {
    expect(dom(clean(html)).querySelector(selector)).toBeNull();
  });

  it('keeps no password field a phisher could use', () => {
    const d = dom(clean('<form action="https://evil.example.com"><input type="password" name="p"></form>'));
    expect(d.querySelector('input[type=password]')).toBeNull();
  });

  it('strips every inline event handler', () => {
    const d = dom(
      clean('<img src="https://img.example.com/a.png" onerror="alert(1)" width="600"><div onclick="x()" onmouseover="y()">Hi</div><svg onload="z()"></svg><body onload="w()">'),
    );
    for (const el of d.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) expect(attr).not.toMatch(/^on/i);
    }
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'jav&#x09;ascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  ])('neutralises href=%j', (href) => {
    const a = dom(clean(`<a href="${href}">click</a>`)).querySelector('a');
    const out = (a?.getAttribute('href') ?? '').replace(/\s/g, '').toLowerCase();
    expect(out).not.toMatch(/^(javascript|vbscript|data):/);
  });

  it('keeps ordinary links and content', () => {
    const d = dom(clean('<p style="color:#202124">Hello <b>Ana</b>, see <a href="https://example.com/doc?id=1&amp;v=2">the doc</a>.</p>'));
    expect(d.textContent).toContain('Hello Ana, see the doc.');
    expect(d.querySelector('a')?.getAttribute('href')).toBe('https://example.com/doc?id=1&v=2');
  });

  it('opens links in a new tab without handing over the opener', () => {
    const a = dom(clean('<a href="https://example.com">x</a>')).querySelector('a')!;
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel') ?? '').toMatch(/noopener|noreferrer/);
  });

  it('keeps mailto: links', () => {
    expect(dom(clean('<a href="mailto:ana@example.com">Ana</a>')).querySelector('a')?.getAttribute('href')).toBe('mailto:ana@example.com');
  });

  it('removes 1x1 tracking pixels and reports how many', () => {
    const onTrackers = vi.fn();
    const html = [
      '<p>Newsletter</p>',
      '<img src="https://img.example.com/hero.jpg" width="600" height="300" alt="Hero">',
      '<img src="https://t.example.com/open?id=abc" width="1" height="1" alt="">',
      '<img src="https://t.example.net/o.gif" style="width:1px;height:1px;border:0" alt="">',
    ].join('');
    const d = dom(clean(html, { blockTrackers: true, onTrackers }));
    const srcs = [...d.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
    expect(srcs.some((s) => s.includes('hero.jpg'))).toBe(true);
    expect(srcs.some((s) => s.includes('t.example'))).toBe(false);
    expect(onTrackers).toHaveBeenCalledWith(2);
  });

  it('does not load remote images while they are blocked, but keeps inline cid images', () => {
    const cidMap = new Map([['logo@example.com', 'blob:https://mail.example/1234']]);
    const d = dom(
      clean('<img src="https://img.example.com/hero.jpg" width="600"><img src="cid:logo@example.com" width="120">', {
        blockRemoteImages: true,
        cidMap,
      }),
    );
    const srcs = [...d.querySelectorAll('img')].map((i) => i.getAttribute('src') ?? '');
    expect(srcs.some((s) => s.startsWith('https://img.example.com'))).toBe(false);
    expect(srcs).toContain('blob:https://mail.example/1234');
  });

  it('keeps links readable but not followable in spam', () => {
    const d = dom(clean('<a href="https://evil.example.com/win">Claim your prize</a>', { disableLinks: true }));
    expect(d.textContent).toContain('Claim your prize');
    expect(d.querySelector('a')?.getAttribute('href') ?? '').not.toContain('evil.example.com');
  });
});

describe('isTrackingPixel', () => {
  const img = (attrs: Record<string, string>) => {
    const el = document.createElement('img');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  it.each([
    [{ src: 'https://t.example.com/open?id=1', width: '1', height: '1' }, true],
    [{ src: 'https://t.example.com/open.gif', style: 'width:1px;height:1px' }, true],
    [{ src: 'https://t.example.com/o.png', width: '2', height: '2' }, true],
    [{ src: 'https://img.example.com/hero.jpg', width: '600', height: '300' }, false],
    [{ src: 'https://img.example.com/mobile-hero.jpg', width: '600', height: '300', style: 'display:none' }, false],
    [{ src: 'https://img.example.com/spacer.gif', width: '1', height: '40' }, false],
  ])('%j', (attrs, expected) => {
    expect(isTrackingPixel(img(attrs))).toBe(expected);
  });
});

describe('splitQuoted', () => {
  it('folds Gmail\'s gmail_quote with its "On ... wrote:" line', () => {
    const html =
      '<div dir="ltr">Sounds good, see you then.</div><br>' +
      '<div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Mon, Oct 12, 2026 at 3:01 PM Ana Lopez &lt;ana@example.com&gt; wrote:<br></div>' +
      '<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;padding-left:1ex">Lunch Thursday?</blockquote></div>';
    const { main, quoted } = splitQuoted(html);
    expect(main).toContain('Sounds good');
    expect(main).not.toContain('Lunch Thursday');
    expect(main).not.toContain('wrote:');
    expect(quoted).toContain('Lunch Thursday');
  });

  it('folds Apple Mail\'s blockquote type=cite', () => {
    const html =
      '<div>Yes, Thursday works.</div><div><br><blockquote type="cite"><div>On Oct 12, 2026, at 3:01 PM, Ana Lopez &lt;ana@example.com&gt; wrote:</div><div>Lunch Thursday?</div></blockquote></div>';
    const { main, quoted } = splitQuoted(html);
    expect(main).toContain('Thursday works');
    expect(main).not.toContain('Lunch Thursday?');
    expect(quoted).toContain('Lunch Thursday?');
  });

  it('folds Outlook\'s reply header', () => {
    const html =
      '<div>Thanks, approved.</div>' +
      '<div id="appendonsend"></div><hr style="display:inline-block;width:98%">' +
      '<div id="divRplyFwdMsg" dir="ltr"><b>From:</b> Ana Lopez &lt;ana@example.com&gt;<br><b>Sent:</b> Monday, October 12, 2026 3:01 PM<br><b>Subject:</b> Budget</div>' +
      '<div>Please approve the Q4 budget.</div>';
    const { main, quoted } = splitQuoted(html);
    expect(main).toContain('Thanks, approved.');
    expect(main).not.toContain('Please approve');
    expect(quoted).toContain('Please approve');
  });

  it('does not hide a forwarded message', () => {
    const html =
      '<div dir="ltr">FYI</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <b>Ana Lopez</b> &lt;ana@example.com&gt;<br>Subject: Contract</div><br>Signed copy attached.</div>';
    const { main } = splitQuoted(html);
    expect(main).toContain('Signed copy attached.');
  });

  it('keeps inline replies written after a quote', () => {
    const html = '<div>See below.</div><blockquote type="cite">Can you do Friday?</blockquote><div>Friday is fine, 2 PM.</div>';
    expect(splitQuoted(html).main).toContain('Friday is fine, 2 PM.');
  });

  it('returns quoted null when there is no history', () => {
    const html = '<div>Just a note, no history.</div>';
    expect(splitQuoted(html)).toEqual({ main: html, quoted: null });
  });
});

describe('textToHtml', () => {
  it('escapes markup', () => {
    const d = dom(textToHtml('Use <b>bold</b> & "quotes"').main);
    expect(d.querySelector('b')).toBeNull();
    expect(d.textContent).toContain('Use <b>bold</b> & "quotes"');
  });

  it('links URLs without swallowing trailing punctuation', () => {
    const d = dom(textToHtml('Docs: https://example.com/a?b=1&c=2. Or (https://example.org/x).').main);
    const hrefs = [...d.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com/a?b=1&c=2', 'https://example.org/x']);
  });

  it('folds a trailing "> " quote block with its attribution', () => {
    const { main, quoted } = textToHtml('Sounds good.\n\nOn Mon, Oct 12, 2026 at 3:01 PM Ana Lopez <ana@example.com> wrote:\n> Lunch Thursday?\n> Noon works.');
    expect(dom(main).textContent).toContain('Sounds good.');
    expect(dom(main).textContent).not.toContain('Lunch Thursday?');
    expect(quoted && dom(quoted).textContent).toContain('Lunch Thursday?');
  });

  it('has no quoted part for plain text', () => {
    expect(textToHtml('Hello\nWorld').quoted).toBeNull();
  });
});
