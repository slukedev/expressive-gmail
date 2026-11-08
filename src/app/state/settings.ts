import { create } from 'zustand';
import { DEFAULT_SIDEBAR, type SidebarPrefs } from '../features/shell/sidebarLayout';
import { PICTURE_SHAPES, type PictureShape } from '../features/wallpaper/shapes';
import { DEFAULT_SEED, isPresetSeed, normalizeHex, randomSeed, type SchemeVariant } from '../theme/color';
import { crossfadeTheme } from '../theme/crossfade';
import { isUiScale } from '../../shared/uiScale';
import { readKey, watchKey, writeKey } from './storage';

export type Density = 'comfortable' | 'default' | 'compact';
export type ReadingPane = 'auto' | 'right' | 'none';
export type InboxType = 'categories' | 'everything' | 'unread-first' | 'important-first' | 'starred-first';

export interface Split {
  id: string;
  name: string;
  /** Gmail search query that defines the split. */
  query: string;
  icon?: string;
}

export interface Template {
  id: string;
  name: string;
  /** Typed after "/" in compose. */
  shortcut: string;
  subject?: string;
  html: string;
}

/** Read as one inbox. */
export interface Circle {
  id: string;
  name: string;
  /** Lowercased, in the order added. */
  members: string[];
  /** Hex seed from ACCOUNT_COLORS. */
  color: string;
}

interface AccountPrefs {
  /** Shown on conversations in merged inboxes ("Work", "Studio"). */
  nickname?: string;
  /** Hex seed from ACCOUNT_COLORS. */
  color?: string;
  /** Leave this account out of All inboxes. */
  hideFromAll?: boolean;
}

/** How rows in merged inboxes show their account. */
export type AccountMarker = 'badge' | 'dot' | 'chip' | 'off';

export type StartScope = 'home' | 'all' | `circle:${string}`;

/** Also where the Gmail logo leads. */
type StartView = 'inbox' | 'all';

export interface Settings {
  themeMode: 'system' | 'light' | 'dark';
  themeSource: 'google' | 'dynamic';
  seed: string;
  /** Kept while a preset is in use so its swatch can bring it back; '' for none yet. */
  customSeed: string;
  /** So it shows as chosen while it's the theme. */
  randomSeed: string;
  /** Rolled ahead so it can paint before the app loads. */
  nextRandomSeed: string;
  variant: SchemeVariant;
  contrast: number;
  density: Density;
  /** Interface size as a zoom factor, one of `UI_SCALES`. */
  uiScale: number;
  readingPane: ReadingPane;
  /** 0 lets it scale with the window. */
  listWidth: number;
  showAvatars: boolean;
  inboxType: InboxType;
  categories: { social: boolean; promotions: boolean; updates: boolean; forums: boolean };
  undoSendSeconds: 0 | 5 | 10 | 20 | 30;
  sendAndArchive: boolean;
  defaultReply: 'reply' | 'reply-all';
  externalImages: 'always' | 'ask';
  keyboardShortcuts: boolean;
  hoverActions: boolean;
  railExpanded: boolean;
  /** Read through `resolveSidebar`. */
  sidebar: SidebarPrefs;
  backend: 'session' | 'api' | 'demo';
  oauthClientId: string;
  splits: Split[];
  templates: Template[];
  pageSize: 25 | 50 | 100;
  showSnippets: boolean;
  showLabelChips: boolean;
  /** Copy-code, tracking, RSVP and deal chips plus summary cards. */
  smartFeatures: boolean;
  /** Off hides every Gemini button, card and suggestion. */
  gemini: boolean;
  /** On its own for long conversations, or only when asked. */
  geminiSummaries: 'auto' | 'ask';
  /** Else they come from local rules. */
  geminiReplies: boolean;
  /** Searches that read as questions get Gemini's answer above the results. */
  geminiSearch: boolean;
  notifications: boolean;
  /** The empty reading pane shows what wants a look today. */
  glance: boolean;
  /** Like Inbox by Gmail. */
  groupByDate: boolean;
  onboarded: boolean;
  /** "auto" advances with a reading pane and returns to the list without one. */
  afterAction: 'auto' | 'older' | 'newer' | 'list';
  blockTrackers: boolean;
  attachmentReminder: boolean;
  /** Like Gmail on Android. */
  darkEmails: boolean;
  /** Mail arriving after `since` stays out of the inbox until `until` (null: until resumed). */
  inboxPause: { since: number; until: number | null } | null;
  startScope: StartScope;
  startView: StartView;
  circles: Circle[];
  /** By lowercased address. */
  accountPrefs: Record<string, AccountPrefs>;
  /** The account's photo on the sender's, a dot, a chip, or nothing. Without sender photos, badge and dot show as the chip. */
  accountMarker: AccountMarker;
  /** '' for none (your profile photo shows), or "custom:<id>" in IndexedDB. */
  wallpaper: string;
  /** Best first, offered as "From your picture". */
  wallpaperColors: string[];
  /** The shape At a glance cuts your picture or profile photo into. */
  pictureShape: PictureShape;
  /** For the picture it was made on. */
  pictureCrop: { for: string; x: number; y: number; width: number; height: number } | null;
}

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  themeSource: 'google',
  seed: DEFAULT_SEED,
  customSeed: '',
  randomSeed: '',
  nextRandomSeed: '',
  variant: 'tonal-spot',
  contrast: 0,
  density: 'default',
  uiScale: 1,
  readingPane: 'auto',
  listWidth: 0,
  showAvatars: true,
  inboxType: 'categories',
  categories: { social: true, promotions: true, updates: true, forums: false },
  undoSendSeconds: 10,
  sendAndArchive: false,
  defaultReply: 'reply',
  externalImages: 'always',
  keyboardShortcuts: true,
  hoverActions: true,
  railExpanded: true,
  sidebar: DEFAULT_SIDEBAR,
  backend: 'session',
  oauthClientId: '',
  splits: [],
  templates: [],
  pageSize: 50,
  showSnippets: true,
  showLabelChips: true,
  smartFeatures: true,
  gemini: true,
  geminiSummaries: 'auto',
  geminiReplies: true,
  geminiSearch: true,
  notifications: false,
  glance: true,
  groupByDate: true,
  onboarded: false,
  afterAction: 'auto',
  blockTrackers: true,
  attachmentReminder: true,
  darkEmails: true,
  inboxPause: null,
  startScope: 'home',
  startView: 'inbox',
  circles: [],
  accountPrefs: {},
  accountMarker: 'badge',
  wallpaper: '',
  wallpaperColors: [],
  pictureShape: 'Cookie9Sided',
  pictureCrop: null,
};

