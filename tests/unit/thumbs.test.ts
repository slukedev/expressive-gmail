import type { MailBackend } from '../../src/app/data/backend';
import { BackendError } from '../../src/app/data/backend';
import { ORIGINAL_CAP, ThumbCache, limiter, previewKind, textSnippet, type ThumbFile } from '../../src/app/features/attachments/thumbs';

const tick = () => new Promise((r) => setTimeout(r, 0));
const b64 = (s: string) => btoa(s);

function file(id: string, mimeType: string, filename: string, size = 1000): ThumbFile {
  return { id, messageId: 'm1', mimeType, filename, size };
}

function fakeBackend(opts: { thumb?: (id: string) => { data: string; mimeType: string } | undefined | Promise<never>; noThumbs?: boolean } = {}) {
  const getThumbnail = vi.fn(async (_m: string, id: string) => opts.thumb?.(id));
  const getAttachment = vi.fn(async (_m: string, id: string) => ({ data: b64(`bytes of ${id}\nline 2`), mimeType: '' }));
  const b = { getAttachment, ...(opts.noThumbs ? {} : { getThumbnail }) } as unknown as MailBackend;
  return { b, getThumbnail, getAttachment };
}

function setup(source: () => MailBackend, extra: Partial<ConstructorParameters<typeof ThumbCache>[0]> = {}) {
  let n = 0;
  const revoked: string[] = [];
  const pdf = vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' }));
  const video = vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' }));
  const cache = new ThumbCache({
    source,
    createUrl: () => `blob:${++n}`,
    revokeUrl: (u) => void revoked.push(u),
    renderers: { pdf, video },
    ...extra,
  });
  return { cache, revoked, pdf, video };
}

describe('previewKind', () => {
  it.each([
    ['image/jpeg', '26 Oct 11a.jpg', 'image'],
    ['application/octet-stream', 'report.PDF', 'pdf'],
    ['text/csv', 'q3.csv', 'text'],
    ['application/json', 'data', 'text'],
    ['application/octet-stream', 'main.rs', 'text'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'brief.docx', 'office'],
    ['application/octet-stream', 'deck.pptx', 'office'],
    ['video/quicktime', 'clip.mov', 'video'],
    ['text/calendar', 'invite.ics', null],
    ['application/zip', 'photos.zip', null],
  ])('%s %s is %s', (mime, name, kind) => {
    expect(previewKind({ mimeType: mime, filename: name })).toBe(kind);
  });
});

describe('textSnippet', () => {
  it('keeps the first lines, trimmed for a card', () => {
    const text = '\uFEFF' + Array.from({ length: 30 }, (_, i) => `line ${i}\t${'x'.repeat(i === 0 ? 200 : 1)}`).join('\r\n');
    const lines = textSnippet(text).split('\n');
    expect(lines).toHaveLength(14);
    expect(lines[0]).toHaveLength(121);
    expect(lines[1]).toBe('line 1  x');
  });
});

describe('limiter', () => {
  it('runs at most n at once, the rest in order', async () => {
    const run = limiter(3);
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        run(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          order.push(i);
          active--;
        }),
      ),
    );
    expect(peak).toBe(3);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('moves on after a failed task', async () => {
    const run = limiter(1);
    await expect(run(() => Promise.reject(new Error('no')))).rejects.toThrow('no');
    await expect(run(async () => 'next')).resolves.toBe('next');
  });
});

