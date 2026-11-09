import { create } from 'zustand';
import type { Address, OutgoingAttachment } from '../data/types';
import type { ListFilter } from '../features/list/filters';
import { useSettingsStore } from './settings';

export interface ComposeDraft {
  key: string;
  mode: 'new' | 'reply' | 'reply-all' | 'forward';
  from?: Address;
  threadId?: string;
  draftId?: string;
  /** So the thread can hide the row while it's edited. */
  draftMessageId?: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  inReplyTo?: string;
  references?: string;
  attachments: OutgoingAttachment[];
  window: 'open' | 'minimized' | 'full';
  /** Inside the thread view instead of a docked window. */
  inline?: boolean;
  /** Appended on send. */
  quoteHtml?: string;
  /** Send schedules it for then. */
  sendAt?: number;
}

interface UiState {
  selected: Set<string>;
  cursor: number;
  composes: ComposeDraft[];
  quickSettings: boolean;
  settingsSection: string | null;
  palette: boolean;
  shortcutsHelp: boolean;
  /** 'more' opens it with the More destinations showing. */
  railOpenModal: boolean | 'more';
  /** They belong to one view and don't carry over. */
  listFilters: ListFilter[];
  listFiltersView: string;
  setListFilters: (filters: ListFilter[], view?: string) => void;
  setSelected: (ids: Set<string>) => void;
  toggleSelected: (id: string, on?: boolean) => void;
  clearSelection: () => void;
  setCursor: (i: number) => void;
  openCompose: (d: Partial<ComposeDraft>) => string;
  updateCompose: (key: string, patch: Partial<ComposeDraft>) => void;
  closeCompose: (key: string) => void;
  set: (patch: Partial<Pick<UiState, 'quickSettings' | 'settingsSection' | 'palette' | 'shortcutsHelp' | 'railOpenModal'>>) => void;
}

let composeSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  selected: new Set(),
  cursor: -1,
  composes: [],
  quickSettings: false,
  settingsSection: null,
  palette: false,
  shortcutsHelp: false,
  railOpenModal: false,
  listFilters: [],
  listFiltersView: '',
  // A different filter is a different list: selection and cursor start over.
  setListFilters: (listFilters, view) =>
    set({ listFilters, selected: new Set(), cursor: -1, ...(view !== undefined ? { listFiltersView: view } : {}) }),
  setSelected: (ids) => set({ selected: ids }),
  toggleSelected: (id, on) => {
    const next = new Set(get().selected);
    const want = on ?? !next.has(id);
    if (want) next.add(id);
    else next.delete(id);
    set({ selected: next });
  },
  clearSelection: () => get().selected.size && set({ selected: new Set() }),
  setCursor: (cursor) => set({ cursor }),
  openCompose: (d) => {
    const existing = d.inline && d.threadId ? get().composes.find((c) => c.inline && c.threadId === d.threadId) : undefined;
    if (existing) {
      get().updateCompose(existing.key, { ...d, key: existing.key });
      return existing.key;
    }
    const key = `c${++composeSeq}`;
    const draft: ComposeDraft = {
      key,
      mode: 'new',
      to: [],
      cc: [],
      bcc: [],
      subject: '',
      html: '',
      attachments: [],
      window: 'open',
      ...d,
    };
    if (!draft.inline && draft.window === 'open' && useSettingsStore.getState().settings.composeFullScreen) draft.window = 'full';
    // Gmail keeps at most three docked windows; the oldest minimizes. Only one window is full screen at a time.
    const docked = get().composes.filter((c) => !c.inline && c.window !== 'full');
    const composes = get().composes.map((c) =>
      c.inline
        ? c
        : draft.window === 'full' && c.window === 'full'
          ? { ...c, window: 'minimized' as const }
          : draft.window !== 'full' && docked.length >= 3 && c.key === docked[0].key
            ? { ...c, window: 'minimized' as const }
            : c,
    );
    set({ composes: [...composes, draft] });
    return key;
  },
  updateCompose: (key, patch) => set({ composes: get().composes.map((c) => (c.key === key ? { ...c, ...patch } : c)) }),
  closeCompose: (key) => set({ composes: get().composes.filter((c) => c.key !== key) }),
  set: (patch) => set(patch),
}));
