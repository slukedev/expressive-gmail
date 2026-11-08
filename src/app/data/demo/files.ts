/** Real, valid attachment files: PNG (with a tiny deflate encoder), PDF, DOCX (zip), ICS and CSV. */
import { svgDataUri, utf8 } from './util';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length, seed = 0): number {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

class BitWriter {
  private buf = new Uint8Array(1024);
  private len = 0;
  private acc = 0;
  private n = 0;
  private ensure(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.len + extra));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  /** LSB-first bits, as deflate stores everything but Huffman codes. */
  bits(value: number, count: number) {
    this.acc |= value << this.n;
    this.n += count;
    while (this.n >= 8) {
      this.ensure(1);
      this.buf[this.len++] = this.acc & 0xff;
      this.acc >>>= 8;
      this.n -= 8;
    }
  }
  /** Huffman codes go in MSB-first. */
  code(code: number, count: number) {
    let rev = 0;
    for (let i = 0; i < count; i++) rev |= ((code >> i) & 1) << (count - 1 - i);
    this.bits(rev, count);
  }
  finish(): Uint8Array {
    if (this.n > 0) {
      this.ensure(1);
      this.buf[this.len++] = this.acc & 0xff;
      this.acc = 0;
      this.n = 0;
    }
    return this.buf.slice(0, this.len);
  }
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function writeLiteral(w: BitWriter, v: number) {
  if (v < 144) w.code(0x30 + v, 8);
  else if (v < 256) w.code(0x190 + v - 144, 9);
  else if (v < 280) w.code(v - 256, 7);
  else w.code(0xc0 + v - 280, 8);
}

function findIndex(table: number[], v: number): number {
  let i = table.length - 1;
  while (table[i]! > v) i--;
  return i;
}

/** One block, fixed Huffman codes, greedy LZ77 with a short hash chain. */
function deflateRaw(data: Uint8Array): Uint8Array {
  const w = new BitWriter();
  w.bits(1, 1);
  w.bits(1, 2);
  const n = data.length;
  const HBITS = 15;
  const head = new Int32Array(1 << HBITS).fill(-1);
  const prev = new Int32Array(n);
  const hash = (i: number) => (((data[i]! << 10) ^ (data[i + 1]! << 5) ^ data[i + 2]!) * 2654435761) >>> (32 - HBITS);
  const insert = (i: number) => {
    if (i + 2 >= n) return;
    const h = hash(i);
    prev[i] = head[h]!;
    head[h] = i;
  };
  let i = 0;
  while (i < n) {
    let bestLen = 0;
    let bestDist = 0;
    if (i + 2 < n) {
      let cand = head[hash(i)]!;
      let chain = 24;
      const maxLen = Math.min(258, n - i);
      while (cand >= 0 && chain-- > 0 && i - cand <= 32768) {
        let l = 0;
        while (l < maxLen && data[cand + l] === data[i + l]) l++;
        if (l > bestLen) {
          bestLen = l;
          bestDist = i - cand;
          if (l === maxLen) break;
        }
        cand = prev[cand]!;
      }
    }
    if (bestLen >= 3) {
      const li = findIndex(LEN_BASE, bestLen);
      writeLiteral(w, 257 + li);
      if (LEN_EXTRA[li]) w.bits(bestLen - LEN_BASE[li]!, LEN_EXTRA[li]!);
      const di = findIndex(DIST_BASE, bestDist);
      w.code(di, 5);
      if (DIST_EXTRA[di]) w.bits(bestDist - DIST_BASE[di]!, DIST_EXTRA[di]!);
      const end = i + bestLen;
      for (; i < end; i++) insert(i);
    } else {
      writeLiteral(w, data[i]!);
      insert(i);
      i++;
    }
  }
  writeLiteral(w, 256);
  return w.finish();
}

function zlibDeflate(data: Uint8Array): Uint8Array {
  const raw = deflateRaw(data);
  const out = new Uint8Array(raw.length + 6);
  out[0] = 0x78;
  out[1] = 0x01;
  out.set(raw, 2);
  const a = adler32(data);
  out[out.length - 4] = a >>> 24;
  out[out.length - 3] = (a >>> 16) & 255;
  out[out.length - 2] = (a >>> 8) & 255;
  out[out.length - 1] = a & 255;
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** The same scene renders to a PNG (the attachment bytes) and an SVG (a cheap `previewUrl`), so both match. */
export type Shape =
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill: string; r?: number }
  | { t: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { t: 'poly'; pts: number[]; fill: string };

export interface Scene {
  w: number;
  h: number;
  bg: string;
  shapes: Shape[];
}

function hex(c: string): [number, number, number] {
  const v = parseInt(c.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function inside(s: Shape, x: number, y: number): boolean {
  switch (s.t) {
    case 'rect': {
      if (x < s.x || y < s.y || x >= s.x + s.w || y >= s.y + s.h) return false;
      const r = s.r ?? 0;
      if (!r) return true;
      const cx = x < s.x + r ? s.x + r : x > s.x + s.w - r ? s.x + s.w - r : x;
      const cy = y < s.y + r ? s.y + r : y > s.y + s.h - r ? s.y + s.h - r : y;
      return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
    }
    case 'circle':
      return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r * s.r;
    case 'poly': {
      let c = false;
      const p = s.pts;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const xi = p[i]!, yi = p[i + 1]!, xj = p[j]!, yj = p[j + 1]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    }
  }
}

function bbox(s: Shape): [number, number, number, number] {
  if (s.t === 'rect') return [s.x, s.y, s.x + s.w, s.y + s.h];
  if (s.t === 'circle') return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 2) {
    x0 = Math.min(x0, s.pts[i]!);
    x1 = Math.max(x1, s.pts[i]!);
    y0 = Math.min(y0, s.pts[i + 1]!);
    y1 = Math.max(y1, s.pts[i + 1]!);
  }
  return [x0, y0, x1, y1];
}

function rasterize(scene: Scene): Uint8Array {
  const { w, h } = scene;
  const px = new Uint8Array(w * h * 3);
  const [br, bg, bb] = hex(scene.bg);
  for (let i = 0; i < w * h; i++) {
    px[i * 3] = br;
    px[i * 3 + 1] = bg;
    px[i * 3 + 2] = bb;
  }
  for (const s of scene.shapes) {
    const [r, g, b] = hex(s.fill);
    const [x0, y0, x1, y1] = bbox(s);
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
        if (!inside(s, x + 0.5, y + 0.5)) continue;
        const o = (y * w + x) * 3;
        px[o] = r;
        px[o + 1] = g;
        px[o + 2] = b;
      }
    }
  }
  return px;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export function encodePng(scene: Scene): Uint8Array {
  const { w, h } = scene;
  const px = rasterize(scene);
  const raw = new Uint8Array(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(px.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor RGB
  return concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', zlibDeflate(raw)), chunk('IEND', new Uint8Array(0))]);
}

/** With a private ancillary chunk before IEND. */
export function padPng(png: Uint8Array, size: number): Uint8Array {
  const extra = size - png.length - 12;
  if (extra < 0) return png;
  const filler = new Uint8Array(extra);
  for (let i = 0; i < extra; i++) filler[i] = 32 + (i % 95);
  const iendAt = png.length - 12;
  return concat([png.subarray(0, iendAt), chunk('pdTa', filler), png.subarray(iendAt)]);
}

function sceneToSvg(scene: Scene): string {
  const parts = scene.shapes.map((s) => {
    if (s.t === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r ?? 0}" fill="${s.fill}"/>`;
    if (s.t === 'circle') return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="${s.fill}"/>`;
    return `<polygon points="${s.pts.join(' ')}" fill="${s.fill}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.w}" height="${scene.h}" viewBox="0 0 ${scene.w} ${scene.h}"><rect width="100%" height="100%" fill="${scene.bg}"/>${parts.join('')}</svg>`;
}

export function scenePreviewUrl(scene: Scene): string {
  return svgDataUri(sceneToSvg(scene));
}

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Extra space above, in points. */
  gap?: number;
}

function pdfEscape(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/** Exactly `padTo` bytes when given. */
export function makePdf(lines: PdfLine[], padTo = 0): Uint8Array {
  let y = 740;
  const ops: string[] = ['BT'];
  for (const l of lines) {
    const size = l.size ?? 11;
    y -= (l.gap ?? 0) + size * 1.45;
    ops.push(`/${l.bold ? 'F2' : 'F1'} ${size} Tf`, `1 0 0 1 64 ${Math.round(y)} Tm`, `(${pdfEscape(l.text)}) Tj`);
  }
  ops.push('ET');
  const content = ops.join('\n');

  const build = (fill: number): string => {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ];
    if (padTo) objs.push(`<< /Length ${fill} >>\nstream\n${fillText(fill)}\nendstream`);
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return out;
  };
  let fill = 0;
  let s = build(fill);
  for (let i = 0; padTo && i < 6 && s.length !== padTo; i++) {
    fill = Math.max(0, fill + padTo - s.length);
    s = build(fill);
  }
  // The header comment uses high bytes on purpose (binary marker).
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

function fillText(n: number): string {
  const unit = 'demo-fill ';
  return unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
}

function dosStamp(): [number, number] {
  // A fixed stamp so bytes stay deterministic.
  return [(9 << 11) | (30 << 5), ((2026 - 1980) << 9) | (1 << 5) | 15];
}

function makeZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const [time, date] = dosStamp();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = utf8(e.name);
    const crc = crc32(e.data);
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(8, 0, true);
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, e.data.length, true);
    l.setUint32(22, e.data.length, true);
    l.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, e.data.length, true);
    c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    ch.set(name, 46);
    locals.push(lh, e.data);
    centrals.push(ch);
    offset += lh.length + e.data.length;
  }
  const cdSize = centrals.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(8, entries.length, true);
  d.setUint16(10, entries.length, true);
  d.setUint32(12, cdSize, true);
  d.setUint32(16, offset, true);
  return concat([...locals, ...centrals, end]);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** One paragraph per string, optional padding media part. */
export function makeDocx(paragraphs: string[], padTo = 0): Uint8Array {
  const types =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="bin" ContentType="application/octet-stream"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const body = paragraphs
    .map((p, i) =>
      i === 0
        ? `<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`,
    )
    .join('');
  const doc =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const entries = [
    { name: '[Content_Types].xml', data: utf8(types) },
    { name: '_rels/.rels', data: utf8(rels) },
    { name: 'word/document.xml', data: utf8(doc) },
  ];
  const base = makeZip(entries);
  const overhead = 30 + 46 + 'word/media/pad.bin'.length * 2;
  const fill = padTo - base.length - overhead;
  if (fill <= 0) return base;
  return makeZip([...entries, { name: 'word/media/pad.bin', data: utf8(fillText(fill)) }]);
}

function icsStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export interface IcsEvent {
  uid: string;
  title: string;
  start: number;
  end: number;
  location?: string;
  description?: string;
  organizer: { name: string; email: string };
  attendees: { name?: string; email: string }[];
  stamp: number;
}

export function makeIcs(e: IcsEvent): Uint8Array {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Demo Mailbox//Calendar 1.0//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `DTSTAMP:${icsStamp(e.stamp)}`,
    `DTSTART:${icsStamp(e.start)}`,
    `DTEND:${icsStamp(e.end)}`,
    `SUMMARY:${icsText(e.title)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${icsText(e.description)}`] : []),
    `ORGANIZER;CN=${icsText(e.organizer.name)}:mailto:${e.organizer.email}`,
    ...e.attendees.map(
      (a) => `ATTENDEE;CN=${icsText(a.name ?? a.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    ),
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return utf8(lines.join('\r\n') + '\r\n');
}

export function makeCsv(rows: (string | number)[][]): Uint8Array {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return utf8(rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
}