describe('ThumbCache', () => {
  it("prefers the source's thumbnail and loads each attachment once", async () => {
    const { b, getThumbnail, getAttachment } = fakeBackend({ thumb: () => ({ data: b64('jpg'), mimeType: 'image/jpeg' }) });
    const { cache } = setup(() => b);
    const photo = file('0.1', 'image/jpeg', 'IMG_4031-001.JPG', 6_500_000);
    const [first, again] = await Promise.all([cache.get(photo), cache.get(photo)]);
    expect(first).toEqual({ kind: 'image', url: 'blob:1' });
    expect(again).toBe(first);
    expect(await cache.get(photo)).toBe(first);
    expect(cache.peek(photo)).toBe(first);
    expect(getThumbnail).toHaveBeenCalledTimes(1);
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it('downloads an image original only under the cap when there is no thumbnail', async () => {
    const { b, getAttachment } = fakeBackend({ noThumbs: true });
    const { cache } = setup(() => b);
    expect(await cache.get(file('small', 'image/png', 'a.png', 140_000))).toEqual({ kind: 'image', url: 'blob:1' });
    expect(cache.wants(file('big', 'image/png', 'b.png', ORIGINAL_CAP.image + 1))).toBe(false);
    expect(await cache.get(file('big', 'image/png', 'b.png', ORIGINAL_CAP.image + 1))).toBeUndefined();
    expect(await cache.get(file('unknown', 'image/png', 'c.png', 0))).toBeUndefined();
    expect(getAttachment.mock.calls.map((c) => c[1])).toEqual(['small']);
  });

  it('renders PDFs and videos from the original, and text as its first lines', async () => {
    const { b } = fakeBackend({ noThumbs: true });
    const { cache, pdf, video } = setup(() => b);
    expect(await cache.get(file('p', 'application/pdf', 'menu.pdf'))).toEqual({ kind: 'image', url: 'blob:1' });
    expect(await cache.get(file('v', 'video/mp4', 'clip.mp4'))).toEqual({ kind: 'image', url: 'blob:2' });
    expect(await cache.get(file('t', 'text/plain', 'notes.txt'))).toEqual({ kind: 'text', text: 'bytes of t\nline 2' });
    expect(pdf).toHaveBeenCalledTimes(1);
    expect(video).toHaveBeenCalledTimes(1);
    expect(cache.wants(file('d', 'application/msword', 'brief.doc'))).toBe(false);
  });

  it('stops asking the source for a kind it never has thumbnails for', async () => {
    const { b, getThumbnail, getAttachment } = fakeBackend({ thumb: () => undefined });
    const { cache } = setup(() => b);
    for (let i = 0; i < 3; i++) await cache.get(file(`d${i}`, 'application/octet-stream', `brief${i}.docx`));
    expect(getThumbnail).toHaveBeenCalledTimes(3);
    expect(cache.wants(file('d9', 'application/octet-stream', 'brief9.docx'))).toBe(false);
    expect(await cache.get(file('d9', 'application/octet-stream', 'brief9.docx'))).toBeUndefined();
    expect(getThumbnail).toHaveBeenCalledTimes(3);
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it('remembers a failure instead of retrying, but tries again when the session was not ready', async () => {
    let fail: Error = new Error('boom');
    const { b, getThumbnail } = fakeBackend({ thumb: () => Promise.reject(fail) });
    const { cache } = setup(() => b);
    const photo = file('0.1', 'image/jpeg', 'a.jpg', 3_000_000);
    expect(await cache.get(photo)).toBeUndefined();
    expect(await cache.get(photo)).toBeUndefined();
    expect(getThumbnail).toHaveBeenCalledTimes(1);

    fail = new BackendError('not yet', 'session-unavailable', true);
    const other = file('0.2', 'image/jpeg', 'b.jpg', 3_000_000);
    await cache.get(other);
    await cache.get(other);
    expect(getThumbnail).toHaveBeenCalledTimes(3);
  });

  it('loads three at a time', async () => {
    let active = 0;
    let peak = 0;
    const getThumbnail = vi.fn(async () => {
      peak = Math.max(peak, ++active);
      await tick();
      active--;
      return { data: b64('x'), mimeType: 'image/jpeg' };
    });
    const b = { getThumbnail, getAttachment: vi.fn() } as unknown as MailBackend;
    const { cache } = setup(() => b);
    await Promise.all(Array.from({ length: 10 }, (_, i) => cache.get(file(`a${i}`, 'image/jpeg', `${i}.jpg`))));
    expect(peak).toBe(3);
    expect(getThumbnail).toHaveBeenCalledTimes(10);
  });

  it('revokes the least recently used URL past its limit', async () => {
    const { b } = fakeBackend({ thumb: () => ({ data: b64('x'), mimeType: 'image/jpeg' }) });
    const { cache, revoked } = setup(() => b, { max: 2 });
    const a = file('a', 'image/jpeg', 'a.jpg');
    await cache.get(a);
    await cache.get(file('b', 'image/jpeg', 'b.jpg'));
    await cache.get(a);
    await cache.get(file('c', 'image/jpeg', 'c.jpg'));
    expect(revoked).toEqual(['blob:2']);
    expect(cache.peek(a)).toEqual({ kind: 'image', url: 'blob:1' });
  });

  it('revokes everything when the account changes, and drops loads still in flight', async () => {
    let release: () => void = () => undefined;
    const first = fakeBackend({ thumb: () => ({ data: b64('x'), mimeType: 'image/jpeg' }) });
    const slow = vi.fn(() => new Promise<{ data: string; mimeType: string }>((r) => (release = () => r({ data: b64('y'), mimeType: 'image/jpeg' }))));
    let current: MailBackend = first.b;
    const { cache, revoked } = setup(() => current);
    await cache.get(file('a', 'image/jpeg', 'a.jpg'));
    (first.b as unknown as { getThumbnail: unknown }).getThumbnail = slow;
    const pending = cache.get(file('b', 'image/jpeg', 'b.jpg'));
    await tick();
    current = fakeBackend().b;
    expect(cache.peek(file('a', 'image/jpeg', 'a.jpg'))).toBeUndefined();
    release();
    expect(await pending).toBeUndefined();
    expect(revoked).toEqual(['blob:1', 'blob:2']);
  });

  it('uses demo previews directly, without the network', async () => {
    const { b, getThumbnail } = fakeBackend();
    const { cache } = setup(() => b);
    const demo = { ...file('a', 'image/png', 'a.png'), previewUrl: 'data:image/svg+xml,x' };
    expect(await cache.get(demo)).toEqual({ kind: 'image', url: 'data:image/svg+xml,x' });
    expect(getThumbnail).not.toHaveBeenCalled();
  });
});
