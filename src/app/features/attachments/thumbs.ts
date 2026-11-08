import { useEffect, useState, type RefObject } from 'react';
import type { MailBackend } from '../../data/backend';
import { backend } from '../../data/client';
import type { Attachment } from '../../data/types';

export type ThumbFile = Pick<Attachment, 'id' | 'messageId' | 'mimeType' | 'filename' | 'previewUrl'> & { size?: number };
export type Preview = { kind: 'image'; url: string } | { kind: 'text'; text: string };
export type PreviewKind = 'image' | 'pdf' | 'text' | 'video' | 'office';

/** Without a source thumbnail, originals up to these sizes are downloaded and rendered here. */
export const ORIGINAL_CAP: Record<Exclude<PreviewKind, 'office'>, number> = {
  image: 2 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  text: 1024 * 1024,
  video: 20 * 1024 * 1024,
};
/** CSS pixels; cards are under 200, so this covers 2x screens. */
const THUMB_WIDTH = 400;
/** Kinds the source had no thumbnail for this many times stop being asked. */
const GIVE_UP = 3;
const TEXT_LINES = 14;

const TEXT_EXT = new Set(
  'txt text csv tsv md markdown json xml yml yaml log ini toml conf cfg env js mjs cjs ts tsx jsx py rb go rs java kt swift c h cpp hpp cs php sh zsh bash sql css scss html htm vue svelte'.split(' '),
);
const OFFICE_EXT = new Set('doc docx xls xlsx ppt pptx odt ods odp rtf pages numbers key'.split(' '));
const VIDEO_EXT = new Set('mp4 m4v mov webm'.split(' '));

/** Null for none. */
export function previewKind(file: Pick<ThumbFile, 'mimeType' | 'filename'>): PreviewKind | null {
  const mime = file.mimeType.toLowerCase();
  const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
  const generic = !mime || mime === 'application/octet-stream';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/') || (generic && VIDEO_EXT.has(ext))) return 'video';
  if (mime === 'text/calendar' || ext === 'ics') return null;
  if (/officedocument|msword|ms-excel|ms-powerpoint|opendocument|rtf/.test(mime) || OFFICE_EXT.has(ext)) return 'office';
  if (mime.startsWith('text/') || /[/+](json|xml|javascript|x-yaml|yaml|x-sh|sql|toml)$/.test(mime) || TEXT_EXT.has(ext)) return 'text';
  return null;
}

/** Trimmed for a card. */
export function textSnippet(text: string, lines = TEXT_LINES): string {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .slice(0, lines)
    .map((l) => (l.length > 120 ? l.slice(0, 120) : l).replace(/\t/g, '  '))
    .join('\n')
    .trimEnd();
}

/** The rest wait in order. */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            queue.shift()?.();
          });
      };
      if (active < max) run();
      else queue.push(run);
    });
}

function base64Blob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export interface Renderers {
  pdf(data: Uint8Array): Promise<Blob | undefined>;
  video(blob: Blob): Promise<Blob | undefined>;
}

const defaultRenderers: Renderers = {
  pdf: async (data) => (await import('./pdf')).firstPageImage(data, THUMB_WIDTH),
  video: (blob) => posterFrame(blob, THUMB_WIDTH),
};

interface ThumbOptions {
  source: () => MailBackend;
  concurrency?: number;
  /** Before the least recently used is dropped (and its URL revoked). */
  max?: number;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
  renderers?: Renderers;
}

/** Per attachment for this backend's lifetime; misses are remembered too, so nothing retries in a loop. */
export class ThumbCache {
  private owner: MailBackend | undefined;
  private readonly entries = new Map<string, Promise<Preview | undefined>>();
  private readonly ready = new Map<string, Preview | undefined>();
  private readonly run: ReturnType<typeof limiter>;
  private readonly max: number;
  private readonly createUrl: (blob: Blob) => string;
  private readonly revokeUrl: (url: string) => void;
  private readonly renderers: Renderers;
  private hits = new Map<PreviewKind, number>();
  private misses = new Map<PreviewKind, number>();

  constructor(private readonly options: ThumbOptions) {
    this.run = limiter(options.concurrency ?? 3);
    this.max = options.max ?? 200;
    this.createUrl = options.createUrl ?? ((b) => URL.createObjectURL(b));
    this.revokeUrl = options.revokeUrl ?? ((u) => URL.revokeObjectURL(u));
    this.renderers = options.renderers ?? defaultRenderers;
  }

  private source(): MailBackend {
    const b = this.options.source();
    if (b !== this.owner) {
      this.clear();
      this.owner = b;
    }
    return b;
  }

  private asksSource(b: MailBackend, kind: PreviewKind): boolean {
    if (!b.getThumbnail) return false;
    if (kind === 'image') return true;
    return (this.hits.get(kind) ?? 0) > 0 || (this.misses.get(kind) ?? 0) < GIVE_UP;
  }

