// The host page zooms the app's iframe and the frame takes it like browser zoom, so nothing inside has to know.
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.25] as const;
export type UiScale = (typeof UI_SCALES)[number];

export const isUiScale = (v: unknown): v is UiScale => UI_SCALES.includes(v as UiScale);

export function stepUiScale(current: number, by: 1 | -1): UiScale {
  const at = UI_SCALES.indexOf(isUiScale(current) ? current : 1);
  return UI_SCALES[Math.min(Math.max(at + by, 0), UI_SCALES.length - 1)];
}

export const uiScaleLabel = (s: number) => `${Math.round(s * 100)}%`;

/** The host page's copy, so a new tab opens at the last size before the app has loaded. */
const UI_SCALE_KEY = 'better-gmail:ui-scale';

export function readHostUiScale(): UiScale {
  try {
    const v = Number(localStorage.getItem(UI_SCALE_KEY));
    return isUiScale(v) ? v : 1;
  } catch {
    return 1;
  }
}

/**
 * Zooms the frame the way the browser's own zoom would: the box keeps filling the host and the
 * app lays out in the room the zoom leaves. Chromium and Firefox keep a zoomed frame's box at its
 * size; WebKit shrinks it with the zoom, so there the box is grown back by the same factor.
 */
export function applyFrameScale(frame: HTMLIFrameElement, scale: UiScale) {
  const zoom = scale === 1 ? '' : String(scale);
  if (frame.style.zoom !== zoom || frame.style.width !== '100%' || frame.style.height !== '100%') {
    frame.style.zoom = zoom;
    frame.style.width = '100%';
    frame.style.height = '100%';
    const host = frame.parentElement;
    if (zoom && host) {
      const shrunk = frame.getBoundingClientRect().width / Math.max(1, host.clientWidth - padding(host));
      if (Math.abs(shrunk - scale) < 0.02) {
        frame.style.width = `${100 / scale}%`;
        frame.style.height = `${100 / scale}%`;
      }
    }
  }
  try {
    if (scale === 1) localStorage.removeItem(UI_SCALE_KEY);
    else localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // No storage: the next tab opens at 100% until the app says otherwise.
  }
}

function padding(el: Element) {
  const cs = getComputedStyle(el);
  return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
}

/** Answers with the size applied and the frame's width on screen to check it by. */
export function serveFrameScale(frame: HTMLIFrameElement, requested: unknown, targetOrigin: string) {
  if (!isUiScale(requested)) return;
  applyFrameScale(frame, requested);
  frame.contentWindow?.postMessage({ source: 'better-gmail/content', type: 'scale', scale: requested, width: frame.getBoundingClientRect().width }, targetOrigin);
}

/** The zoom took when the frame lays out at its width on screen over the zoom, as the browser's own zoom does. */
export const scaleTookEffect = (frameWidth: number, hostWidth: number, scale: number) => Math.abs(frameWidth * scale - hostWidth) < 2;
