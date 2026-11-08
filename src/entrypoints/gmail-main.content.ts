import { installMainHooks } from '../session/main-hooks';

/** Copies what Gmail's JS uses to call its sync API to the isolated-world backend. Safari injects gmail-main-safari.js instead. */
export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  // Hidden Gmail frames for other accounts need their own token capture.
  allFrames: true,
  include: ['chrome', 'firefox', 'edge'],
  main() {
    try {
      installMainHooks();
    } catch {
      // Never let token capture take Gmail down.
    }
  },
});
