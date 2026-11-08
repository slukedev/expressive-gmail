import { MaterialShapes, roundedPolygonToPath } from 'material-shapes-ts';
import { useMemo } from 'react';
import { Icon } from '../../ui/Icon';

/** An M3 Expressive cookie shape holding the mail glyph. Not Google's logo. */
export function BrandMark({ size = 40 }: { size?: number }) {
  const d = useMemo(() => roundedPolygonToPath(MaterialShapes.Cookie9Sided).toSvgPathData(), []);
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 1 1" width={size} height={size}>
        <path d={d} />
      </svg>
      <Icon name="mail" size={size >= 40 ? 20 : 18} filled />
    </span>
  );
}
