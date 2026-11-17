/** Storage keys for the Gmail API backend, and a key-value seam so tests and the background can pass their own store. */
import { browser } from 'wxt/browser';
import { withLock } from '../../state/storage';

export const SNOOZE_STORAGE_KEY = 'bg.api.snoozed';
export const MUTED_STORAGE_KEY = 'bg.api.muted';
export const HELPER_LABELS_STORAGE_KEY = 'bg.api.helperLabels';

// The extension's old name. These labels already exist in people's mailboxes, so they keep it.
export const SNOOZE_LABEL_NAME = 'Snoozed (Better Gmail)';
export const MUTE_LABEL_NAME = 'Muted (Better Gmail)';

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

/** Read, change and write one key with no other write to it in between, from any page of the extension or the background. */
export async function updateKey<T>(store: KeyValueStore, key: string, change: (current: T | undefined) => T): Promise<void> {
  await withLock(`bg-store:${key}`, async () => store.set(key, change(await store.get<T>(key))));
}

export function browserLocalStore(): KeyValueStore {
  return {
    async get<T>(key: string) {
      const result = await browser.storage.local.get(key);
      return result[key] as T | undefined;
    },
    async set(key, value) {
      await browser.storage.local.set({ [key]: value });
    },
  };
}

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = { ...initial };
  return {
    data,
    async get<T>(key: string) {
      return data[key] as T | undefined;
    },
    async set(key, value) {
      data[key] = value;
    },
  };
}
