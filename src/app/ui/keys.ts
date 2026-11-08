/** Apple keyboards say ⌘ where others say Ctrl. Shortcuts accept either key everywhere. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "Ctrl K" reads "⌘K" on a Mac; "⌘⇧8" reads "Ctrl+Shift+8" elsewhere. */
export function keyLabel(shortcut: string, mac = IS_MAC): string {
  if (mac) return shortcut.replace(/\bCtrl\b\s*/g, '⌘').replace(/⌘Shift\s+/g, '⌘⇧');
  return shortcut.replace(/⌘/g, 'Ctrl+').replace(/⇧/g, 'Shift+');
}
