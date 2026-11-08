/** Total readers for Gmail's positional arrays: a wrong shape yields undefined, never a throw. */

export function arr(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function at(value: unknown, ...path: number[]): unknown {
  let cur = value;
  for (const index of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[index];
  }
  return cur;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Gmail sends numbers both as JSON numbers and as decimal strings (older form). */
export function num(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return undefined;
}

export function strings(value: unknown): string[] {
  return arr(value)?.filter((x): x is string => typeof x === 'string') ?? [];
}

const XSSI_PREFIX = /^\)\]\}'[^\n]*\n?/;

/** Sync endpoints answer with bare JSON; the legacy channel prefixes `)]}'`. */
export function parseGmailJson(text: string): unknown {
  return JSON.parse(text.replace(XSSI_PREFIX, ''));
}

/**
 * The trailing `[historyId]` element every sync response ends with
 * (bv: [18], fd: [4], s: [3]). Monotonic per mailbox.
 */
export function readHistoryId(root: unknown): number | undefined {
  const list = arr(root);
  if (!list || list.length < 2) return undefined;
  const last = arr(list[list.length - 1]);
  if (!last || last.length !== 1) return undefined;
  const id = num(last[0]);
  return id !== undefined && id > 0 ? id : undefined;
}
