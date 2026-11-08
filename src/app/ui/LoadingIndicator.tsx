import { useEffect, useRef } from 'react';
import { MaterialShapes, Morph, morphToPath, type RoundedPolygon } from 'material-shapes-ts';

// Compose's indeterminate sequence (LoadingIndicator.kt).
const SEQUENCE = (): RoundedPolygon[] => [
  MaterialShapes.SoftBurst,
  MaterialShapes.Cookie9Sided,
  MaterialShapes.Pentagon,
  MaterialShapes.Pill,
  MaterialShapes.Sunny,
  MaterialShapes.Cookie4Sided,
  MaterialShapes.Oval,
];

let morphs: Morph[] | null = null;
function getMorphs() {
  if (!morphs) {
    const shapes = SEQUENCE();
    morphs = shapes.map((s, i) => new Morph(s, shapes[(i + 1) % shapes.length]));
  }
  return morphs;
}

const MORPH_INTERVAL = 650;
const FULL_ROTATION = 4666;

/** Damping 0.6, stiffness 200, mass 1, sampled at t seconds. */
function spring(t: number) {
  const zeta = 0.6;
  const omega = Math.sqrt(200);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));
}

interface LoadingIndicatorProps {
  size?: number;
  contained?: boolean;
  label?: string;
  className?: string;
}

/** A shape morphing through MaterialShapes while rotating. */
export function LoadingIndicator({ size = 48, contained, label = 'Loading', className }: LoadingIndicatorProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const groupRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const group = groupRef.current;
    if (!path || !group) return;
    const all = getMorphs();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      path.setAttribute('d', morphToPath(all[0], 0).toSvgPathData());
      return;
    }
    let raf = 0;
    const start = performance.now();
    const frame = (now: number) => {
      const elapsed = Math.max(0, now - start);
      const step = Math.floor(elapsed / MORPH_INTERVAL);
      const local = (elapsed % MORPH_INTERVAL) / 1000;
      const progress = Math.min(Math.max(spring(local), 0), 1.1);
      const morph = all[step % all.length];
      path.setAttribute('d', morphToPath(morph, Math.min(progress, 1)).toSvgPathData());
      const rotation = step * 90 + progress * 90 + (elapsed / FULL_ROTATION) * 360;
      group.setAttribute('transform', `rotate(${rotation % 360} 0.5 0.5)`);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Shape is 38/48 of the container, per the token spec.
  const inset = (1 - 38 / 48) / 2;
  return (
    <span
      role="progressbar"
      aria-label={label}
      className={['m3-loading', contained && 'm3-loading--contained', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
    >
      <svg viewBox={`${-inset} ${-inset} ${1 + inset * 2} ${1 + inset * 2}`} width={size} height={size} aria-hidden="true">
        <g ref={groupRef}>
          <path ref={pathRef} fill="currentColor" />
        </g>
      </svg>
    </span>
  );
}
