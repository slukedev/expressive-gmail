/** Single-key shortcuts a person can rebind, like Gmail's "Custom keyboard shortcuts". Sequences (g then i, * then a) and modifier shortcuts stay fixed. */

export type ShortcutGroup = 'jump' | 'list' | 'act' | 'write';

export interface ShortcutAction {
  id: string;
  label: string;
  group: ShortcutGroup;
  /** The first is the one the handler switches on; the rest are Gmail's aliases. */
  keys: string[];
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  { id: 'search', label: 'Search', group: 'jump', keys: ['/'] },
  { id: 'help', label: 'Keyboard shortcuts', group: 'jump', keys: ['?'] },
  { id: 'older', label: 'Older conversation', group: 'list', keys: ['j'] },
  { id: 'newer', label: 'Newer conversation', group: 'list', keys: ['k'] },
  { id: 'nextUnread', label: 'Next unread conversation', group: 'list', keys: ['J'] },
  { id: 'prevUnread', label: 'Previous unread conversation', group: 'list', keys: ['K'] },
  { id: 'open', label: 'Open conversation', group: 'list', keys: ['o'] },
  { id: 'back', label: 'Back to the list', group: 'list', keys: ['u'] },
  { id: 'select', label: 'Select conversation', group: 'list', keys: ['x'] },
  { id: 'selectRange', label: 'Select from the last selected conversation to this one', group: 'list', keys: ['X'] },
  { id: 'refresh', label: 'Refresh', group: 'list', keys: ['N'] },
  { id: 'archive', label: 'Archive', group: 'act', keys: ['e', 'y'] },
  { id: 'trash', label: 'Delete', group: 'act', keys: ['#'] },
  { id: 'spam', label: 'Report spam', group: 'act', keys: ['!'] },
  { id: 'star', label: 'Star or unstar', group: 'act', keys: ['s'] },
  { id: 'markRead', label: 'Mark as read', group: 'act', keys: ['I'] },
  { id: 'markUnread', label: 'Mark as unread', group: 'act', keys: ['U'] },
  { id: 'snooze', label: 'Snooze', group: 'act', keys: ['b'] },
  { id: 'label', label: 'Label as', group: 'act', keys: ['l'] },
  { id: 'move', label: 'Move to', group: 'act', keys: ['v'] },
  { id: 'mute', label: 'Mute', group: 'act', keys: ['m'] },
  { id: 'pin', label: 'Pin to top of inbox', group: 'act', keys: ['p'] },
  { id: 'replyLater', label: 'Reply later', group: 'act', keys: ['L'] },
  { id: 'important', label: 'Mark important', group: 'act', keys: ['+', '='] },
  { id: 'notImportant', label: 'Mark not important', group: 'act', keys: ['-'] },
  { id: 'archiveNewer', label: 'Archive and go newer', group: 'act', keys: ['['] },
  { id: 'archiveOlder', label: 'Archive and go older', group: 'act', keys: [']'] },
  { id: 'undo', label: 'Undo last action', group: 'act', keys: ['z'] },
  { id: 'compose', label: 'Compose', group: 'write', keys: ['c'] },
  { id: 'reply', label: 'Reply', group: 'write', keys: ['r'] },
  { id: 'replyAll', label: 'Reply all', group: 'write', keys: ['a'] },
  { id: 'forward', label: 'Forward', group: 'write', keys: ['f'] },
  { id: 'expandAll', label: 'Expand all messages', group: 'write', keys: [';'] },
  { id: 'collapseAll', label: 'Collapse all messages', group: 'write', keys: [':'] },
];

const BY_ID = new Map(SHORTCUT_ACTIONS.map((a) => [a.id, a]));
/** By any default key, aliases included. */
const BY_DEFAULT_KEY = new Map(SHORTCUT_ACTIONS.flatMap((a) => a.keys.map((k) => [k, a] as const)));

/** Action id to its one chosen key; '' leaves the action without one. */
export type ShortcutKeys = Record<string, string>;

/** Start the sequences. */
const PREFIXES = new Set(['g', '*']);

/** A key that can be bound: one visible character, not a space or a sequence starter. */
export function isBindable(key: string): boolean {
  return [...key].length === 1 && key.trim() !== '' && !PREFIXES.has(key);
}

/** Drops anything that isn't a known action with a bindable key (an old version, a hand edit). */
export function cleanShortcutKeys(stored: unknown): ShortcutKeys {
  const out: ShortcutKeys = {};
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
  for (const [id, key] of Object.entries(stored)) {
    if (BY_ID.has(id) && typeof key === 'string' && (key === '' || isBindable(key))) out[id] = key;
  }
  return out;
}

const maps = new WeakMap<ShortcutKeys, Map<string, string>>();

/** Key to action id. A chosen key wins over a default one, so a default only works while nothing else has claimed it. */
export function keyMap(custom: ShortcutKeys): Map<string, string> {
  const cached = maps.get(custom);
  if (cached) return cached;
  const map = new Map<string, string>();
  for (const a of SHORTCUT_ACTIONS) {
    const key = custom[a.id];
    if (key) map.set(key, a.id);
  }
  for (const a of SHORTCUT_ACTIONS) {
    if (a.id in custom) continue;
    for (const k of a.keys) if (!map.has(k)) map.set(k, a.id);
  }
  maps.set(custom, map);
  return map;
}

/** The keys that run this action now, first the main one. */
export function keysFor(id: string, custom: ShortcutKeys): string[] {
  const a = BY_ID.get(id);
  if (!a) return [];
  const map = keyMap(custom);
  const candidates = id in custom ? (custom[id] ? [custom[id]!] : []) : a.keys;
  return candidates.filter((k) => map.get(k) === id);
}

/** What the handler should treat a pressed key as: the action's first default key, or null when the key is no longer bound. Other keys pass through. */
export function canonicalKey(key: string, custom: ShortcutKeys): string | null {
  if (!isBindable(key)) return key;
  const id = keyMap(custom).get(key);
  return id ? BY_ID.get(id)!.keys[0]! : null;
}

/** Gives `id` the key, taking it from any other action that chose it. */
export function assignKey(custom: ShortcutKeys, id: string, key: string): ShortcutKeys {
  const next: ShortcutKeys = {};
  for (const [other, k] of Object.entries(custom)) next[other] = other !== id && k === key && key ? '' : k;
  const a = BY_ID.get(id);
  // Choosing the default back is the same as never having changed it.
  if (a && key === a.keys[0] && a.keys.length === 1) delete next[id];
  else next[id] = key;
  return next;
}

export function resetKey(custom: ShortcutKeys, id: string): ShortcutKeys {
  const next = { ...custom };
  delete next[id];
  return next;
}

/** "Shift X" for a capital, as the help reads. */
export function keyName(key: string): string {
  return /^[A-Z]$/.test(key) ? `Shift ${key}` : key;
}

/**
 * A hint like "e" or "Shift U" written for Gmail's default keys, in the keys this person uses now.
 * Undefined when the action has no key; hints for anything else come back unchanged.
 */
export function reboundShortcut(shortcut: string, custom: ShortcutKeys): string | undefined {
  const m = /^(?:Shift ([A-Z])|(\S))$/.exec(shortcut.trim());
  const key = m?.[1] ?? m?.[2];
  const action = key ? BY_DEFAULT_KEY.get(key) : undefined;
  if (!key || !action) return shortcut;
  const now = keysFor(action.id, custom);
  if (now.includes(key)) return shortcut;
  return now[0] ? keyName(now[0]) : undefined;
}
