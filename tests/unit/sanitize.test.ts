import { contentPolicy, sanitizeEmail, splitQuoted, textToHtml } from '../../src/app/lib/sanitize';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const clean = (html: string, opts: Parameters<typeof sanitizeEmail>[1] = { blockRemoteImages: false }) => parse(sanitizeEmail(html, opts));

describe('sanitizeEmail', () => {
  it('strips active content and keeps the visible text', () => {
    const doc = clean(`
      <p>Hello <b>Ana</b></p>
      <script>alert(1)</script>
      <iframe src="https://evil.example"></iframe>
      <form action="https://evil.example/steal"><input name="pw"><button>Log in</button></form>
      <object data="x.swf"></object><embed src="x.swf">
      <svg><script>alert(2)</script></svg>
      <base href="https://evil.example/">
      <meta http-equiv="refresh" content="0;url=https://evil.example">
    `);
    expect(doc.body.textContent).toContain('Hello Ana');
    expect(doc.querySelectorAll('script, iframe, form, input, button, object, embed, svg, base, meta')).toHaveLength(0);
  });

  it('removes inline event handlers and javascript: links', () => {
    const doc = clean(`
      <img src="https://cdn.example/a.png" onerror="alert(1)" onload="alert(2)">
      <a id="js" href="javascript:alert(1)" onclick="alert(3)">click</a>
      <a id="js2" href="  JaVaScRiPt:alert(1)">click</a>
      <div onmouseover="alert(4)">hover</div>
    `);
    const attrs = [...doc.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name));
    expect(attrs.filter((n) => n.startsWith('on'))).toEqual([]);
    expect(doc.getElementById('js')?.getAttribute('href') ?? null).toBeNull();
    expect(doc.getElementById('js2')?.getAttribute('href') ?? null).toBeNull();
  });

  it('keeps style tags and table layout attributes', () => {
    const doc = clean(`
      <html><head><style>.brand { color: #0b57d0 }</style></head>
      <body><table width="600" cellpadding="4" bgcolor="#ffffff" align="center"><tr><td valign="top" class="brand">Order #123</td></tr></table></body></html>
    `);
    expect(doc.querySelector('style')?.textContent).toContain('.brand');
    const table = doc.querySelector('table')!;
    expect([table.getAttribute('width'), table.getAttribute('cellpadding'), table.getAttribute('bgcolor'), table.getAttribute('align')]).toEqual(['600', '4', '#ffffff', 'center']);
    expect(doc.querySelector('td')?.getAttribute('valign')).toBe('top');
  });

  it('treats image-map areas like links, in Spam too', () => {
    const map = `<map name="m"><area id="area" shape="rect" coords="0,0,10,10" href="https://example.com/x"></map>`;
    expect(clean(map).getElementById('area')?.getAttribute('target')).toBe('_blank');
    const off = clean(map, { blockRemoteImages: true, disableLinks: true }).getElementById('area')!;
    expect(off.hasAttribute('href')).toBe(false);
    expect(off.getAttribute('data-href')).toBe('https://example.com/x');
  });

  it('opens external links in a new tab and leaves in-page anchors alone', () => {
    const doc = clean(`<a id="ext" href="https://example.com/x" target="_self">x</a><a id="mail" href="mailto:a@b.c">m</a><a id="toc" href="#section-2">jump</a>`);
    for (const id of ['ext', 'mail']) {
      const a = doc.getElementById(id)!;
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')?.split(' ')).toContain('noopener');
    }
    expect(doc.getElementById('toc')?.hasAttribute('target')).toBe(false);
  });

  it('blocks remote images when asked, keeping the source for later', () => {
    const doc = clean(
      `<img id="pixel" src="https://track.example/p.gif?u=1" srcset="https://track.example/p2.gif 2x">
       <img id="insecure" src="http://old.example/logo.png">
       <img id="inline" src="data:image/png;base64,iVBORw0KGgo=">`,
      { blockRemoteImages: true },
    );
    const pixel = doc.getElementById('pixel')!;
    expect(pixel.hasAttribute('src')).toBe(false);
    expect(pixel.hasAttribute('srcset')).toBe(false);
    expect(pixel.getAttribute('data-blocked-src')).toBe('https://track.example/p.gif?u=1');
    expect(doc.getElementById('insecure')?.getAttribute('data-blocked-src')).toBe('http://old.example/logo.png');
    expect(doc.getElementById('inline')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('leaves no other way for a blocked remote image to load', () => {
    const doc = clean(
      `<style>@import url("https://track.example/a.css"); .hero { background: url(https://track.example/bg.png) no-repeat; color: red }</style>
       <img id="set" srcset="https://track.example/1x.png 1x, https://track.example/2x.png 2x">
       <picture><source id="source" srcset="https://track.example/w.webp"><img src="data:image/png;base64,iVBORw0KGgo="></picture>
       <video id="video" src="https://track.example/v.mp4" poster="https://track.example/poster.png"></video>`,
      { blockRemoteImages: true },
    );
    const css = doc.querySelector('style')!.textContent!;
    expect(css).not.toContain('track.example');
    expect(css).toContain('color: red');
    expect(doc.getElementById('set')?.hasAttribute('srcset')).toBe(false);
    expect(doc.getElementById('source')?.hasAttribute('srcset')).toBe(false);
    expect(doc.getElementById('video')?.hasAttribute('src')).toBe(false);
    expect(doc.getElementById('video')?.hasAttribute('poster')).toBe(false);
  });

  it.each([
    ['an escaped url() in a style sheet', String.raw`<style>.a{background:\75 rl(https://t.example.com/a.gif)}</style>`],
    ['image-set() with a bare string', `<style>.a{background-image:image-set("https://t.example.com/b.gif" 1x)}</style>`],
    ['list-style-image', `<ul><li style="list-style-image:url(https://t.example.com/c.gif)">x</li></ul>`],
    ['border-image', `<div style="border-image:url(https://t.example.com/d.gif) 30">x</div>`],
    ['mask, cursor and content', `<div style="mask-image:url(//t.example.com/e.gif);cursor:url('https://t.example.com/f.cur'),auto">x</div><style>p::after{content:url(https://t.example.com/g.gif)}</style>`],
    ['an escaped url() inline', String.raw`<div style="background:\75 rl(https://t.example.com/h.gif)">x</div>`],
    ['an escaped @import', String.raw`<style>@\69mport "https://t.example.com/i.css";</style>`],
    ['an escaped src in @font-face', String.raw`<style>@font-face{font-family:x;src:\75 rl(https://t.example.com/j.woff)}</style>`],
    ['a URL split by a line continuation', `<style>.a{background-image:image-set("ht\\\ntps://t.example.com/k.gif" 1x)}</style>`],
    ['a scheme without slashes', `<style>.a{background:url(https:t.example.com/l.gif)}</style>`],
    ['an escaped scheme', String.raw`<style>.a{background:url(\68 ttps\3a //t.example.com/m.gif)}</style>`],
    ['a track element', `<video><track src="https://t.example.com/n.vtt"></video>`],
  ])('blocks %s', (_, html) => {
    const out = sanitizeEmail(html, { blockRemoteImages: true, blockTrackers: true });
    expect(out).not.toContain('t.example.com');
  });

  it('keeps escaped selectors, so responsive layouts survive blocked images', () => {
    const sheet = String.raw`@media (min-width:600px){.sm\:w-full{width:100%!important}.md\:px-0{padding:0}}.hero{background:url(https://t.example.com/bg.png)}`;
    const css = parse(sanitizeEmail(`<style>${sheet}</style><div class="sm:w-full">x</div>`, { blockRemoteImages: true })).querySelector('style')!.textContent!;
    expect(css).toContain(String.raw`.sm\:w-full{width:100%!important}`);
    expect(css).toContain(String.raw`.md\:px-0{padding:0}`);
    expect(css).not.toContain('t.example.com');
  });

  it('leaves the same CSS alone when images are allowed', () => {
    const out = sanitizeEmail(`<li style="list-style-image:url(https://cdn.example/c.png)">x</li>`, { blockRemoteImages: false });
    expect(out).toContain('https://cdn.example/c.png');
  });

  it('strips background images when blocking, and keeps them otherwise', () => {
    const html = `<td id="cell" background="https://track.example/bg.png" style="color: red; background-image: url('https://track.example/bg2.png')">x</td>`;
    const wrap = (h: string) => `<table><tr>${h}</tr></table>`;
    const blocked = clean(wrap(html), { blockRemoteImages: true }).getElementById('cell')!;
    expect(blocked.hasAttribute('background')).toBe(false);
    expect(blocked.getAttribute('style') ?? '').not.toContain('url(');
    expect(blocked.style.color).toBe('red');

    const allowed = clean(wrap(html), { blockRemoteImages: false }).getElementById('cell')!;
    expect(allowed.getAttribute('background')).toBe('https://track.example/bg.png');
    expect(allowed.style.backgroundImage).toContain('bg2.png');
  });

  it('remote images load normally when not blocked', () => {
    const doc = clean(`<img src="https://cdn.example/a.png">`, { blockRemoteImages: false });
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(doc.querySelector('img')?.hasAttribute('data-blocked-src')).toBe(false);
  });

  it('maps cid: images through the map, with or without angle brackets, and drops unknown ones', () => {
    const cidMap = new Map([
      ['logo@acme', 'blob:https://mail.google.com/1'],
      ['chart@acme', 'blob:https://mail.google.com/2'],
    ]);
    const doc = clean(`<img id="a" src="cid:logo@acme"><img id="b" src="cid:<chart@acme>"><img id="c" src="cid:missing@acme">`, {
      blockRemoteImages: true,
      cidMap,
    });
    expect(doc.getElementById('a')?.getAttribute('src')).toBe('blob:https://mail.google.com/1');
    expect(doc.getElementById('b')?.getAttribute('src')).toBe('blob:https://mail.google.com/2');
    expect(doc.getElementById('c')?.hasAttribute('src')).toBe(false);
    expect(doc.getElementById('c')?.hasAttribute('data-blocked-src')).toBe(false);
  });
});

describe('contentPolicy', () => {
  const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('lets nothing load from the network while images are blocked', () => {
    const policy = contentPolicy({ remote: false });
    expect(policy).toContain("default-src 'none'");
    for (const name of ['img-src', 'media-src', 'font-src', 'style-src']) expect(directive(policy, name)).not.toMatch(/https?:/);
  });

  it('allows remote pictures once the reader does', () => {
    expect(directive(contentPolicy({ remote: true }), 'img-src')).toContain('https:');
  });

  it('allows exact addresses, without their query, and skips any that would break the policy', () => {
    const policy = contentPolicy({ remote: false, images: ['https://cdn.example/a.png?u=1', "https://cdn.example/b;c.png", 'javascript:alert(1)', 'not a url'] });
    expect(directive(policy, 'img-src')).toBe('img-src data: blob: https://cdn.example/a.png');
  });
});

describe('splitQuoted', () => {
  it('splits Gmail quoted history, including the attribution line inside gmail_quote', () => {
    const html = `<div dir="ltr">Sounds good, see you then.</div><br><div class="gmail_quote"><div class="gmail_attr">On Tue, Oct 6, 2026 at 9:00 AM Ana &lt;ana@x.com&gt; wrote:<br></div><blockquote class="gmail_quote">Lunch Thursday?</blockquote></div>`;
    const { main, quoted } = splitQuoted(html);
    expect(parse(main).body.textContent).toContain('Sounds good, see you then.');
    expect(parse(main).body.textContent).not.toContain('Lunch Thursday?');
    expect(quoted).toContain('Lunch Thursday?');
    expect(quoted).toContain('wrote:');
  });

  it('splits Outlook replies at divRplyFwdMsg, taking everything after it', () => {
    const html = `<div>Approved.</div><hr><div id="divRplyFwdMsg"><b>From:</b> Bo<br><b>Sent:</b> Monday</div><div>Can you approve the PO?</div>`;
    const { main, quoted } = splitQuoted(html);
    const mainText = parse(main).body.textContent ?? '';
    expect(mainText).toContain('Approved.');
    expect(mainText).not.toContain('From:');
    expect(mainText).not.toContain('Can you approve');
    expect(quoted).toContain('Can you approve the PO?');
  });

  it('leaves a message with no quote untouched', () => {
    const html = '<div>Just a note.</div>';
    expect(splitQuoted(html)).toEqual({ main: html, quoted: null });
  });

  it('does not fold when the quote is the whole message', () => {
    const html = '<div class="gmail_quote"><blockquote>Forwarded text only</blockquote></div>';
    expect(splitQuoted(html)).toEqual({ main: html, quoted: null });
  });

  it('an image above the quote counts as content', () => {
    const { quoted } = splitQuoted('<img src="blob:x"><blockquote type="cite">older</blockquote>');
    expect(quoted).toContain('older');
  });
});

describe('textToHtml', () => {
  it('escapes HTML in plain text', () => {
    const { main, quoted } = textToHtml('if a < b && c > "d" then <script>');
    expect(main).toContain('if a &lt; b &amp;&amp; c &gt; &quot;d&quot; then &lt;script&gt;');
    expect(main).not.toContain('<script>');
    expect(quoted).toBeNull();
  });

  it.each([
    ['See https://example.com/a?b=1&c=2.', 'https://example.com/a?b=1&amp;c=2'],
    ['(details at https://example.com/x)', 'https://example.com/x'],
    ['Go to https://example.com/path, then', 'https://example.com/path'],
    ['Really? http://example.com/q?!', 'http://example.com/q'],
  ])('links the URL in %j without trailing punctuation', (text, href) => {
    const a = parse(textToHtml(text).main).querySelector('a')!;
    expect(a.getAttribute('href')).toBe(href.replace(/&amp;/g, '&'));
    expect(a.getAttribute('target')).toBe('_blank');
  });

  it('a quote inside a URL cannot break out of the href attribute', () => {
    const doc = parse(textToHtml('x https://example.com/"onmouseover="alert(1)').main);
    const anchors = doc.querySelectorAll('a');
    expect(anchors).toHaveLength(1);
    expect([...anchors[0].attributes].map((a) => a.name).sort()).toEqual(['href', 'rel', 'target']);
  });

  it('splits an "On ... wrote:" quote', () => {
    const text = 'Thanks, that works.\r\n\r\nOn Tue, Oct 6, 2026 at 9:00 AM Ana <ana@x.com> wrote:\r\n> Lunch Thursday?\r\n>\r\n> Ana';
    const { main, quoted } = textToHtml(text);
    expect(parse(main).body.textContent).toBe('Thanks, that works.\n');
    expect(parse(quoted!).body.textContent).toContain('Lunch Thursday?');
    expect(quoted).toContain('Ana &lt;ana@x.com&gt; wrote:');
  });

  it('splits a trailing block of "> " lines without an attribution', () => {
    const { main, quoted } = textToHtml('Agreed.\n> original line one\n\n> line two');
    expect(parse(main).body.textContent).toBe('Agreed.');
    expect(parse(quoted!).body.textContent).toBe('> original line one\n\n> line two');
  });

  it('keeps inline "> " lines followed by more reply text in the main body', () => {
    const { quoted } = textToHtml('> you said this\nand I answer here');
    expect(quoted).toBeNull();
  });

  it('a message that is only a quote is not folded away', () => {
    const { main, quoted } = textToHtml('On Mon, Bo wrote:\n> hi');
    expect(quoted).toBeNull();
    expect(parse(main).body.textContent).toContain('> hi');
  });
});
