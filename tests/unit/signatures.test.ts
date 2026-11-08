import { describe, expect, it } from 'vitest';
import { cleanPaste, normalizeUrl } from '../../src/app/features/compose/paste';
import { applySignature, signatureBlock, signatureIn } from '../../src/app/features/compose/signatureDom';
import {
  EMPTY_COMPOSE_DATA,
  defaultSignature,
  deleteSignature,
  sanitizeComposeData,
  sendingAddresses,
  setDefault,
  withImported,
  type ComposeData,
} from '../../src/app/features/compose/signatures';
import type { Account } from '../../src/app/data/types';

const ids = () => {
  let n = 0;
  return () => `s${++n}`;
};

const main = {
  email: 'alex@example.com',
  name: 'Alex',
  sendAs: [
    { name: 'Alex', email: 'alex@example.com' },
    { name: 'Alex', email: 'Hello@Studio.example.net' },
  ],
  signature: '<div>Alex</div>',
};
const studio = { email: 'alex@studio.example.org', name: 'Alex', signature: '<div>Studio</div>' };

describe('importing Gmail signatures', () => {
  it('turns each account signature into a saved one and the default on every address of that account', () => {
    const d = withImported(EMPTY_COMPOSE_DATA, [main, studio], ids());
    expect(d.signatures.map((s) => [s.id, s.html])).toEqual([
      ['s1', '<div>Alex</div>'],
      ['s2', '<div>Studio</div>'],
    ]);
    // Several accounts: each imported signature is named after its address.
    expect(d.signatures.map((s) => s.name)).toEqual(['alex@example.com', 'alex@studio.example.org']);
    expect(defaultSignature(d, 'hello@studio.example.net', 'new')?.id).toBe('s1');
    expect(defaultSignature(d, 'ALEX@example.com', 'reply')?.id).toBe('s1');
    expect(defaultSignature(d, 'alex@studio.example.org', 'reply')?.id).toBe('s2');
  });

  it('imports an account once, so a signature you deleted stays deleted', () => {
    const first = withImported(EMPTY_COMPOSE_DATA, [main], ids());
    const deleted = deleteSignature(first, first.signatures[0].id);
    const again = withImported(deleted, [main], ids());
    expect(again).toBe(deleted);
    expect(again.signatures).toEqual([]);
    expect(defaultSignature(again, 'alex@example.com', 'new')).toBeNull();
  });

  it("keeps defaults you chose and doesn't duplicate a signature you already have", () => {
    const mine: ComposeData = { ...EMPTY_COMPOSE_DATA, signatures: [{ id: 'own', name: 'Mine', html: '<div>Alex</div>' }], defaults: { 'alex@example.com': { new: null, reply: 'own' } } };
    const d = withImported(mine, [main], ids());
    expect(d.signatures).toHaveLength(1);
    expect(d.defaults['alex@example.com']).toEqual({ new: null, reply: 'own' });
    expect(d.defaults['hello@studio.example.net']).toEqual({ new: 'own', reply: 'own' });
  });

  it('records an account with no Gmail signature without adding anything', () => {
    const d = withImported(EMPTY_COMPOSE_DATA, [{ email: 'a@example.com', name: 'A' }], ids());
    expect(d.signatures).toEqual([]);
    expect(d.imported).toEqual(['a@example.com']);
  });
});

