/** Never wraps: reaching the end should feel like the end. `from` of -1 starts at the top. */
export function nextUnread(ids: string[], from: number, direction: 1 | -1, isUnread: (id: string) => boolean): string | undefined {
  if (from < 0 && direction === -1) return undefined;
  for (let i = from + direction; i >= 0 && i < ids.length; i += direction) {
    if (isUnread(ids[i]!)) return ids[i];
  }
  return undefined;
}
