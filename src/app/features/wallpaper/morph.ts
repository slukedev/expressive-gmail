import { MaterialShapes, Morph, morphToPath, roundedPolygonToPath, type RoundedPolygon } from 'material-shapes-ts';
import type { ShapeName } from '../../ui/ShapeIcon';

const polygon = (n: ShapeName) => MaterialShapes[n] as RoundedPolygon;

/** In a 1 x 1 box, as SVG path data. */
export const pathOf = (n: ShapeName) => roundedPolygonToPath(polygon(n)).toSvgPathData();

/** Damping 0.8, stiffness 380: the app's no-bounce spring (ShapeIcon uses the same). */
function settle(t: number) {
  const zeta = 0.8;
  const omega = Math.sqrt(380);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));
}

export const MORPH_MS = 520;

/** Returns a cancel. With reduced motion it goes straight to the end. */
export function animateShape(from: ShapeName, to: ShapeName, apply: (d: string) => void): () => void {
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    apply(pathOf(to));
    return () => {};
  }
  const morph = new Morph(polygon(from), polygon(to));
  apply(morphToPath(morph, 0).toSvgPathData());
  const start = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const t = Math.min(now - start, MORPH_MS);
    apply(morphToPath(morph, Math.min(1, Math.max(0, settle(t / 1000)))).toSvgPathData());
    if (t < MORPH_MS) raf = requestAnimationFrame(step);
    else apply(pathOf(to));
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
