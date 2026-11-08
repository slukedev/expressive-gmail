import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './Button';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  variant?: 'outlined' | 'filled';
  leadingIcon?: IconName;
  trailing?: ReactNode;
  supporting?: ReactNode;
  error?: string;
  multiline?: false;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({
  label,
  variant = 'outlined',
  leadingIcon,
  trailing,
  supporting,
  error,
  className,
  id,
  ref,
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const supportId = `${inputId}-support`;
  return (
    <div className={cx('m3-field', `m3-field--${variant}`, error && 'm3-field--error', className)}>
      <div className="m3-field__container" data-has-leading={leadingIcon ? '' : undefined}>
        {leadingIcon && <Icon name={leadingIcon} className="m3-field__leading" />}
        <input
          ref={ref}
          id={inputId}
          className="m3-field__input"
          placeholder=" "
          aria-invalid={error ? true : undefined}
          aria-describedby={supporting || error ? supportId : undefined}
          {...rest}
        />
        <label htmlFor={inputId} className="m3-field__label">
          {label}
        </label>
        {trailing && <span className="m3-field__trailing">{trailing}</span>}
        {variant === 'outlined' && <span className="m3-field__outline" aria-hidden="true" />}
      </div>
      {(supporting || error) && (
        <div id={supportId} className="m3-field__supporting">
          {error ?? supporting}
        </div>
      )}
    </div>
  );
}
