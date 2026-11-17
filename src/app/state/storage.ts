/** browser.storage.local in the extension (shared across tabs), localStorage in the preview. */
type Listener = (value: unknown) => void;

interface ExtStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
interface ExtStorageChange {
  newValue?: unknown;
}

function extStorage(): { local: ExtStorageArea; onChanged: { addListener(fn: (c: Record<string, ExtStorageChange>, area: string) => void): void } } | null {
  const g = globalThis as unknown as { browser?: { storage?: unknown }; chrome?: { storage?: unknown; runtime?: { id?: string } } };
  const api = (g.browser?.storage ?? (g.chrome?.runtime?.id ? g.chrome?.storage : undefined)) as ReturnType<typeof extStorage>;
  return api ?? null;
}

const listeners = new Map<string, Set<Listener>>();
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  const ext = extStorage();
  if (ext) {
    ext.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) listeners.get(key)?.forEach((fn) => fn(change.newValue));
    });
  } else if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (!e.key || !listeners.has(e.key)) return;
      let value: unknown;
      try {
        value = e.newValue == null ? undefined : JSON.parse(e.newValue);
      } catch {
        return;
      }
      listeners.get(e.key)?.forEach((fn) => fn(value));
    });
  }
}

/** Undefined when nothing is stored or storage can't be read (a context gone after an update). */
export async function readKey<T>(key: string): Promise<T | undefined> {
  return readKeyStrict<T>(key).catch(() => undefined);
}

/** Rejects when storage can't be read, so a caller can tell that from nothing stored. */
export async function readKeyStrict<T>(key: string): Promise<T | undefined> {
  const ext = extStorage();
  if (ext) return (await ext.local.get(key))[key] as T | undefined;
  const raw = localStorage.getItem(key);
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Rejects on quota or a context gone after an update. */
export async function writeKey(key: string, value: unknown): Promise<void> {
  const ext = extStorage();
  if (ext) return ext.local.set({ [key]: value });
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or quota: settings stay in memory for this session.
  }
}

export async function removeKey(key: string): Promise<void> {
  const ext = extStorage();
  if (ext) return ext.local.remove(key).catch(() => undefined);
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing was kept.
  }
}

export function watchKey(key: string, fn: Listener): () => void {
  wire();
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

const queues = new Map<string, Promise<unknown>>();

/** Runs `fn` with no other holder of `name` running, in any page of the extension or its background (Web Locks); without them, only within this page. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks) return locks.request(name, fn);
  const next = (queues.get(name) ?? Promise.resolve()).catch(() => undefined).then(fn);
  queues.set(name, next);
  try {
    return await next;
  } finally {
    if (queues.get(name) === next) queues.delete(name);
  }
}
