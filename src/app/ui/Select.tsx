import { Select as BaseSelect } from '@base-ui/react/select';
import { Icon } from './Icon';
import { cx } from './Button';

interface SelectProps<T extends string | number> {
  value: T;
  onChange: (value: T) => void;
  options: [T, string][];
  label: string;
  className?: string;
  /** Inside the field; omit for a compact control. */
  fieldLabel?: string;
  /** Scrolling if short of room, like an exposed dropdown in a form. */
  below?: boolean;
  /** A control at the end of a settings row opens toward the row. */
  align?: 'start' | 'end';
}

/** M3 outlined dropdown on Base UI Select. */
export function Select<T extends string | number>({ value, onChange, options, label, className, fieldLabel, below, align = 'start' }: SelectProps<T>) {
  return (
    <BaseSelect.Root value={value} onValueChange={(v) => v !== null && onChange(v as T)} items={options.map(([v, l]) => ({ value: v, label: l }))}>
      <BaseSelect.Trigger className={cx('m3-select-field', fieldLabel && 'm3-select-field--labelled', className)} aria-label={label}>
        {fieldLabel && <span className="m3-select-field__label">{fieldLabel}</span>}
        <BaseSelect.Value className="m3-select-field__value" />
        <BaseSelect.Icon className="m3-select-field__icon">
          <Icon name="arrow_drop_down" size={24} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="m3-menu-positioner"
          sideOffset={4}
          align={align}
          alignItemWithTrigger={false}
          collisionPadding={8}
          collisionAvoidance={below ? { side: 'none', align: 'shift' } : undefined}
        >
          <BaseSelect.Popup className="m3-menu m3-select-popup">
            <div className="m3-menu-section" role="presentation">
              {options.map(([v, l]) => (
                <BaseSelect.Item key={String(v)} value={v} className="m3-menu-item">
                  <span className="m3-menu-lead">
                    <Icon name="check" size={20} className="m3-menu-lead__check" />
                  </span>
                  <BaseSelect.ItemText className="m3-menu-item__text">{l}</BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </div>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
