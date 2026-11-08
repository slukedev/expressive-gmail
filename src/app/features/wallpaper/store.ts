import type { SaliencyMap } from './analyze';

/** In this browser's IndexedDB: too big for extension storage, and never synced. One slot; a new upload replaces it. */
export interface StoredPicture {
  /** So other tabs notice a new picture under the same setting. */
  id: string;
  /** Bytes, not a Blob: Safari has lost Blobs stored in IndexedDB. */
  bytes: ArrayBuffer;
  type: string;
  width: number;
  height: number;
  /** Pictures saved before it existed crop centred. */
  saliency?: SaliencyMap;
  colors: string[];
  /** For the tile's label. */
  name: string;
}

const DB = 'bg-wallpaper';
const STORE = 'pictures';
const KEY = 'custom';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
  } finally {
    db.close();
  }
}

export function savePicture(p: StoredPicture): Promise<void> {
  return run<void>('readwrite', (s) => s.put(p, KEY)).then(() => undefined);
}

/** Undefined when nothing is stored or IndexedDB can't be read (a private window). */
export async function loadPicture(): Promise<StoredPicture | undefined> {
  try {
    const p = await run<StoredPicture>('readonly', (s) => s.get(KEY));
    return p && typeof p.id === 'string' && p.bytes ? p : undefined;
  } catch {
    return undefined;
  }
}

export function deletePicture(): Promise<void> {
  return run<void>('readwrite', (s) => s.delete(KEY)).then(() => undefined);
}
