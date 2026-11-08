import type { IconName } from '../../ui/Icon';

/** Every destination is on the rail, under More, or hidden; Splits and Labels move as whole sections. `resolveSidebar` repairs prefs an older version stored, so the rail never loses a destination. */

export const NAV_IDS = [
  'inbox',
  'starred',
  'snoozed',
  'sent',
  'drafts',
  'imp',
  'scheduled',
  'all',
  'spam',
  'trash',
  'ai-inbox',
  'purchases',
  'subscriptions',
  'attachments',
  'storage',
  'reminders',
] as const;
export type NavId = (typeof NAV_IDS)[number];

export const NAV_META: Record<NavId, { label: string; icon: IconName }> = {
  inbox: { label: 'Inbox', icon: 'inbox' },
  starred: { label: 'Starred', icon: 'star' },
  snoozed: { label: 'Snoozed', icon: 'schedule' },
  sent: { label: 'Sent', icon: 'send' },
  drafts: { label: 'Drafts', icon: 'draft' },
  imp: { label: 'Important', icon: 'label_important' },
  scheduled: { label: 'Scheduled', icon: 'schedule_send' },
  all: { label: 'All mail', icon: 'stacks' },
  spam: { label: 'Spam', icon: 'report' },
  trash: { label: 'Trash', icon: 'delete' },
  'ai-inbox': { label: 'AI Inbox', icon: 'checklist' },
  purchases: { label: 'Purchases', icon: 'shopping_bag' },
  subscriptions: { label: 'Subscriptions', icon: 'unsubscribe' },
  attachments: { label: 'Attachments', icon: 'attach_file' },
  storage: { label: 'Storage', icon: 'cloud' },
  reminders: { label: 'Follow-ups', icon: 'alarm' },
};

export const PLACES = ['main', 'more', 'hidden'] as const;
export type Place = (typeof PLACES)[number];

const SECTION_IDS = ['splits', 'labels'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SidebarPrefs {
  items: { id: NavId; place: Place }[];
  sections: { id: SectionId; shown: boolean }[];
}

/** Inbox can move, but always stays on the rail. */
export const PINNED: ReadonlySet<NavId> = new Set(['inbox']);

const MAIN_BY_DEFAULT: ReadonlySet<NavId> = new Set(['inbox', 'starred', 'snoozed', 'sent', 'drafts']);

export const DEFAULT_SIDEBAR: SidebarPrefs = {
  items: NAV_IDS.map((id) => ({ id, place: MAIN_BY_DEFAULT.has(id) ? 'main' : 'more' })),
  sections: SECTION_IDS.map((id) => ({ id, shown: true })),
};

const rank = (p: Place) => PLACES.indexOf(p);

/** Every destination and section exactly once, grouped by place. */
export function resolveSidebar(stored: unknown): SidebarPrefs {
  const raw = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof SidebarPrefs, unknown>>;
  const items: SidebarPrefs['items'] = [];
  const seen = new Set<NavId>();
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const id = (entry as { id?: unknown })?.id as NavId;
    const place = (entry as { place?: unknown })?.place as Place;
    if (!NAV_IDS.includes(id) || seen.has(id) || !PLACES.includes(place)) continue;
    seen.add(id);
    items.push({ id, place: PINNED.has(id) ? 'main' : place });
  }
  // One added since these were saved goes after its default neighbour.
  DEFAULT_SIDEBAR.items.forEach((d, i) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    const before = DEFAULT_SIDEBAR.items
      .slice(0, i)
      .reverse()
      .find((p) => items.some((x) => x.id === p.id && x.place === d.place));
    const at = before ? items.findIndex((x) => x.id === before.id) + 1 : items.findIndex((x) => rank(x.place) > rank(d.place));
    items.splice(at < 0 ? items.length : at, 0, { ...d });
  });
  // Stable sort keeps each place's own order.
  items.sort((a, b) => rank(a.place) - rank(b.place));

  const sections: SidebarPrefs['sections'] = [];
  for (const entry of Array.isArray(raw.sections) ? raw.sections : []) {
    const id = (entry as { id?: unknown })?.id as SectionId;
    if (!SECTION_IDS.includes(id) || sections.some((s) => s.id === id)) continue;
    sections.push({ id, shown: (entry as { shown?: unknown }).shown !== false });
  }
  for (const id of SECTION_IDS) if (!sections.some((s) => s.id === id)) sections.push({ id, shown: true });
  return { items, sections };
}

