import { Menu as BaseMenu } from '@base-ui/react/menu';
import { Children, Fragment, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './Button';
import { ariaShortcut } from './shortcut';

/** M3 Expressive menu (Menu.kt, SegmentedMenuTokens): each section is its own surface, 2px from the next; a MenuSeparator starts a section instead of drawing a rule. */
export function Menu({
  trigger,
  children,
  side = 'bottom',
  align = 'start',
  open,
  onOpenChange,
  className,
  modal = false,
}: {
  trigger?: ReactElement<Record<string, unknown>>;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  modal?: boolean;
}) {
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      {trigger && <BaseMenu.Trigger render={trigger} />}
      <MenuPopup side={side} align={align} className={className}>
        {children}
      </MenuPopup>
    </BaseMenu.Root>
  );
}

export function MenuPopup({
  side = 'bottom',
  align = 'start',
  className,
  children,
  sideOffset = 4,
}: {
  side?: 'top' | 'bottom' | 'left' | 'right' | 'inline-end' | 'inline-start';
  align?: 'start' | 'center' | 'end';
  className?: string;
  children: ReactNode;
  sideOffset?: number;
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset} className="m3-menu-positioner" collisionPadding={8}>
        <BaseMenu.Popup className={cx('m3-menu', className)}>
          <MenuSections>{children}</MenuSections>
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) out.push(...flatten(child.props.children));
    else if (child !== null && child !== undefined && child !== false && child !== true) out.push(child);
  });
  return out;
}

/** Each MenuSeparator starts a new section surface. */
export function MenuSections({ children }: { children: ReactNode }) {
  const sections: ReactNode[][] = [[]];
  for (const child of flatten(children)) {
    if (isValidElement(child) && child.type === MenuSeparator) sections.push([]);
    else sections[sections.length - 1].push(child);
  }
  const filled = sections.filter((s) => s.length);
  return filled.map((items, i) => (
    <div key={i} className="m3-menu-section" role="presentation">
      {items}
    </div>
  ));
}

interface ItemProps extends Omit<ComponentProps<typeof BaseMenu.Item>, 'children' | 'className'> {
  className?: string;
  icon?: IconName;
  children: ReactNode;
  trailing?: ReactNode;
  shortcut?: string;
  supporting?: ReactNode;
  danger?: boolean;
}

export function MenuItem({ icon, children, trailing, shortcut, supporting, danger, className, ...rest }: ItemProps) {
  return (
    <BaseMenu.Item className={cx('m3-menu-item', danger && 'm3-menu-item--danger', className)} aria-keyshortcuts={ariaShortcut(shortcut)} {...rest}>
      {icon && <Icon name={icon} size={20} className="m3-menu-item__icon" />}
      <span className="m3-menu-item__text">
        <span className="m3-menu-item__label">{children}</span>
        {supporting && <span className="m3-menu-item__supporting">{supporting}</span>}
      </span>
      {trailing}
    </BaseMenu.Item>
  );
}

export function MenuCheckboxItem({
  icon,
  children,
  checked,
  onCheckedChange,
  closeOnClick = false,
  color,
}: {
  icon?: IconName;
  children: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  closeOnClick?: boolean;
  color?: string;
}) {
  return (
    <BaseMenu.CheckboxItem
      className="m3-menu-item"
      checked={checked}
      onCheckedChange={onCheckedChange}
      closeOnClick={closeOnClick}
    >
      <span className="m3-menu-lead" data-checked={checked || undefined} data-has-icon={icon ? '' : undefined}>
        {icon && <Icon name={icon} size={20} className="m3-menu-item__icon m3-menu-lead__icon" style={color ? { color } : undefined} />}
        <Icon name="check" size={20} className="m3-menu-lead__check" />
      </span>
      <span className="m3-menu-item__text">
        <span className="m3-menu-item__label">{children}</span>
      </span>
    </BaseMenu.CheckboxItem>
  );
}

export function MenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <BaseMenu.RadioGroup value={value} onValueChange={(v) => onValueChange(v as string)}>
      {children}
    </BaseMenu.RadioGroup>
  );
}

export function MenuRadioItem({ value, children, icon }: { value: string; children: ReactNode; icon?: IconName }) {
  return (
    <BaseMenu.RadioItem className="m3-menu-item" value={value} closeOnClick>
      <span className="m3-menu-lead" data-has-icon={icon ? '' : undefined}>
        {icon && <Icon name={icon} size={20} className="m3-menu-item__icon m3-menu-lead__icon" />}
        <Icon name="check" size={20} className="m3-menu-lead__check" />
      </span>
      <span className="m3-menu-item__text">
        <span className="m3-menu-item__label">{children}</span>
      </span>
    </BaseMenu.RadioItem>
  );
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="m3-menu-separator" />;
}

/** Plain text so it works with or without a group. */
export function MenuGroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="m3-menu-group-label" role="presentation">
      {children}
    </div>
  );
}

export function Submenu({ icon, label, children }: { icon?: IconName; label: ReactNode; children: ReactNode }) {
  return (
    <BaseMenu.SubmenuRoot>
      <BaseMenu.SubmenuTrigger className="m3-menu-item">
        {icon && <Icon name={icon} size={20} className="m3-menu-item__icon" />}
        <span className="m3-menu-item__text">
          <span className="m3-menu-item__label">{label}</span>
        </span>
        <Icon name="chevron_right" size={20} className="m3-menu-item__trailing-icon" />
      </BaseMenu.SubmenuTrigger>
      <MenuPopup side="inline-end" align="start" sideOffset={-4}>
        {children}
      </MenuPopup>
    </BaseMenu.SubmenuRoot>
  );
}
