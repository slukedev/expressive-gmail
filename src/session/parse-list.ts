import type { Label, ThreadSummary } from '../app/data/types';
import { arr, at, num, readHistoryId } from './json';
import { parseLabels } from './labels';
import { isFlatThread, parseFlatThread } from './parse-thread';

/**
 * An /i/bv ("batch view") response. Thread rows are `[flatThread, sortKey]`
 * (InboxSDK `extractThreadsFromSearchResponse_20220909` reads [2]); Gmail's
 * search view puts them under [15] or [19] as `[2, rows]` instead (crouton-labs
 * `parseSearchResponse`). [3] = 1 and [11] = [_, total] were read by sluice as
 * a has-more flag and a result count.
 */
export interface ParsedThreadList {
  threads: ThreadSummary[];
  /** Thread id → its message ids, needed later to address label changes. */
  messageIds: Map<string, string[]>;
  hasMore?: boolean;
  total?: number;
  historyId?: number;
  labels?: Label[];
}

export function parseThreadList(root: unknown): ParsedThreadList {
  const threads: ThreadSummary[] = [];
  const messageIds = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const row of findThreadRows(root)) {
    const thread = parseFlatThread(at(row, 0));
    if (!thread || seen.has(thread.id)) continue;
    seen.add(thread.id);
    const { messages, ...summary } = thread;
    threads.push(summary);
    messageIds.set(thread.id, messages.map((m) => m.id));
  }
  const result: ParsedThreadList = { threads, messageIds, historyId: readHistoryId(root) };
  const flag = at(root, 3);
  if (flag === 0 || flag === 1) result.hasMore = flag === 1;
  const total = num(at(root, 11, 1));
  if (total !== undefined) result.total = total;
  if (arr(at(root, 1)) || arr(at(root, 6))) result.labels = parseLabels(at(root, 1), at(root, 6));
  return result;
}

function isRowList(node: unknown): node is unknown[] {
  const rows = arr(node);
  return !!rows && rows.length > 0 && rows.some((row) => isFlatThread(at(row, 0)));
}

function findThreadRows(root: unknown): unknown[] {
  const top = arr(root);
  if (!top) return [];
  if (isRowList(top[2])) return top[2];
  for (const node of top) {
    for (const entry of arr(node) ?? []) {
      if (at(entry, 0) === 2 && isRowList(at(entry, 1))) return at(entry, 1) as unknown[];
    }
  }
  return [];
}