  /** So cards without one skip the observer. */
  wants(file: ThumbFile): boolean {
    const kind = previewKind(file);
    if (!kind) return false;
    if (file.previewUrl) return true;
    const b = this.source();
    if (this.asksSource(b, kind)) return true;
    return kind !== 'office' && (file.size ?? 0) > 0 && file.size! <= ORIGINAL_CAP[kind];
  }

  /** Undefined while pending or when there is none. */
  peek(file: ThumbFile): Preview | undefined {
    if (file.previewUrl) return previewKind(file) === 'image' ? { kind: 'image', url: file.previewUrl } : undefined;
    this.source();
    return this.ready.get(key(file));
  }

  get(file: ThumbFile): Promise<Preview | undefined> {
    if (file.previewUrl && previewKind(file) === 'image') return Promise.resolve(this.peek(file));
    const b = this.source();
    const k = key(file);
    let entry = this.entries.get(k);
    if (entry) {
      // Most recently used goes last, away from eviction.
      this.entries.delete(k);
      this.entries.set(k, entry);
      return entry;
    }
    // Started a tick later, so a load evicted or cleared while queued is skipped.
    const task = () => (b === this.owner && this.entries.get(k) === entry ? this.load(b, file) : Promise.resolve(undefined));
    entry = Promise.resolve()
      .then(() => this.run(task))
      .then(
        (preview) => {
          if (b !== this.owner || this.entries.get(k) !== entry) {
            this.release(preview);
            return undefined;
          }
          this.ready.set(k, preview);
          return preview;
        },
        (err: unknown) => {
          // Gmail's session wasn't ready yet: let a later look try again.
          if ((err as { code?: string })?.code === 'session-unavailable' && this.entries.get(k) === entry) this.entries.delete(k);
          return undefined;
        },
      );
    this.entries.set(k, entry);
    this.evict();
    return entry;
  }

  private async load(b: MailBackend, file: ThumbFile): Promise<Preview | undefined> {
    const kind = previewKind(file);
    if (!kind) return undefined;
    if (this.asksSource(b, kind)) {
      const thumb = await b.getThumbnail!(file.messageId, file.id);
      const counts = thumb ? this.hits : this.misses;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if (thumb) return { kind: 'image', url: this.createUrl(base64Blob(thumb.data, thumb.mimeType)) };
    }
    if (kind === 'office' || !file.size || file.size > ORIGINAL_CAP[kind]) return undefined;
    const { data, mimeType } = await b.getAttachment(file.messageId, file.id);
    const blob = base64Blob(data, mimeType || file.mimeType);
    if (kind === 'text') {
      const text = textSnippet(await blob.slice(0, 16_384).text());
      return text ? { kind: 'text', text } : undefined;
    }
    const image = kind === 'pdf' ? await this.renderers.pdf(new Uint8Array(await blob.arrayBuffer())) : kind === 'video' ? await this.renderers.video(blob) : blob;
    return image ? { kind: 'image', url: this.createUrl(image) } : undefined;
  }

  private release(preview: Preview | undefined) {
    if (preview?.kind === 'image' && preview.url.startsWith('blob:')) this.revokeUrl(preview.url);
  }

  private evict() {
    while (this.entries.size > this.max) {
      const [k] = this.entries.keys();
      if (k === undefined) return;
      this.entries.delete(k);
      this.release(this.ready.get(k));
      this.ready.delete(k);
    }
  }

  /** In-flight loads are dropped when they finish. */
  clear() {
    for (const preview of this.ready.values()) this.release(preview);
    this.ready.clear();
    this.entries.clear();
    this.hits = new Map();
    this.misses = new Map();
  }
}

const key = (f: ThumbFile) => `${f.messageId} ${f.id}`;

export const thumbs = new ThumbCache({ source: backend });

/** Once `ref` comes near the viewport. */
export function useThumbnail(file: ThumbFile, ref: RefObject<Element | null>): Preview | undefined {
  const k = `${key(file)} ${file.previewUrl ?? ''}`;
  const [state, setState] = useState(() => ({ key: k, preview: thumbs.peek(file) }));
  useEffect(() => {
    const ready = thumbs.peek(file);
    setState({ key: k, preview: ready });
    const el = ref.current;
    if (ready || !el || !thumbs.wants(file)) return;
    let live = true;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        void thumbs.get(file).then((preview) => live && setState({ key: k, preview }));
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
    // The file object is rebuilt on every render; its identity is the key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k]);
  return state.key === k ? state.preview : undefined;
}

/** A little way in: the very first frame is often black. */
function posterFrame(blob: Blob, width: number, timeoutMs = 10_000): Promise<Blob | undefined> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  return new Promise<Blob | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    const done = (b: Blob | undefined) => {
      clearTimeout(timer);
      resolve(b);
    };
    video.onerror = () => done(undefined);
    video.onloadedmetadata = () => {
      video.currentTime = Number.isFinite(video.duration) ? Math.min(1, video.duration / 10) : 0;
    };
    video.onseeked = () => {
      if (!video.videoWidth) return done(undefined);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round((video.videoHeight / video.videoWidth) * width);
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => done(b ?? undefined), 'image/jpeg', 0.85);
    };
    video.src = url;
  }).finally(() => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  });
}
