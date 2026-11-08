import type { BackendError } from '../../data/backend';
import { classicGmail } from '../../lib/host';
import { updateSettings } from '../../state/settings';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { Diagnostics } from '../../ui/Diagnostics';

export function BootScreen({ error, onRetry }: { error?: BackendError; onRetry: () => void }) {
  if (!error) {
    return (
      <div className="boot" aria-busy="true">
        <LoadingIndicator size={64} label="Loading Gmail" />
      </div>
    );
  }
  const session = error.code === 'session-unavailable' || error.code === 'unauthenticated';
  return (
    <div className="boot" role="alert">
      <div className="boot__card">
        <span className="boot__badge">
          <Icon name={session ? 'sync_problem' : 'cloud_off'} size={32} />
        </span>
        <h1 className="md-headline-small boot__title">{session ? "Couldn't connect to Gmail" : 'Something went wrong'}</h1>
        <p className="md-body-medium boot__text">{error.message}</p>
        <Diagnostics />
        <div className="boot__actions">
          <Button variant="filled" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="text" onClick={() => classicGmail()}>
            Use classic Gmail
          </Button>
          {session && import.meta.env.DEV && (
            <Button variant="text" onClick={() => updateSettings({ backend: 'demo' })}>
              Explore the demo
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
