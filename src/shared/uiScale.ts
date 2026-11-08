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

export function applyFrameScale(frame: HTMLIFrameElement, scale: UiScale) {
  const zoom = scale === 1 ? '' : String(scale);
  if (frame.style.zoom === zoom) return;
  frame.style.zoom = zoom;
  try {
    if (scale === 1) localStorage.removeItem(UI_SCALE_KEY);
    else localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // No storage: the next tab opens at 100% until the app says otherwise.
  }
}

/** Answers with the size applied and the host's pixel ratio to check it by. */
export function serveFrameScale(frame: HTMLIFrameElement, requested: unknown, targetOrigin: string) {
  if (!isUiScale(requested)) return;
  applyFrameScale(frame, requested);
  frame.contentWindow?.postMessage({ source: 'better-gmail/content', type: 'scale', scale: requested, ratio: window.devicePixelRatio }, targetOrigin);
}

/** Where the engine carries the zoom into the frame, its pixel ratio is the host's times the zoom. */
export const scaleTookEffect = (frameRatio: number, hostRatio: number, scale: number) => Math.abs(frameRatio - hostRatio * scale) < 0.02;
