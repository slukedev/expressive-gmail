import type { CSSProperties } from 'react';
import { ICONS, type IconName } from './icon-codepoints';

export type { IconName };

interface IconProps {
  name: IconName;
  /** Animates between outline and fill like Google's selected states. */
  filled?: boolean;
  size?: 14 | 16 | 18 | 20 | 22 | 24 | 28 | 32 | 36 | 40 | 48;
  weight?: 300 | 400 | 500 | 600;
  className?: string;
  style?: CSSProperties;
}

export function Icon({ name, filled = false, size = 24, weight = 400, className, style }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={className ? `m3-icon ${className}` : 'm3-icon'}
      data-filled={filled || undefined}
      style={{ '--icon-size': `${size}px`, '--icon-wght': weight, ...style } as CSSProperties}
    >
      {String.fromCodePoint(ICONS[name])}
    </span>
  );
}
