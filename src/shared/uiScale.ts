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
 * Scales the frame the way the browser's own zoom would: the app lays out in the window's size over
 * the scale, and the frame is scaled from its top left corner to fill the window. A transform, not
 * CSS zoom: every engine draws a transformed frame the way it lays it out, while zoom on a frame
 * differs (WebKit paints the box smaller a second time, Firefox measures it unzoomed).
 */
export function applyFrameScale(frame: HTMLIFrameElement, scale: UiScale) {
  const scaled = scale !== 1;
  const size = scaled ? `${100 / scale}%` : '100%';
  frame.style.transform = scaled ? `scale(${scale})` : '';
  frame.style.transformOrigin = scaled ? '0 0' : '';
  frame.style.width = size;
  frame.style.height = size;
  if (scaled) frame.dataset.scale = String(scale);
  else delete frame.dataset.scale;
  try {
    if (scale === 1) localStorage.removeItem(UI_SCALE_KEY);
    else localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // No storage: the next tab opens at 100% until the app says otherwise.
  }
}

export function serveFrameScale(frame: HTMLIFrameElement, requested: unknown) {
  if (isUiScale(requested)) applyFrameScale(frame, requested);
}
