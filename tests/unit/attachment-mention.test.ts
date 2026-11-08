import { describe, expect, it } from 'vitest';
import { attachmentMention } from '../../src/app/features/attachreminder/mentions';

const check = (html: string, subject = '', checkSubject = true) => attachmentMention({ html, subject, checkSubject });

describe('attachmentMention', () => {
  it.each([
    ['<div>Hi Lena,</div><div>I’ve attached the signed lease.</div>', "I've attached"],
    ['<p>Attaching the deck for Thursday.</p>', 'Attaching'],
    ['<div>Quick one. Attached is the invoice for March.</div>', 'Attached'],
    ['<div>Please find attached my notes</div>', 'find attached'],
    ['<div>The receipts are attached, let me know if anything is missing.</div>', 'receipts are attached'],
    ['<div>Details are in the attachment.</div>', 'in the attachment'],
    ['<div>PFA</div>', 'PFA'],
    ['<div>Thanks again! I’ve attached the photos from Saturday.</div>', "I've attached"],
    ['<div>We have included two screenshots of the bug.</div>', 'We have included two screenshots'],
  ])('flags %s', (html, phrase) => {
    expect(check(html)).toBe(phrase);
  });

  it.each([
    ['<div>Thanks for the attached report, it reads well.</div>'],
    ['<div>Got your attachment, looks great.</div>'],
    ['<div>No attachment needed, the link works.</div>'],
    ["<div>I didn't attach anything this time.</div>"],
    ['<div>Honestly I’m so attached to the old logo.</div>'],
    ['<div>She is attached to her desk plant.</div>'],
    ['<div>Sounds good, see you at 3.</div>'],
  ])('leaves %s alone', (html) => {
    expect(check(html)).toBeNull();
  });

  it('ignores quoted mail and the signature', () => {
    const html =
      '<div>Works for me.</div>' +
      '<div class="gmail_signature">-- <br>Sam, see attached map for directions</div>' +
      '<div class="gmail_quote"><div class="gmail_attr">On Mon, Ana wrote:</div><blockquote>I’ve attached the plan.</blockquote></div>';
    expect(check(html)).toBeNull();
  });

  it('ignores plain-text quote lines', () => {
    expect(check('<div>Sure thing.<br>&gt; I have attached the form<br>&gt; thanks</div>')).toBeNull();
  });

  it('only reads the subject on new messages', () => {
    expect(check('<div>Here you go.</div>', 'Contract attached', true)).toBe('Contract attached');
    expect(check('<div>Thanks!</div>', 'Re: Contract attached', false)).toBeNull();
  });

  it('treats a shared Drive or Dropbox link as the file', () => {
    expect(check('<div>I’ve attached the cut: <a href="https://drive.google.com/file/d/abc">trailer.mov</a></div>')).toBeNull();
    // A link anywhere else doesn't count.
    expect(check('<div>I’ve attached the cut, more at <a href="https://example.com/blog">our blog</a></div>')).toBe("I've attached");
  });
});