describe('signature defaults', () => {
  it('are separate for new mail and replies, and deleting a signature clears only the defaults that used it', () => {
    let d: ComposeData = { ...EMPTY_COMPOSE_DATA, signatures: [{ id: 'a', name: 'A', html: 'A' }, { id: 'b', name: 'B', html: 'B' }] };
    d = setDefault(d, 'Me@Example.com', 'new', 'a');
    d = setDefault(d, 'me@example.com', 'reply', 'b');
    expect(defaultSignature(d, 'me@example.com', 'new')?.name).toBe('A');
    expect(defaultSignature(d, 'me@example.com', 'reply')?.name).toBe('B');
    d = deleteSignature(d, 'b');
    expect(d.defaults['me@example.com']).toEqual({ new: 'a', reply: null });
  });

  it('lists every address you can send from once, across the accounts of a merged scope', () => {
    const merged = { ...main, index: 0, members: [{ ...main, index: 0, key: 'a' }, { ...studio, index: 1, key: 'b' }, { ...main, index: 2, key: 'c' }] } as Account;
    expect(sendingAddresses(merged).map((x) => x.address.email)).toEqual(['alex@example.com', 'Hello@Studio.example.net', 'alex@studio.example.org']);
  });

  it('drop stored values of the wrong shape', () => {
    const d = sanitizeComposeData({ signatures: [{ id: 'a', name: 'A', html: 'x' }, { id: 1 }], defaults: { 'X@Y.com': { new: 'a', reply: 3 } }, imported: 'no', recentEmoji: ['👍', 4] });
    expect(d).toEqual({ signatures: [{ id: 'a', name: 'A', html: 'x' }], defaults: { 'x@y.com': { new: 'a', reply: null } }, imported: [], recentEmoji: ['👍'] });
  });
});

describe('swapping the signature in a message', () => {
  const editor = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  };
  const typed = '<div>Hi Priya,</div><div>See you <b>Friday</b>.</div>';

  it('replaces only the signature block, leaving what you wrote and the quote alone', () => {
    const quote = '<div class="gmail_quote"><blockquote>Earlier mail <div class="gmail_signature">-- <br>Theirs</div></blockquote></div>';
    const root = editor(`${typed}<br><br>${signatureBlock('<div>Alex</div>')}${quote}`);
    applySignature(root, '<div>Alex, Studio</div>');
    expect(root.innerHTML).toBe(`${typed}<br><br>${signatureBlock('<div>Alex, Studio</div>')}${quote}`);
  });

  it('removes it with the blank lines above it, then puts one back above a quote you opened', () => {
    const quote = '<div class="gmail_quote">On Monday Priya wrote:</div>';
    const root = editor(`${typed}<br><br>${signatureBlock('<div>Alex</div>')}${quote}`);
    applySignature(root, null);
    expect(root.innerHTML).toBe(`${typed}${quote}`);
    applySignature(root, '<div>Alex</div>');
    expect(root.innerHTML).toBe(`${typed}<br><br>${signatureBlock('<div>Alex</div>')}${quote}`);
  });

  it('knows which saved signature a message carries, and when it was edited by hand', () => {
    const sigs = [
      { id: 'a', name: 'A', html: '<div>Alex</div>\n<div style="color:#5f6368">Designer</div>' },
      { id: 'b', name: 'B', html: '<div>Short</div>' },
    ];
    expect(signatureIn(editor(`${typed}${signatureBlock(sigs[0].html)}`), sigs)).toBe('a');
    expect(signatureIn(editor(typed), sigs)).toBeNull();
    const edited = editor(`${typed}${signatureBlock('<div>Short, edited</div>')}`);
    expect(signatureIn(edited, sigs)).toBeUndefined();
  });
});

describe('paste cleanup', () => {
  it("keeps what Docs text means and drops how it looks, including Docs' bold wrapper", () => {
    const docs =
      '<b style="font-weight:normal" id="docs-internal-guid-1"><p style="font-family:Arial;font-size:11pt"><span style="font-weight:700;color:#ff0000">Launch</span> <span style="font-style:italic">today</span></p></b>';
    expect(cleanPaste(docs)).toBe('<p><b>Launch</b> <i>today</i></p>');
  });

  it('drops pictures that only exist on the copier’s machine and unsafe links', () => {
    const html = '<img src="file:///tmp/a.png"><img src="https://example.com/a.png"><a href="javascript:alert(1)">x</a><a href="https://example.com">ok</a>';
    expect(cleanPaste(html)).toBe('<img src="https://example.com/a.png"><a>x</a><a href="https://example.com">ok</a>');
  });
});

describe('link addresses', () => {
  it.each([
    ['example.com/docs', 'https://example.com/docs'],
    ['https://example.com', 'https://example.com'],
    ['priya@example.com', 'mailto:priya@example.com'],
    ['not a link', null],
    ['hello', null],
  ])('%s becomes %s', (input, out) => {
    expect(normalizeUrl(input)).toBe(out);
  });
});
