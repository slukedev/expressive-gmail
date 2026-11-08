import { MaterialShapes, roundedPolygonToPath, type RoundedPolygon } from 'material-shapes-ts';
import { useMemo, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

const SHAPES: (() => RoundedPolygon)[] = [
  () => MaterialShapes.Cookie12Sided,
  () => MaterialShapes.Clover4Leaf,
  () => MaterialShapes.Sunny,
  () => MaterialShapes.Cookie7Sided,
  () => MaterialShapes.SoftBurst,
];

/** A large tonal shape holding the icon, or `mark` in its place (the icon still picks the shape). */
export function EmptyArt({ icon, tone = 'primary', size = 128, mark }: { icon: IconName; tone?: 'primary' | 'error' | 'tertiary'; size?: number; mark?: ReactNode }) {
  const d = useMemo(() => {
    let h = 0;
    for (const c of icon) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return roundedPolygonToPath(SHAPES[h % SHAPES.length]()).toSvgPathData();
  }, [icon]);
  return (
    <span className={`empty-art empty-art--${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 1 1" width={size} height={size}>
        <path d={d} />
      </svg>
      {mark ? <span className="empty-art__mark">{mark}</span> : <Icon name={icon} size={48} />}
    </span>
  );
}
