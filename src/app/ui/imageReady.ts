import { useEffect, useState } from 'react';
import { cap } from '../../shared/bounded';

/** An <img> fires load before a big image is decoded, and with decoding="async" paints empty until it is, so a large picture flashes. Images decode here first; one decoded before paints in the same frame next time. */
const decoded = new Set<string>();
/** So a frame can take an image's shape before it shows. */
const sizes = new Map<string, { width: number; height: number }>();
const decoding = new Map<string, Promise<boolean>>();

/** True once it can paint at once, false if it won't load. */
function decodeImage(src: string, referrerPolicy: ReferrerPolicy = 'no-referrer'): Promise<boolean> {
  if (decoded.has(src)) return Promise.resolve(true);
  let pending = decoding.get(src);
  if (!pending) {
    const img = new Image();
    img.referrerPolicy = referrerPolicy;
    img.src = src;
    // Without decode() (or refused for some SVGs), fall back to the load event.
    const ready = typeof img.decode === 'function' ? img.decode().catch(() => (img.complete && img.naturalWidth > 0 ? undefined : loaded(img))) : loaded(img);
    pending = ready.then(
      () => {
        cap(decoded.add(src), 1000);
        if (img.naturalWidth && img.naturalHeight) cap(sizes.set(src, { width: img.naturalWidth, height: img.naturalHeight }), 1000);
        return true;
      },
      () => false,
    );
    pending.finally(() => decoding.delete(src));
    decoding.set(src, pending);
  }
  return pending;
}

function loaded(img: HTMLImageElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (img.complete && img.naturalWidth > 0) return resolve();
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => reject(new Error('image did not load')), { once: true });
  });
}

export function imageSize(src: string | undefined): { width: number; height: number } | undefined {
  return src ? sizes.get(src) : undefined;
}

/** Decoded this quickly, an image came from the browser's cache. */
const CACHED_MS = 150;

/** `instant`: ready before this render, so skip the fade. `cached`: decoded only now but from the browser's cache (a reload). `failed`: it won't load. */
export function useImageReady(src: string | undefined): { ready: boolean; instant: boolean; cached: boolean; failed: boolean } {
  const known = !!src && decoded.has(src);
  const [state, setState] = useState<{ src: string; ok: boolean; fast: boolean } | null>(null);
  useEffect(() => {
    if (!src || decoded.has(src)) return;
    let live = true;
    const asked = performance.now();
    void decodeImage(src).then((ok) => live && setState({ src, ok, fast: performance.now() - asked < CACHED_MS }));
    return () => {
      live = false;
    };
  }, [src]);
  const settled = state && state.src === src ? state : null;
  return { ready: known || !!settled?.ok, instant: known && !settled, cached: !!settled?.ok && settled.fast, failed: !!settled && !settled.ok };
}
