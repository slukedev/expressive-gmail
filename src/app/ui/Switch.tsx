import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { Icon } from './Icon';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/** With the check icon in the selected handle. */
export function Switch({ checked, onCheckedChange, label, ...rest }: SwitchProps) {
  return (
    <BaseSwitch.Root
      className="m3-switch"
      checked={checked}
      onCheckedChange={(c) => onCheckedChange(c)}
      aria-label={label}
      {...rest}
    >
      <BaseSwitch.Thumb className="m3-switch__thumb">
        <Icon name={checked ? 'check' : 'close'} size={16} weight={500} className="m3-switch__icon" />
      </BaseSwitch.Thumb>
    </BaseSwitch.Root>
  );
}
