import { useEffect, useRef, type CSSProperties } from 'react';
import { MaterialShapes, Morph, morphToPath, roundedPolygonToPath, type RoundedPolygon } from 'material-shapes-ts';
import { Icon, type IconName } from './Icon';

export type ShapeName =
  | 'Cookie4Sided'
  | 'Cookie6Sided'
  | 'Cookie7Sided'
  | 'Cookie9Sided'
  | 'Cookie12Sided'
  | 'Clover4Leaf'
  | 'Clover8Leaf'
  | 'Sunny'
  | 'VerySunny'
  | 'SoftBurst'
  | 'Puffy'
  | 'Flower'
  | 'Gem'
  | 'Pentagon'
  | 'Pill'
  | 'Slanted'
  | 'Arch'
  | 'Bun'
  | 'Burst'
  | 'Circle'
  | 'Square'
  | 'Heart'
  | 'Ghostish'
  | 'PuffyDiamond'
  | 'SoftBoom';

const polygon = (name: ShapeName): RoundedPolygon => MaterialShapes[name];

// An outline costs a fraction of a ms, a morph several; both are cached, and warmShapes() builds the likely ones at idle.
const paths = new Map<ShapeName, string>();
function shapePath(name: ShapeName): string {
  let d = paths.get(name);
  if (d === undefined) {
    d = roundedPolygonToPath(polygon(name)).toSvgPathData();
    paths.set(name, d);
  }
  return d;
}

const morphs = new Map<string, Morph>();
/** B to a is the same morph reversed. */
function morphBetween(a: ShapeName, b: ShapeName): { morph: Morph; reversed: boolean } {
  const reversed = a > b;
  const key = reversed ? `${b}>${a}` : `${a}>${b}`;
  let morph = morphs.get(key);
  if (!morph) {
    morph = reversed ? new Morph(polygon(b), polygon(a)) : new Morph(polygon(a), polygon(b));
    morphs.set(key, morph);
  }
  return { morph, reversed };
}

/** One shape per call so idle slices stay short. */
export function warmShapes(names: ShapeName[], from?: ShapeName): (() => void)[] {
  return names.map((n) => () => {
    shapePath(n);
    if (from && from !== n) morphBetween(from, n);
  });
}

/** Damping 0.8, stiffness 380: settles in about 450ms with no visible overshoot. */
function settle(t: number) {
  const zeta = 0.8;
  const omega = Math.sqrt(380);
  const wd = omega * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t));
}
const DURATION = 520;

/** A new shape morphs from the old one with a quarter turn. */
export function ShapeIcon({
  shape,
  icon,
  size = 48,
  iconSize = 24,
  bg,
  fg,
  filled = true,
  className,
}: {
  shape: ShapeName;
  icon: IconName;
  size?: number;
  iconSize?: 20 | 24 | 28 | 48;
  bg: string;
  fg: string;
  filled?: boolean;
  className?: string;
}) {
  const pathRef = useRef<SVGPathElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const from = useRef<ShapeName>(shape);

  useEffect(() => {
    const path = pathRef.current;
    const group = groupRef.current;
    if (!path || !group) return;
    const prev = from.current;
    from.current = shape;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prev === shape || reduced) {
      path.setAttribute('d', shapePath(shape));
      group.removeAttribute('transform');
      return;
    }
    const { morph, reversed } = morphBetween(prev, shape);
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = Math.min(now - start, DURATION);
      const p = Math.min(Math.max(settle(t / 1000), 0), 1);
      path.setAttribute('d', morphToPath(morph, reversed ? 1 - p : p).toSvgPathData());
      group.setAttribute('transform', `rotate(${(p - 1) * 90} 0.5 0.5)`);
      if (t < DURATION) raf = requestAnimationFrame(frame);
      else {
        path.setAttribute('d', shapePath(shape));
        group.removeAttribute('transform');
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [shape]);

  return (
    <span
      className={className ? `shape-icon ${className}` : 'shape-icon'}
      style={{ width: size, height: size, '--shape-bg': bg, '--shape-fg': fg } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 1 1" width={size} height={size}>
        <g ref={groupRef}>
          <path ref={pathRef} d={shapePath(from.current)} />
        </g>
      </svg>
      <Icon name={icon} size={iconSize} filled={filled} />
    </span>
  );
}
