import { useEffect, useSyncExternalStore } from 'react';
import { isPhone } from '../../shared/mobile';
import { scaleTookEffect } from '../../shared/uiScale';
import { setHostScale } from '../lib/host';
import { useSettingsStore } from '../state/settings';
import { snack } from '../ui/Snackbar';

// Only the host page can zoom this frame. Phones stay at 100%: they already lay out at the phone's width.
const hosted = typeof window !== 'undefined' && window.parent !== window && !isPhone(navigator.userAgent);

// An engine that doesn't carry the zoom into the frame is remembered until the browser updates.
// Versioned: the first check, by pixel ratio, turned the setting off in engines that zoom correctly.
const UNSUPPORTED_KEY = 'bg.uiScaleUnsupported.v2';
let unsupported = (() => {
  try {
    return hosted && localStorage.getItem(UNSUPPORTED_KEY) === navigator.userAgent;
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();
let asked = 1;

function giveUp() {
  unsupported = true;
  try {
    localStorage.setItem(UNSUPPORTED_KEY, navigator.userAgent);
  } catch {
    // Asked again next load.
  }
  snack("This browser can't change the interface size.");
  listeners.forEach((fn) => fn());
}

/** The frame's viewport follows the zoom once the host's change reaches it, with a resize. */
function verify(scale: number, hostWidth: number) {
  const fits = () => scaleTookEffect(window.innerWidth, hostWidth, scale);
  if (fits()) return;
  const stop = () => {
    window.removeEventListener('resize', onResize);
    window.clearTimeout(timer);
  };
  const onResize = () => fits() && stop();
  const timer = window.setTimeout(() => {
    stop();
    if (asked === scale && !fits()) giveUp();
  }, 1500);
  window.addEventListener('resize', onResize);
}

if (hosted) {
  window.addEventListener('message', (e) => {
    const d = e.data as { source?: string; type?: string; scale?: unknown; width?: unknown };
    if (e.source !== window.parent || d?.source !== 'better-gmail/content' || d.type !== 'scale') return;
    if (typeof d.scale === 'number' && d.scale !== 1 && typeof d.width === 'number' && d.width > 0 && !unsupported) verify(d.scale, d.width);
  });
}

export const uiScaleAvailable = () => hosted && !unsupported;

export function useUiScaleAvailable(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    uiScaleAvailable,
    () => false,
  );
}

export function useHostUiScale() {
  const loaded = useSettingsStore((s) => s.loaded);
  const scale = useSettingsStore((s) => s.settings.uiScale);
  const available = useUiScaleAvailable();
  useEffect(() => {
    if (!loaded || !hosted) return;
    asked = available ? scale : 1;
    setHostScale(asked);
  }, [loaded, scale, available]);
}
