/** Editors with typing that hasn't reached their draft yet (see Editor's TYPING_SETTLE_MS). */
export const unsettled = new Set<() => void>();

/** Before anything reads a draft's html: puts what was just typed in. */
export function flushEditors() {
  for (const flush of [...unsettled]) flush();
}