export function isDefaultSidebar(prefs: SidebarPrefs): boolean {
  return JSON.stringify(resolveSidebar(prefs)) === JSON.stringify(DEFAULT_SIDEBAR);
}

export function placeOf(prefs: SidebarPrefs, id: NavId): Place {
  return prefs.items.find((x) => x.id === id)?.place ?? 'more';
}

/** Clamped; the end when omitted. */
export function moveItem(prefs: SidebarPrefs, id: NavId, place: Place, index?: number): SidebarPrefs {
  if (PINNED.has(id) && place !== 'main') return prefs;
  const rest = prefs.items.filter((x) => x.id !== id);
  const inPlace = rest.filter((x) => x.place === place);
  const at = Math.max(0, Math.min(index ?? inPlace.length, inPlace.length));
  const anchor = inPlace[at];
  let pos = anchor ? rest.indexOf(anchor) : rest.findIndex((x) => rank(x.place) > rank(place));
  if (pos < 0) pos = rest.length;
  const items = [...rest.slice(0, pos), { id, place }, ...rest.slice(pos)];
  return { ...prefs, items };
}

/** As the list reads in Settings: stepping past the More or Hidden heading moves it into the next place. */
export function stepItem(prefs: SidebarPrefs, id: NavId, delta: -1 | 1): SidebarPrefs {
  const place = placeOf(prefs, id);
  const inPlace = prefs.items.filter((x) => x.place === place);
  const index = inPlace.findIndex((x) => x.id === id);
  const next = index + delta;
  if (next >= 0 && next < inPlace.length) return moveItem(prefs, id, place, next);
  const nextPlace = PLACES[rank(place) + delta];
  if (!nextPlace) return prefs;
  return moveItem(prefs, id, nextPlace, delta < 0 ? undefined : 0);
}

export function stepSection(prefs: SidebarPrefs, id: SectionId, delta: -1 | 1): SidebarPrefs {
  const i = prefs.sections.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= prefs.sections.length) return prefs;
  const sections = [...prefs.sections];
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return { ...prefs, sections };
}

export function moveSection(prefs: SidebarPrefs, id: SectionId, index: number): SidebarPrefs {
  const entry = prefs.sections.find((s) => s.id === id);
  if (!entry) return prefs;
  const rest = prefs.sections.filter((s) => s.id !== id);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, entry);
  return { ...prefs, sections: rest };
}

export function showSection(prefs: SidebarPrefs, id: SectionId, shown: boolean): SidebarPrefs {
  return { ...prefs, sections: prefs.sections.map((s) => (s.id === id ? { ...s, shown } : s)) };
}

/** Like Gmail, Scheduled left under More comes up beside Sent while something waits to send. */
export function railLayout(prefs: SidebarPrefs, { scheduledWaiting, unavailable }: { scheduledWaiting: boolean; unavailable?: ReadonlySet<NavId> }) {
  // Destinations this account can't use (AI Inbox without Gemini) keep their place but don't draw.
  const shown = (x: { id: NavId }) => !unavailable?.has(x.id);
  const main = prefs.items.filter((x) => x.place === 'main' && shown(x)).map((x) => x.id);
  let more = prefs.items.filter((x) => x.place === 'more' && shown(x)).map((x) => x.id);
  if (scheduledWaiting && more.includes('scheduled')) {
    more = more.filter((id) => id !== 'scheduled');
    const sent = main.indexOf('sent');
    main.splice(sent < 0 ? main.length : sent + 1, 0, 'scheduled');
  }
  const sections = prefs.sections.filter((s) => s.shown).map((s) => s.id);
  return { main, more, sections };
}
