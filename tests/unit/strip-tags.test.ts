import { describe, expect, it } from 'vitest';
import { decodeBasicEntities, stripCodeBlocks, stripComments, stripTags } from '../../src/shared/strip-tags';
import { signaturePreview } from '../../src/app/features/compose/signatures';
import { htmlToText } from '../../src/app/data/api/html-text';
import { htmlToPlainText } from '../../src/session/account';

describe('strip-tags', () => {
  it('leaves no tag behind when pieces would join into one', () => {
    expect(stripTags('a<<b>script>alert(1)</script>c')).not.toMatch(/<[^>]*>/);
    expect(stripCodeBlocks('<scr<script>x</script>ipt>alert(1)</script>')).not.toContain('<script');
    expect(stripComments('<!<!-- x -->-- y -->z')).toBe('z');
  });

  it('decodes &amp; last, so an escaped entity stays escaped', () => {
    expect(decodeBasicEntities('&amp;lt;b&amp;gt; &lt;i&gt;')).toBe('&lt;b&gt; <i>');
  });

  it('keeps the plain-text conversions reading the same', () => {
    expect(signaturePreview('<div>Ada&nbsp;Lovelace</div><div>R&amp;D &amp;lt;3</div>')).toBe('Ada Lovelace R&D &lt;3');
    expect(htmlToText('<p>Hi <b>there</b></p><script>bad()</script>')).toBe('Hi there');
    expect(htmlToPlainText('<style>p{}</style><p>One</p><p>Two &amp; three</p>')).toBe('One\nTwo & three');
  });
});
