import { Component, useEffect, type ReactNode } from 'react';
import { Button } from './Button';
import { EmptyArt } from './EmptyArt';
import { Icon } from './Icon';
import { snack } from './Snackbar';

interface Props {
  children: ReactNode;
  fallback: (retry: () => void) => ReactNode;
  /** A new value clears a failure, so moving on to another view or conversation tries again. */
  resetKey?: unknown;
}

interface State {
  failed: boolean;
  resetKey: unknown;
}

/** Keeps a render error inside one part of the app. Errors are logged by the root's onCaughtError (main.tsx). */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return Object.is(props.resetKey, state.resetKey) ? null : { failed: false, resetKey: props.resetKey };
  }

  private retry = () => this.setState({ failed: false });

  override render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

/** Fills the place of a whole pane or page. */
export function RegionFailed({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className="empty" role="alert">
      <EmptyArt icon="error" tone="error" />
      <h2 className="md-title-large empty__title">{title}</h2>
      <Button variant="tonal" icon="refresh" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Stands in for one item (a message, a row) so the ones around it stay. */
export function ItemFailed({ text, onRetry, role }: { text: string; onRetry: () => void; role?: 'listitem' }) {
  return (
    <div className="list-notice" role={role}>
      <Icon name="error" size={20} className="list-notice__icon" />
      <p className="md-body-medium list-notice__text" role="alert">
        {text}
      </p>
      <Button variant="text" size="s" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** The whole app: reloading is the one thing sure to help. */
export function AppFailed() {
  return (
    <div className="boot" role="alert">
      <div className="boot__card">
        <span className="boot__badge">
          <Icon name="error" size={32} />
        </span>
        <h1 className="md-headline-small boot__title">Gmail stopped working</h1>
        <p className="md-body-medium boot__text">Reload to start it again.</p>
        <div className="boot__actions">
          <Button variant="filled" icon="refresh" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A popup that fails closes and says so; `openKey` changing (it closed, or opened again) tries it again. */
export function OverlayBoundary({ name, openKey, onFail, children }: { name: string; openKey: unknown; onFail?: () => void; children: ReactNode }) {
  return (
    <ErrorBoundary resetKey={openKey} fallback={() => <OverlayFailed name={name} onFail={onFail} />}>
      {children}
    </ErrorBoundary>
  );
}

function OverlayFailed({ name, onFail }: { name: string; onFail?: () => void }) {
  useEffect(() => {
    snack(`${name} couldn't open. Try again.`);
    onFail?.();
  }, [name, onFail]);
  return null;
}
