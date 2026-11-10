// Frames the preview the way gmail.content.ts frames the app, so features the
// host page provides (Interface size) can be tried and tested without Gmail.
import { FRAME_STYLE } from '../src/shared/frame';
import { applyFrameScale, readHostUiScale, serveFrameScale } from '../src/shared/uiScale';

const frame = document.createElement('iframe');
frame.src = `/${location.search}${location.hash}`;
frame.title = 'Gmail';
frame.style.cssText = FRAME_STYLE;
applyFrameScale(frame, readHostUiScale());
// Like the content script's host: clipped, not hidden, so focus inside the scaled frame can't scroll it.
const host = document.createElement('div');
host.style.cssText = 'position:fixed;inset:0;overflow:clip';
host.append(frame);
document.body.append(host);

window.addEventListener('message', (e) => {
  const d = e.data as { source?: string; type?: string; scale?: unknown };
  if (e.source !== frame.contentWindow || d?.source !== 'better-gmail/app') return;
  if (d.type === 'scale') serveFrameScale(frame, d.scale);
});

// The installed app's host side (src/shared/pwa-host.ts), faked: `?app=install` offers to install,
// `?app=standalone` runs as the installed app. Tests drive launches through window.__launch.
const appFlag = new URLSearchParams(location.search).get('app');
if (appFlag) {
  const w = window as unknown as { __launch?: (launch: unknown) => void; __appBadge?: unknown; __appCalls?: string[] };
  const state = { installable: appFlag === 'install', standalone: appFlag === 'standalone', badge: true, mailto: true };
  w.__appCalls = [];
  const send = (message: Record<string, unknown>) => frame.contentWindow?.postMessage({ source: 'better-gmail/content', ...message }, location.origin);
  w.__launch = (launch) => send({ type: 'launch', launch });
  window.addEventListener('message', (e) => {
    const d = e.data as { source?: string; type?: string; value?: unknown };
    if (e.source !== frame.contentWindow || d?.source !== 'better-gmail/app' || !d.type?.startsWith('app-')) return;
    w.__appCalls!.push(d.type);
    if (d.type === 'app-hello') send({ type: 'app-state', state });
    if (d.type === 'app-badge') w.__appBadge = d.value;
    if (d.type === 'app-mailto') send({ type: 'app-mailto-result', ok: true });
    if (d.type === 'app-install') {
      state.installable = false;
      send({ type: 'app-install-result', outcome: 'accepted' });
      send({ type: 'app-state', state });
    }
  });
}
