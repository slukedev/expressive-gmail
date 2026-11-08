/** Caps a long-lived Map or Set by dropping the oldest entries, so a tab open for weeks holds what's recent. */
export function cap<T extends Map<unknown, unknown> | Set<unknown>>(collection: T, max: number): T {
  if (collection.size <= max) return collection;
  let extra = collection.size - max;
  for (const key of collection.keys()) {
    if (extra-- <= 0) break;
    collection.delete(key as never);
  }
  return collection;
}
