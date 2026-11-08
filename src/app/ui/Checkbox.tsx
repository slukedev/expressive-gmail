import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Icon } from './Icon';

interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean, event: Event) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** 18px box, 2px radius, 40px target with a round state layer. */
export function Checkbox({ checked, indeterminate, onCheckedChange, label, disabled, className }: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      className={className ? `m3-checkbox ${className}` : 'm3-checkbox'}
      checked={checked}
      indeterminate={indeterminate}
      onCheckedChange={(c, details) => onCheckedChange(c, details.event)}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="m3-checkbox__box">
        <BaseCheckbox.Indicator className="m3-checkbox__indicator" keepMounted>
          <Icon name={indeterminate ? 'remove' : 'check'} size={18} weight={500} />
        </BaseCheckbox.Indicator>
      </span>
    </BaseCheckbox.Root>
  );
}
