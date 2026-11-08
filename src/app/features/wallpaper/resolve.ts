import { useEffect, useSyncExternalStore } from 'react';
import type { SaliencyMap } from './analyze';
import { OVERSIZED_EDGE } from './plan';
import { loadPicture, savePicture, type StoredPicture } from './store';

/** Settings hold only a reference ("custom:<id>", the picture in IndexedDB); this is the decoded picture. */
interface WallpaperImage {
  url: string;
  width: number;
  height: number;
  /** For cropping around the subject. */
  saliency?: SaliencyMap;
}

export interface ReadyWallpaper {
  ref: string;
  image: WallpaperImage;
  colors: string[];
  name: string;
}

export const customRef = (id: string) => `custom:${id}`;
export const isCustomRef = (ref: string) => ref.startsWith('custom:');

const ready = new Map<string, ReadyWallpaper>();
const loading = new Map<string, Promise<ReadyWallpaper | null>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

async function decoded(url: string) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

async function loadCustom(id: string, ref: string): Promise<ReadyWallpaper | null> {
  const p = await loadPicture();
  if (!p || p.id !== id) return null;
  const url = URL.createObjectURL(new Blob([p.bytes], { type: p.type }));
  try {
    await decoded(url);
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
  const image = { url, width: p.width, height: p.height, saliency: p.saliency };
  if (Math.max(p.width, p.height) > OVERSIZED_EDGE) shrinkLater(p);
  return { ref, image, colors: p.colors, name: p.name };
}

/** Once idle, re-stores a picture from before they were kept small. */
function shrinkLater(p: StoredPicture) {
  const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 2000));
  idle(() => {
    void import('./process')
      .then(({ shrinkPicture }) => shrinkPicture(p))
      .then(async (small) => {
        // Only if it's still the picture kept: another tab may have replaced it.
        if (small && (await loadPicture())?.id === p.id) await savePicture(small);
      })
      .catch(() => undefined);
  });
}

/** The current and a couple of recent ones stay; the rest give their memory back. */
function trim(keep: string) {
  const extra = [...ready.keys()].filter((k) => k !== keep);
  while (extra.length > 2) {
    const k = extra.shift()!;
    const w = ready.get(k)!;
    ready.delete(k);
    URL.revokeObjectURL(w.image.url);
  }
}

/** Null when it no longer exists (replaced in another tab). */
export function prepareWallpaper(ref: string): Promise<ReadyWallpaper | null> {
  const have = ready.get(ref);
  if (have) return Promise.resolve(have);
  let p = loading.get(ref);
  if (!p) {
    const [kind, id = ''] = ref.split(':');
    p = (kind === 'custom' ? loadCustom(id, ref) : Promise.resolve(null))
      .catch(() => null)
      .then((w) => {
        loading.delete(ref);
        if (w) {
          ready.set(ref, w);
          trim(ref);
          emit();
        }
        return w;
      });
    loading.set(ref, p);
  }
  return p;
}

/** Forgets a custom picture that was removed or replaced. */
export function forgetWallpaper(ref: string) {
  const w = ready.get(ref);
  if (!w) return;
  ready.delete(ref);
  URL.revokeObjectURL(w.image.url);
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Null until decoded (it fades in when it arrives). */
export function useReadyWallpaper(ref: string): ReadyWallpaper | null {
  const w = useSyncExternalStore(subscribe, () => (ref ? (ready.get(ref) ?? null) : null), () => null);
  useEffect(() => {
    if (ref && !w) void prepareWallpaper(ref);
  }, [ref, w]);
  return w;
}

