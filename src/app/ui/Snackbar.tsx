import { Toast } from '@base-ui/react/toast';
import { Icon } from './Icon';

export const snackbarManager = Toast.createToastManager();

interface SnackOptions {
  action?: { label: string; onClick: () => void };
  /** Ms; 0 keeps it until dismissed. */
  timeout?: number;
  id?: string;
  priority?: 'low' | 'high';
}

/** Returns its id so callers can update or close it. */
export function snack(message: string, options: SnackOptions = {}) {
  // M3: acting on a snackbar dismisses it.
  const id: string = snackbarManager.add({
    id: options.id,
    title: message,
    timeout: options.timeout ?? (options.action ? 8000 : 5000),
    priority: options.priority ?? 'low',
    actionProps: options.action
      ? {
          children: options.action.label,
          onClick: () => {
            options.action!.onClick();
            snackbarManager.close(id);
          },
        }
      : undefined,
  });
  return id;
}

export function SnackbarHost() {
  return (
    <Toast.Provider toastManager={snackbarManager} limit={1}>
      <Toast.Portal>
        <Toast.Viewport className="m3-snackbar-viewport">
          <SnackbarList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function SnackbarList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root key={toast.id} toast={toast} className="m3-snackbar" swipeDirection={['down', 'left', 'right']}>
      <Toast.Content className="m3-snackbar__content">
        <Toast.Title className="m3-snackbar__text" />
        {toast.actionProps && <Toast.Action className="m3-snackbar__action" />}
        <Toast.Close className="m3-snackbar__close" aria-label="Dismiss">
          <Icon name="close" size={20} />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ));
}
