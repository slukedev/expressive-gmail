import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Icon, type IconName } from './Icon';
import { Ripple } from './Ripple';
import { cx } from './Button';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  kind?: 'assist' | 'filter' | 'input' | 'suggestion';
  icon?: IconName;
  selected?: boolean;
  /** For filter chips that open a menu. */
  dropdown?: boolean;
  elevated?: boolean;
  onRemove?: () => void;
  removeLabel?: string;
  avatar?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Chip({
  kind = 'assist',
  icon,
  selected,
  dropdown,
  elevated,
  onRemove,
  removeLabel,
  avatar,
  className,
  children,
  type = 'button',
  ref,
  ...rest
}: ChipProps) {
  // Always rendered for plain filter chips so the check can grow in and out.
  const checkable = kind === 'filter' && !icon && !dropdown && !avatar;
  return (
    <span className={cx('m3-chip-wrap', onRemove && 'm3-chip-wrap--removable')}>
      <button
        ref={ref}
        type={type}
        className={cx('m3-chip', `m3-chip--${kind}`, elevated && 'm3-chip--elevated', className)}
        data-selected={selected || undefined}
        aria-pressed={kind === 'filter' && !dropdown ? !!selected : undefined}
        data-has-leading={icon || checkable || avatar ? '' : undefined}
        data-has-trailing={dropdown || onRemove ? '' : undefined}
        {...rest}
      >
        {avatar}
        {checkable && <Icon name="check" size={18} className="m3-chip__leading m3-chip__check" />}
        {icon && <Icon name={icon} size={18} className="m3-chip__leading" />}
        <span className="m3-chip__label">{children}</span>
        {dropdown && <Icon name="arrow_drop_down" size={18} className="m3-chip__trailing" />}
        <Ripple disabled={rest.disabled} />
      </button>
      {onRemove && (
        <button type="button" className="m3-chip__remove" aria-label={removeLabel ?? 'Remove'} onClick={onRemove}>
          <Icon name="close" size={18} />
        </button>
      )}
    </span>
  );
}
