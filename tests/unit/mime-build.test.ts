import { describe, expect, it } from 'vitest';
import { buildMime } from '../../src/app/data/api/mime-build';
import { parseRawMessage } from '../../src/app/data/api/mime-raw';
import { parsePayload } from '../../src/app/data/api/payload';
import type { OutgoingMessage } from '../../src/app/data/types';

const message = (attachments: OutgoingMessage['attachments']): OutgoingMessage => ({
  to: [{ email: 'lena@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Lease',
  html: '<div>Signed.</div><div><img src="cid:logo" alt=""></div>',
  attachments,
});

const logo = { id: 'a2', filename: 'logo.png', mimeType: 'image/png', size: 4, data: 'iVBORw==', contentId: 'logo' };
const lease = { id: 'a1', filename: 'lease.pdf', mimeType: 'application/pdf', size: 5, data: 'JVBERi0=' };

describe('buildMime', () => {
  it('sends a body picture as an inline part its cid: finds, and a file as a file', () => {
    const parsed = parsePayload(parseRawMessage(buildMime(message([lease, logo]))), 'm1');
    expect(parsed.attachments.map((a) => [a.filename, a.contentId, !!a.inline])).toEqual([
      ['logo.png', 'logo', true],
      ['lease.pdf', undefined, false],
    ]);
    expect(parsed.html).toBeDefined();
  });

  it('keeps the inline part with no other files', () => {
    const raw = buildMime(message([logo]));
    expect(raw).toMatch(/^Content-Type: multipart\/related/m);
    expect(raw).not.toMatch(/multipart\/mixed/);
    expect(parsePayload(parseRawMessage(raw), 'm1').attachments.map((a) => [a.contentId, a.inline])).toEqual([['logo', true]]);
  });
});
