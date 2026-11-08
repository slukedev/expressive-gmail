import { useSyncExternalStore } from 'react';
import { useSettingsStore } from '../state/settings';
import { homeView, parseHash, routeToHash, type Route, type View } from './routes';

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

let cachedHash = '';
let cachedRoute: Route = parseHash('');
function snapshot(): Route {
  if (window.location.hash !== cachedHash) {
    cachedHash = window.location.hash;
    const next = parseHash(cachedHash);
    // Opening a thread keeps the view: reuse its object so memoized rows don't re-render.
    if (JSON.stringify(next.view) === JSON.stringify(cachedRoute.view)) next.view = cachedRoute.view;
    cachedRoute = next;
  }
  return cachedRoute;
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function getRoute(): Route {
  return snapshot();
}

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const hash = routeToHash(route);
  if (hash === window.location.hash) return;
  if (opts.replace) {
    history.replaceState(history.state, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
  if (window.parent !== window) {
    window.parent.postMessage({ source: 'better-gmail/app', type: 'route', hash }, 'https://mail.google.com');
  }
}

export function openView(view: View) {
  navigate({ view });
}

/** Or All mail when that's where Gmail starts. */
export function openHome() {
  navigate({ view: homeView(useSettingsStore.getState().settings.startView) });
}

const STARTED_KEY = 'bg.started';

/** Only a new tab landing on the inbox moves to All mail; a reload or a link elsewhere stays. */
export function applyStartView() {
  let fresh = true;
  try {
    fresh = !sessionStorage.getItem(STARTED_KEY);
    sessionStorage.setItem(STARTED_KEY, '1');
  } catch {
    // No per-tab memory: treat every load as new.
  }
  const start = useSettingsStore.getState().settings.startView;
  const route = getRoute();
  if (!fresh || start === 'inbox' || route.threadId || route.settings) return;
  if (route.view.kind === 'folder' && route.view.folder === 'inbox') navigate({ view: homeView(start) }, { replace: true });
}

export function openThread(threadId: string, view = getRoute().view) {
  navigate({ view, threadId });
}

export function closeThread() {
  const r = getRoute();
  navigate({ view: r.view });
}
