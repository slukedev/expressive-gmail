import { useLayoutEffect, useRef } from 'react';
import { Toast } from '@base-ui/react/toast';
import { Icon } from './Icon';
import { LoadingIndicator } from './LoadingIndicator';
import { motionToken } from './motion';

export const snackbarManager = Toast.createToastManager();

type SnackState = 'loading' | 'error';

interface SnackOptions {
  action?: { label: string; onClick: () => void };
  /** Ms; 0 keeps it until dismissed. */
  timeout?: number;
  id?: string;
  priority?: 'low' | 'high';
  /** Loading stays until it's finished; error looks like one and is announced at once. */
  state?: SnackState;
}

function parts(options: SnackOptions, id: () => string) {
  const { action, state } = options;
  return {
    type: state,
    timeout: state === 'loading' ? 0 : (options.timeout ?? (action ? 8000 : state === 'error' ? 8000 : 5000)),
    priority: options.priority ?? (state === 'error' ? 'high' : 'low'),
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            action.onClick();
            // M3: acting on a snackbar dismisses it.
            snackbarManager.close(id());
          },
        }
      : undefined,
  } as const;
}

/** Returns its id so callers can update or close it. */
export function snack(message: string, options: SnackOptions = {}) {
  const id: string = snackbarManager.add({ id: options.id, title: message, ...parts(options, () => id) });
  return id;
}

/** A snackbar that stays while something runs, then turns into its result in place. */
export function snackProgress(message: string, options: Pick<SnackOptions, 'id'> = {}) {
  const id = snack(message, { ...options, state: 'loading' });
  const settle = (text: string, next: SnackOptions) => snackbarManager.update(id, { title: text, ...parts(next, () => id) });
  return {
    id,
    done: (text: string, next: Omit<SnackOptions, 'state'> = {}) => settle(text, next),
    fail: (text: string, next: Omit<SnackOptions, 'state'> = {}) => settle(text, { ...next, state: 'error' }),
    /** Finished with nothing to say. */
    close: () => snackbarManager.close(id),
  };
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
  return toasts.map((toast) => <SnackbarItem key={toast.id} toast={toast} />);
}

/**
 * A snackbar that changes while it's showing (loading to done, done to failed)
 * grows or shrinks to its new width instead of snapping, and its words fade
 * over each other.
 */
function SnackbarItem({ toast }: { toast: ReturnType<typeof Toast.useToastManager>['toasts'][number] }) {
  const root = useRef<HTMLDivElement>(null);
  const width = useRef<number | null>(null);
  const hasAction = !!toast.actionProps;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const prev = width.current;
    const next = el.offsetWidth;
    width.current = next;
    if (prev === null || Math.abs(prev - next) < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const { duration, easing } = motionToken('--md-sys-motion-spatial-fast');
    el.style.overflow = 'hidden';
    const run = el.animate({ width: [`${prev}px`, `${next}px`] }, { duration, easing });
    const clear = () => el.style.removeProperty('overflow');
    run.onfinish = clear;
    run.oncancel = clear;
  }, [toast.title, toast.type, hasAction]);

  return (
    <Toast.Root ref={root} toast={toast} className="m3-snackbar" data-state={toast.type} swipeDirection={['down', 'left', 'right']}>
      <Toast.Content className="m3-snackbar__content">
        {toast.type === 'loading' && <LoadingIndicator size={24} label="Working" className="m3-snackbar__lead" />}
        {toast.type === 'error' && <Icon name="error" size={20} className="m3-snackbar__lead m3-snackbar__lead--error" />}
        <Toast.Title key={String(toast.title)} className="m3-snackbar__text" />
        {hasAction && <Toast.Action className="m3-snackbar__action" />}
        <Toast.Close className="m3-snackbar__close" aria-label="Dismiss">
          <Icon name="close" size={20} />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  );
}
