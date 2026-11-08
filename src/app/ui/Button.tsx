import { useCallback, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { SwapIcon, SwapText } from './feedback';
import { Icon, type IconName } from './Icon';
import { motionToken, reducedMotion } from './motion';
import { Ripple } from './Ripple';
import { Tooltip } from './Tooltip';
import { ariaShortcut } from './shortcut';

type Size = 'xs' | 's' | 'm';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated';
  size?: Size;
  shape?: 'round' | 'square';
  icon?: IconName;
  trailingIcon?: IconName;
  /** After an action (Copied): the icon turns to a check, the label swaps, the colour shifts. */
  confirmed?: boolean;
  confirmedLabel?: ReactNode;
  confirmedIcon?: IconName;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'filled',
  size = 's',
  shape = 'round',
  icon,
  trailingIcon,
  confirmed,
  confirmedLabel,
  confirmedIcon = 'check',
  className,
  children,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const confirmable = confirmed !== undefined;
  const iconSize = size === 'm' ? 24 : 20;
  return (
    <button
      ref={ref}
      type={type}
      className={cx('m3-button', `m3-button--${variant}`, `m3-size--${size}`, `m3-shape--${shape}`, className)}
      data-icon={icon ? '' : undefined}
      data-confirmed={confirmed || undefined}
      {...rest}
    >
      {icon &&
        (confirmable ? (
          <SwapIcon from={icon} to={confirmedIcon} on={!!confirmed} size={iconSize} />
        ) : (
          <Icon name={icon} size={iconSize} />
        ))}
      <span className="m3-button__label">
        {confirmable && confirmedLabel !== undefined ? <SwapText on={!!confirmed} idle={children} done={confirmedLabel} /> : children}
      </span>
      {trailingIcon && <Icon name={trailingIcon} size={size === 'm' ? 24 : 20} />}
      <Ripple disabled={rest.disabled} />
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Also the tooltip. */
  label: string;
  variant?: 'standard' | 'filled' | 'tonal' | 'outlined';
  size?: Size;
  width?: 'narrow' | 'default' | 'wide';
  /** Selected fills the glyph and changes shape. */
  selected?: boolean;
  filledIcon?: boolean;
  tooltip?: ReactNode | false;
  shortcut?: string;
  badge?: ReactNode;
  /** The glyph turns to a check on a tertiary container; the tooltip says `confirmedLabel`. */
  confirmed?: boolean;
  confirmedLabel?: string;
  confirmedIcon?: IconName;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  variant = 'standard',
  size = 's',
  width = 'default',
  selected,
  filledIcon,
  tooltip,
  shortcut,
  badge,
  confirmed,
  confirmedLabel,
  confirmedIcon = 'check',
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const local = useRef<HTMLButtonElement | null>(null);
  const setRef = useCallback(
    (el: HTMLButtonElement | null) => {
      local.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  useTogglePop(local, icon, selected);
  const iconSize = size === 'xs' ? 20 : 24;
  const button = (
    <button
      ref={setRef}
      type={type}
      aria-label={label}
      aria-keyshortcuts={ariaShortcut(shortcut)}
      aria-pressed={selected === undefined ? undefined : selected}
      className={cx(
        'm3-icon-button',
        `m3-icon-button--${variant}`,
        `m3-size--${size}`,
        `m3-width--${width}`,
        className,
      )}
      data-selected={selected || undefined}
      data-confirmed={confirmed || undefined}
      {...rest}
    >
      {confirmed === undefined ? (
        <Icon name={icon} size={iconSize} filled={filledIcon ?? selected} />
      ) : (
        <SwapIcon from={icon} to={confirmedIcon} on={confirmed} size={iconSize} filled={filledIcon ?? selected} />
      )}
      {badge}
      <Ripple disabled={rest.disabled} />
    </button>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={confirmed && confirmedLabel ? confirmedLabel : (tooltip ?? label)}>
      {button}
    </Tooltip>
  );
}

export interface FabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  label?: string;
  /** Collapsed keeps the same position and shrinks. */
  extended?: boolean;
  size?: 's' | 'm' | 'l';
  color?: 'primary-container' | 'secondary-container' | 'tertiary-container' | 'primary' | 'surface';
  lowered?: boolean;
  /** As on Gmail's M3 Expressive Compose button. */
  filledIcon?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function Fab({
  icon,
  label,
  extended = true,
  size = 's',
  color = 'primary-container',
  lowered,
  filledIcon,
  className,
  type = 'button',
  ref,
  ...rest
}: FabProps) {
  const fab = (
    <button
      ref={ref}
      type={type}
      aria-label={extended ? undefined : label}
      className={cx('m3-fab', `m3-fab--${size}`, `m3-fab--${color}`, className)}
      data-extended={extended || undefined}
      data-lowered={lowered || undefined}
      {...rest}
    >
      <Icon name={icon} size={size === 's' ? 24 : size === 'm' ? 28 : 32} filled={filledIcon} />
      {label && (
        <span className="m3-fab__label" aria-hidden={!extended}>
          <span className="m3-fab__label-text">{label}</span>
        </span>
      )}
      <Ripple disabled={rest.disabled} />
    </button>
  );
  if (!label) return fab;
  // Always wrapped, so toggling `extended` keeps the button and its width can animate.
  return (
    <Tooltip content={label} disabled={extended}>
      {fab}
    </Tooltip>
  );
}

/** Selecting pops the glyph on FastSpatial (a star also turns one point, landing on the same shape); deselecting dips less. Never on first render. */
function useTogglePop(ref: { current: HTMLElement | null }, icon: IconName, selected: boolean | undefined) {
  const was = useRef(selected);
  useLayoutEffect(() => {
    if (was.current === selected) return;
    const before = was.current;
    was.current = selected;
    const glyph = ref.current?.querySelector<HTMLElement>('.m3-icon');
    if (before === undefined || selected === undefined || !glyph || reducedMotion()) return;
    glyph.getAnimations().forEach((a) => a.cancel());
    if (selected) {
      const turn = icon === 'star' ? -72 : 0;
      glyph.animate(
        [{ transform: `scale(0.5) rotate(${turn}deg)` }, { transform: 'none' }],
        motionToken('--md-sys-motion-spatial-fast'),
      );
    } else {
      glyph.animate([{ transform: 'scale(0.8)' }, { transform: 'none' }], motionToken('--md-sys-motion-spatial-fast'));
    }
  }, [selected, icon, ref]);
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}
