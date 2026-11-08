import { useSyncExternalStore } from 'react';
import { Icon } from '../../ui/Icon';

function subscribe(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/** A standing snackbar while the browser is offline. */
export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  if (online) return null;
  return (
    <div className="offline" role="status">
      <Icon name="cloud_off" size={20} />
      <span className="md-body-medium">You're offline. You can still read mail that's already loaded.</span>
    </div>
  );
}
