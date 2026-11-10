import { Dialog } from '@base-ui/react/dialog';
import { Menu } from '@base-ui/react/menu';
import { Switch } from '@base-ui/react/switch';
import { Toast } from '@base-ui/react/toast';
import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { SEED_PRESETS } from './theme/color';
import { colorsFor } from './features/wallpaper/Swatch';
import { loadExtendedFonts } from './theme/fonts';
import { warmMotionTokens } from './ui/motion';
import { warmShapes, type ShapeName } from './ui/ShapeIcon';
import { snack } from './ui/Snackbar';

// The first time something animates it pays for work the tenth doesn't: compiling menus and dialogs, building shape morphs, solving colours, reading motion tokens. Once the inbox is on screen, idle slices do it ahead.

type Task = () => void;

const idle = (fn: () => void) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout: 3_000 });
  // Safari has no requestIdleCallback; short timers leave the frames between free.
  else window.setTimeout(fn, 40);
};

function drain(tasks: Task[]) {
  idle(() => {
    const task = tasks.shift();
    try {
      task?.();
    } catch {
      // Best effort; the real thing still works cold.
    }
    if (tasks.length) drain(tasks);
  });
}

// Each view's shape (viewIdentity.ts).
const VIEW_SHAPES: ShapeName[] = ['Cookie9Sided', 'VerySunny', 'Clover8Leaf', 'Cookie4Sided', 'Sunny', 'Clover4Leaf', 'Cookie7Sided', 'Puffy', 'Circle', 'Flower', 'Cookie12Sided'];

function WarmToasts() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => (
    <Toast.Root key={t.id} toast={t}>
      <Toast.Content>
        <Toast.Title />
        <Toast.Action />
        <Toast.Close />
      </Toast.Content>
    </Toast.Root>
  ));
}

// Open popups still listen on the document while mounted. Without this, the first Esc or outside click of a busy load
// would close one of these and stop there, so the app's own shortcuts never saw it.
const passThrough = (_open: boolean, details: { cancel: () => void; allowPropagation: () => void }) => {
  details.cancel();
  details.allowPropagation();
};

/** Off the document, so their code is compiled before the first real one opens. The popups are never connected, never move focus, and let every key and press through. */
function warmPopups() {
  const host = document.createElement('div');
  const root = createRoot(host);
  const toasts = Toast.createToastManager();
  root.render(
    <>
      <Menu.Root open modal={false} onOpenChange={passThrough}>
        <Menu.Portal container={host}>
          <Menu.Positioner>
            <Menu.Popup finalFocus={false}>
              <Menu.Item>.</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Dialog.Root open modal={false} onOpenChange={passThrough}>
        <Dialog.Portal container={host}>
          <Dialog.Backdrop />
          <Dialog.Popup initialFocus={false} finalFocus={false}>
            <Dialog.Title>.</Dialog.Title>
            <Switch.Root>
              <Switch.Thumb />
            </Switch.Root>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      <Toast.Provider toastManager={toasts}>
        <Toast.Portal container={host}>
          <Toast.Viewport>
            <WarmToasts />
          </Toast.Viewport>
        </Toast.Portal>
      </Toast.Provider>
    </>,
  );
  idle(() => toasts.add({ title: '.', timeout: 0, actionProps: { children: '.' } }));
  idle(() => idle(() => root.unmount()));
}

/** Fetched during the warm-up so it opens at once. */
const preloads: Task[] = [];

/** Loaded on first use and fetched ahead in the warm-up; once in, it renders straight away instead of suspending a frame. */
export function preloadable<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> & { load: () => Promise<unknown> } {
  let ready: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  // A failed fetch isn't kept, so the next open tries again.
  const get = () =>
    (pending ??= load().then(
      (c) => (ready = c),
      (err: unknown) => {
        pending = null;
        throw new LoadError(err);
      },
    ));
  preloads.push(() => void get().catch(() => {}));
  function Preloaded(props: P) {
    // Fixed per mount: swapping in the loaded component would remount it. A new lazy each mount, as React keeps a failed one failed.
    const [C] = useState(() => ready ?? lazy(() => get().then((c) => ({ default: c }))));
    return (
      <LoadFailed>
        <C {...props} />
      </LoadFailed>
    );
  }
  /** For a caller that should wait for it rather than show a gap. */
  Preloaded.load = get;
  return Preloaded;
}

/** A component's code that didn't arrive, as opposed to one that threw while it rendered. */
class LoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

/** Code that didn't arrive (offline, or the extension updated under an open tab) leaves its part out and says so, instead of blanking the page. */
class LoadFailed extends Component<{ children: ReactNode }, { error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override componentDidCatch(error: unknown) {
    if (error instanceof LoadError) snack('Part of the app didn’t load. Reload Gmail and try again.');
  }
  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (error instanceof LoadError) return null;
    throw error;
  }
}

/** Then keeps them for their closing motion. */
export function OnFirstOpen({ open, children }: { open: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return seen || open ? <Suspense fallback={null}>{children}</Suspense> : null;
}

let started = false;

/** Once per page, after the first real paint. */
export function warmUp() {
  if (started || typeof window === 'undefined') return;
  started = true;
  drain([
    warmMotionTokens,
    warmPopups,
    () => void loadExtendedFonts(),
    ...warmShapes(VIEW_SHAPES, 'Cookie9Sided'),
    // The swatches in Quick settings solve a scheme each.
    ...SEED_PRESETS.map((p) => () => void colorsFor(p.seed)),
    ...preloads,
  ]);
}
