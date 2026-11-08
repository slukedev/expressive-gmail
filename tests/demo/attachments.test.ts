// @vitest-environment node
import type { Attachment } from '../../src/app/data/types';
import { fromBase64 } from '../../src/app/data/demo/util';
import { demo, NOW } from './helpers';

const b = demo();

async function bytesOf(threadId: string, pick: (a: Attachment) => boolean): Promise<{ att: Attachment; bytes: Uint8Array; mimeType: string }> {
  const t = await b.getThread(threadId);
  const att = t.messages.flatMap((m) => m.attachments).find(pick);
  if (!att) throw new Error(`no matching attachment in ${threadId}`);
  const res = await b.getAttachment(att.messageId, att.id);
  return { att, bytes: fromBase64(res.data), mimeType: res.mimeType };
}

const ascii = (bytes: Uint8Array, from = 0, to = bytes.length) => new TextDecoder('latin1').decode(bytes.subarray(from, to));

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('attachments are real files', () => {
  it('every attachment returns exactly as many bytes as its size says', async () => {
    const page = await b.listThreads({ q: 'has:attachment OR filename:png', pageSize: 500 });
    let n = 0;
    for (const s of page.threads) {
      const t = await b.getThread(s.id);
      for (const m of t.messages) {
        for (const a of m.attachments) {
          const res = await b.getAttachment(m.id, a.id);
          expect({ file: a.filename, size: fromBase64(res.data).length }).toEqual({ file: a.filename, size: a.size });
          expect(res.mimeType).toBe(a.mimeType);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(25);
  });

  it('PNGs decode: signature, header, and an IDAT stream that inflates to the full image', async () => {
    const { bytes, att } = await bytesOf('t-retention-dashboard', (a) => a.mimeType === 'image/png');
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    expect(ascii(bytes, 12, 16)).toBe('IHDR');
    const w = dv.getUint32(16);
    const h = dv.getUint32(20);
    expect([w, h]).toEqual([560, 300]);
    const idatLen = dv.getUint32(33);
    expect(ascii(bytes, 37, 41)).toBe('IDAT');
    const raw = await inflate(bytes.subarray(41, 41 + idatLen));
    expect(raw.length).toBe(h * (1 + w * 3));
    // Flat illustrations compress a lot, like real screenshots.
    expect(att.size).toBeLessThan(raw.length / 5);
    expect(att.previewUrl).toMatch(/^data:image\/svg\+xml/);
  });

  it('padded photos stay valid PNGs and end with IEND', async () => {
    const { bytes, att } = await bytesOf('t-trail-photos', (a) => a.filename === 'ridge-dusk.png');
    expect(att.size).toBe(5 * 1024 * 1024);
    expect(ascii(bytes, bytes.length - 8, bytes.length - 4)).toBe('IEND');
  });

  it('inline images carry a content id referenced from the HTML', async () => {
    const t = await b.getThread('t-staging-screens');
    const m = t.messages[0]!;
    const inline = m.attachments.filter((a) => a.inline);
    expect(inline.map((a) => a.contentId)).toEqual(['welcome-shot', 'empty-shot']);
    for (const a of inline) expect(m.bodyHtml).toContain(`src="cid:${a.contentId}"`);
    expect(t.hasAttachments).toBe(false);
    expect(m.bodyText).toContain('[image: welcome.png]');
  });

  it('PDFs have a header, a trailer, and an xref where startxref says', async () => {
    for (const [thread, size] of [
      ['t-lease-renewal', 412_672],
      ['x-arch-movein', 0],
    ] as const) {
      const { bytes, att } = await bytesOf(thread, (a) => a.mimeType === 'application/pdf');
      if (size) expect(att.size).toBe(size);
      const text = ascii(bytes);
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(ascii(bytes, bytes.length - 6)).toBe('%%EOF\n');
      const tail = ascii(bytes, bytes.length - 40);
      const startxref = Number(/startxref\n(\d+)\n/.exec(tail)?.[1]);
      expect(ascii(bytes, startxref, startxref + 4)).toBe('xref');
      expect(text).toContain('/Type /Catalog');
    }
  });

  it('docx is a zip with a Word document part', async () => {
    const { bytes } = await bytesOf('t-brand-voice', (a) => a.filename.endsWith('.docx'));
    expect(ascii(bytes, 0, 4)).toBe('PK\x03\x04');
    const text = ascii(bytes);
    expect(text).toContain('word/document.xml');
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('<w:t xml:space="preserve">Fernwork brand voice, v2</w:t>');
  });

  it('calendar invites are VCALENDAR requests for a future time', async () => {
    const { bytes, mimeType } = await bytesOf('t-design-crit-invite', (a) => a.filename.endsWith('.ics'));
    expect(mimeType).toBe('text/calendar');
    const ics = new TextDecoder().decode(bytes);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain('METHOD:REQUEST');
    const start = /DTSTART:(\d{8}T\d{6}Z)/.exec(ics)![1]!;
    const iso = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 11)}:${start.slice(11, 13)}:${start.slice(13, 15)}Z`;
    expect(new Date(iso).getTime()).toBe(new Date(2026, 9, 9, 14, 0).getTime());
    expect(new Date(iso).getTime()).toBeGreaterThan(NOW);
    expect(ics).toContain('ATTENDEE;CN=Alex Rivera');
  });

  it('the bank CSV adds up to the balance in the email', async () => {
    const { bytes } = await bytesOf('u-bank-statement', (a) => a.filename.endsWith('.csv'));
    const rows = new TextDecoder().decode(bytes).trim().split('\r\n').map((r) => r.split(','));
    expect(rows[0]).toEqual(['Date', 'Description', 'Amount', 'Balance']);
    const last = rows[rows.length - 1]!;
    const t = await b.getThread('u-bank-statement');
    expect(t.messages[0]!.bodyText).toContain(Number(last[3]).toLocaleString('en-US', { minimumFractionDigits: 2 }));
  });

  it('unknown attachment ids are not found', async () => {
    const t = await b.getThread('t-lease-renewal');
    await expect(b.getAttachment(t.messages[0]!.id, 'nope')).rejects.toMatchObject({ code: 'not-found' });
  });
});
