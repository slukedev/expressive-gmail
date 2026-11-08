import { installMainHooks } from '../session/main-hooks';

/** Safari's way into the main world: injected as a script tag by gmail.content.ts. */
export default defineUnlistedScript({
  include: ['safari'],
  main() {
    try {
      installMainHooks();
    } catch {
      // Never let token capture take Gmail down.
    }
  },
});
