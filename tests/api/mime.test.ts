import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../../src/app/data/api/base64';
import { buildMime } from '../../src/app/data/api/mime-build';
import { parseRawMessage } from '../../src/app/data/api/mime-raw';
import { parsePayload, toMessage } from '../../src/app/data/api/payload';
import type { OutgoingMessage } from '../../src/app/data/types';

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

const pdfBytes = new Uint8Array(400).map((_, i) => (i * 37) % 256);

const message: OutgoingMessage = {
  threadId: 't1',
  from: { name: 'Sam Ö', email: 'sam@example.org' },
  to: [
    { name: 'Doe, Jane', email: 'jane@example.com' },
    { name: '山田 太郎', email: 'taro@example.jp' },
  ],
  cc: [{ email: 'cc@example.com' }],
  bcc: [{ name: 'Hidden', email: 'bcc@example.com' }],
  subject: 'Réunion trimestrielle 📅 · 会議の議題について、詳細はこちらをご覧ください',
  html: '<p>Bonjour 👋</p><p>Voir <a href="https://ex.com/r">le rapport</a>.</p>',
  inReplyTo: '<prev@mail.gmail.com>',
  references: '<root@mail.gmail.com> <prev@mail.gmail.com>',
  attachments: [
    { id: 'a1', filename: 'Bericht für Q4.pdf', mimeType: 'application/pdf', size: pdfBytes.length, data: bytesToBase64(pdfBytes) },
    { id: 'a2', filename: 'plain.txt', mimeType: 'text/plain', size: 5, data: btoa('hello') },
  ],
};

describe('MIME builder', () => {
  const raw = buildMime(message, { random: seeded() });

  it('produces 7-bit lines no longer than 998 chars, with base64 bodies wrapped at 76', () => {
    const lines = raw.split('\r\n');
    for (const line of lines) {
      expect(line).toMatch(/^[\x20-\x7e\t]*$/);
      expect(line.length).toBeLessThanOrEqual(998);
    }
    const base64Lines = lines.filter((l) => /^[A-Za-z0-9+/=]{60,}$/.test(l));
    expect(base64Lines.length).toBeGreaterThan(3);
    for (const l of base64Lines) expect(l.length).toBeLessThanOrEqual(76);
    // Bare LF would break some MTAs.
    expect(raw.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('round-trips through the raw parser: headers, bodies and attachment bytes', () => {
    const root = parseRawMessage(raw);
    expect(root.mimeType).toBe('multipart/mixed');
    const msg = toMessage({ id: 'x', threadId: 't1', payload: root });
    expect(msg.subject).toBe(message.subject);
    expect(msg.from).toEqual(message.from);
    expect(msg.to).toEqual(message.to);
    expect(msg.cc).toEqual(message.cc);
    expect(msg.bcc).toEqual(message.bcc);
    expect(msg.headers.inReplyTo).toBe(message.inReplyTo);
    expect(msg.headers.references).toBe(message.references);
    expect(msg.bodyHtml).toBe(message.html);
    expect(msg.bodyText).toBe('Bonjour 👋\n\nVoir le rapport (https://ex.com/r).');

    const files = parsePayload(root, 'x').attachments;
    expect(files.map((f) => [f.filename, f.mimeType])).toEqual([
      ['Bericht für Q4.pdf', 'application/pdf'],
      ['plain.txt', 'text/plain'],
    ]);
    const pdfPart = root.parts![1];
    expect(Array.from(base64ToBytes(pdfPart.body!.data!))).toEqual(Array.from(pdfBytes));
    expect(pdfPart.body!.size).toBe(400);
  });

  it('cannot be tricked into adding headers through CR/LF in the subject or a name', () => {
    const evil = buildMime(
      {
        ...message,
        attachments: [],
        subject: 'hi\r\nBcc: victim@evil.com',
        to: [{ name: 'x\r\nX-Injected: 1', email: 'a@b.com' }],
      },
      { random: seeded() },
    );
    const headerBlock = evil.split('\r\n\r\n')[0];
    expect(headerBlock).not.toMatch(/^Bcc: victim/m);
    expect(headerBlock).not.toMatch(/^X-Injected/m);
  });

  it('without attachments the root is multipart/alternative with text first and html last', () => {
    const root = parseRawMessage(buildMime({ ...message, attachments: [] }, { random: seeded(7) }));
    expect(root.mimeType).toBe('multipart/alternative');
    expect(root.parts!.map((p) => p.mimeType)).toEqual(['text/plain', 'text/html']);
  });
});

describe('raw MIME parser on foreign input', () => {
  it('decodes quoted-printable with soft breaks, folded encoded-word headers and a latin-1 charset', () => {
    const raw = [
      'From: =?ISO-8859-1?Q?Ren=E9?= <rene@x.fr>',
      'Subject: =?UTF-8?B?w6l0w6kg?=',
      ' =?UTF-8?B?8J+MnQ==?=',
      'Content-Type: multipart/alternative; boundary=simple',
      '',
      'This is the preamble.',
      '--simple',
      'Content-Type: text/plain; charset=ISO-8859-1',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Caf=E9 tr=E8s long line that is softly =',
      'broken.',
      '--simple--',
      'epilogue',
    ].join('\n');
    const msg = toMessage({ id: 'q', threadId: 'q', payload: parseRawMessage(raw) });
    expect(msg.from).toEqual({ name: 'René', email: 'rene@x.fr' });
    expect(msg.subject).toBe('été 🌝');
    expect(msg.bodyText).toBe('Café très long line that is softly broken.');
  });
});
