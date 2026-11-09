import { reboundShortcut } from '../features/shortcuts/bindings';
import { useSettingsStore } from '../state/settings';
import { IS_MAC } from './keys';

/** A hint written in Gmail's default keys ("e", "Shift U"), in the keys this person chose. Read when drawn; keys change rarely and every hint re-renders with its screen. */
export function currentShortcut(shortcut: string | undefined): string | undefined {
  return shortcut && reboundShortcut(shortcut, useSettingsStore.getState().settings.shortcutKeys);
}

/** Shortcuts aren't drawn on tooltips or menus (Google's UI doesn't), but assistive tech hears them. Sequences like "g 1" can't be expressed. */
export function ariaShortcut(shortcut: string | undefined): string | undefined {
  shortcut = currentShortcut(shortcut);
  if (!shortcut) return undefined;
  const parts = shortcut.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  // Ctrl shortcuts take ⌘ on a Mac, which aria-keyshortcuts calls Meta.
  if (parts.length === 2 && /^(Shift|Ctrl|Control|Alt|Meta)$/i.test(parts[0]!)) return `${IS_MAC && /^Ctrl$/i.test(parts[0]!) ? 'Meta' : parts[0]}+${parts[1]}`;
  return undefined;
}