const KEY = 'bg.settings.v1';

interface SettingsStore {
  settings: Settings;
  loaded: boolean;
  update: (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: (patch) => {
    const current = get().settings;
    const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    set({ settings: next });
    // Unsaved, the change still holds for this page.
    writeKey(KEY, next).catch(() => undefined);
  },
}));

/** Skipping any field whose type doesn't match (an old version, a hand edit). */
function fromStorage(stored: unknown): Settings {
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out as unknown as Settings;
  for (const [key, value] of Object.entries(stored)) {
    const fallback = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    const fits =
      fallback === null || fallback === undefined
        ? true
        : Array.isArray(fallback)
          ? Array.isArray(value)
          : typeof value === typeof fallback && (typeof value !== 'object' || (value !== null && !Array.isArray(value)));
    if (fits) out[key] = value;
  }
  // The built-in pictures are gone: a saved one becomes no picture.
  if (typeof out.wallpaper === 'string' && !out.wallpaper.startsWith('custom:')) {
    out.wallpaper = '';
    out.wallpaperColors = [];
  }
  // Normalized, so a stored #4A5C70 still matches its own swatch.
  out.seed = normalizeHex(out.seed as string) ?? DEFAULT_SEED;
  out.customSeed = normalizeHex(out.customSeed as string) ?? '';
  out.randomSeed = normalizeHex(out.randomSeed as string) ?? '';
  out.nextRandomSeed = normalizeHex(out.nextRandomSeed as string) ?? '';
  // Before there was a custom swatch, a picked colour lived only in the seed.
  const seed = out.seed as string;
  if (!('customSeed' in stored) && !isPresetSeed(seed) && !(out.wallpaperColors as string[]).includes(seed)) out.customSeed = normalizeHex(seed) ?? '';
  if (out.startView !== 'inbox' && out.startView !== 'all') out.startView = DEFAULT_SETTINGS.startView;
  if (!isUiScale(out.uiScale)) out.uiScale = 1;
  if (!PICTURE_SHAPES.some((p) => p.shape === out.pictureShape)) out.pictureShape = DEFAULT_SETTINGS.pictureShape;
  return out as unknown as Settings;
}

/** Whether the theme is the random swatch's colour. */
export const isRandomTheme = (s: Pick<Settings, 'themeSource' | 'seed' | 'randomSeed'>) => s.themeSource === 'dynamic' && !!s.randomSeed && s.seed === s.randomSeed;

/** `seed` now, and the next one rolled ahead for the next load. */
function rollRandom(seed: string): Pick<Settings, 'themeSource' | 'seed' | 'randomSeed' | 'nextRandomSeed'> {
  return { themeSource: 'dynamic', seed, randomSeed: seed, nextRandomSeed: randomSeed(seed) };
}

/** Settings are shared by every tab, but each tab keeps the colour it rolled: another tab's roll changes only the colour saved for the next load. */
let tabRandom = '';
function withTabRandom(s: Settings): Settings {
  if (!isRandomTheme(s)) {
    tabRandom = '';
    return s;
  }
  tabRandom ||= s.seed;
  return { ...s, seed: tabRandom, randomSeed: tabRandom };
}

/** Away from the one it has. */
export function rollTabRandom() {
  tabRandom = randomSeed(useSettingsStore.getState().settings.seed);
  updateSettings(rollRandom(tabRandom));
}

export async function loadSettings(overrides?: Partial<Settings>) {
  let settings = fromStorage(await readKey(KEY));
  // A random theme rolls on every load, to the colour saved for it last time, which theme-boot.js already painted.
  if (isRandomTheme(settings)) {
    tabRandom = settings.nextRandomSeed || randomSeed(settings.seed);
    settings = { ...settings, ...rollRandom(tabRandom) };
    writeKey(KEY, settings).catch(() => undefined);
  }
  useSettingsStore.setState({ settings: { ...settings, ...overrides }, loaded: true });
  watchKey(KEY, (value) => {
    if (value && typeof value === 'object') useSettingsStore.setState({ settings: { ...withTabRandom(fromStorage(value)), ...overrides } });
  });
}

export function useSettings<T>(selector: (s: Settings) => T): T {
  return useSettingsStore((store) => selector(store.settings));
}

const THEME_KEYS = ['themeMode', 'themeSource', 'seed', 'variant', 'contrast'] as const;

export const updateSettings = (patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => {
  const store = useSettingsStore.getState();
  const next = typeof patch === 'function' ? patch(store.settings) : patch;
  // A new theme renders under a cross-fade of the old one.
  if (THEME_KEYS.some((k) => k in next && next[k] !== store.settings[k])) crossfadeTheme(() => useSettingsStore.getState().update(next));
  else store.update(next);
};
