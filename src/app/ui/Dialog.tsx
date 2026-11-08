import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './Button';

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  icon?: IconName;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  size?: 'basic' | 'medium' | 'large' | 'full';
  /** For larger dialogs. */
  closable?: boolean;
  initialFocus?: React.RefObject<HTMLElement | null>;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  icon,
  description,
  children,
  actions,
  className,
  size = 'basic',
  closable,
  initialFocus,
}: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(o) => onOpenChange(o)}>
      <BaseDialog.Portal>
        {/* Base UI leaves out a nested dialog's backdrop; every modal here gets its scrim. */}
        <BaseDialog.Backdrop className="m3-scrim" forceRender />
        <BaseDialog.Popup
          className={cx('m3-dialog', `m3-dialog--${size}`, icon && 'm3-dialog--with-icon', className)}
          initialFocus={initialFocus}
        >
          {(title || closable) && (
            <header className="m3-dialog__header">
              {icon && <Icon name={icon} size={24} className="m3-dialog__icon" />}
              {title && <BaseDialog.Title className="m3-dialog__title md-headline-small">{title}</BaseDialog.Title>}
              {closable && (
                <BaseDialog.Close className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--default m3-dialog__close" aria-label="Close">
                  <Icon name="close" />
                </BaseDialog.Close>
              )}
            </header>
          )}
          {description && (
            <BaseDialog.Description className="m3-dialog__description md-body-medium">{description}</BaseDialog.Description>
          )}
          {children && <div className="m3-dialog__content">{children}</div>}
          {actions && <footer className="m3-dialog__actions">{actions}</footer>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
