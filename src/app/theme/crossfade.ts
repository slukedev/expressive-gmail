import { flushSync } from 'react-dom';

let running = false;

/** Changes during a fade apply straight away and retarget it. */
export const themeFading = () => running;

/** The old frame stays up while React re-renders and every surface restyles, so that work never shows as a stutter. */
export function crossfadeTheme(change: () => void) {
  if (running || typeof document === 'undefined' || !document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    change();
    return;
  }
  running = true;
  // Hundreds of surface color transitions would otherwise restyle the page every frame of the fade.
  // A style element, not an attribute: Base UI's scroll lock watches the root's attributes and restyles on change.
  const still = document.createElement('style');
  still.textContent = '*,*::before,*::after{transition:none!important}';
  // Removing it restyles the page once more, so wait for a quiet moment.
  const settle = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => still.remove(), { timeout: 1_000 });
    else setTimeout(() => still.remove(), 300);
  };
  const t = document.startViewTransition(() => {
    document.head.append(still);
    flushSync(change);
  });
  // A hidden tab or a newer transition skips this one; the change still applies.
  t.ready.catch(() => {});
  void t.finished.finally(() => {
    running = false;
    settle();
  });
}
