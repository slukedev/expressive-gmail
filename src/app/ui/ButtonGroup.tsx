import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { Ripple } from './Ripple';
import { cx } from './Button';
import { SwapIcon } from './feedback';

/** Single select. Outer corners stay round, inner ones small, the selected segment morphs to a pill. */
export function ConnectedButtonGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 's',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: IconName }[];
  label: string;
  size?: 'xs' | 's' | 'm';
}) {
  return (
    <div className={cx('button-group', `m3-size--${size}`)} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className="button-group__item"
            data-selected={selected || undefined}
            onClick={() => onChange(o.value)}
          >
            {o.icon ? (
              <SwapIcon from={o.icon} to="check" on={selected} size={20} className="button-group__lead" />
            ) : (
              <span className="button-group__lead button-group__lead--grow" aria-hidden="true">
                <Icon name="check" size={20} />
              </span>
            )}
            <span>{o.label}</span>
            <Ripple />
          </button>
        );
      })}
    </div>
  );
}
