// Frames the preview the way gmail.content.ts frames the app, so features the
// host page provides (Interface size) can be tried and tested without Gmail.
import { FRAME_STYLE } from '../src/shared/frame';
import { applyFrameScale, readHostUiScale, serveFrameScale } from '../src/shared/uiScale';

const frame = document.createElement('iframe');
frame.src = `/${location.search}${location.hash}`;
frame.title = 'Gmail';
frame.style.cssText = FRAME_STYLE;
applyFrameScale(frame, readHostUiScale());
document.body.append(frame);

window.addEventListener('message', (e) => {
  const d = e.data as { source?: string; type?: string; scale?: unknown };
  if (e.source !== frame.contentWindow || d?.source !== 'better-gmail/app') return;
  if (d.type === 'scale') serveFrameScale(frame, d.scale, location.origin);
});
