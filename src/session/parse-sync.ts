import type { Thread } from '../app/data/types';
import { isThreadId, normalizeThreadId } from './ids';
import { arr, at, num, readHistoryId } from './json';
import { parseLabelCounts } from './labels';
import { parseThreadWrapper } from './parse-thread';

/**
 * An /i/s response: `[acks, [0, _, _, _, removed, updatedThreads, _, historyId], [labelCounts], [historyId]]`.
 * acks are `[[opId, status, _, version], ...]` (InboxSDK compose fixtures:
 * `[[[84, 0, null, 5999570]]]`); updated threads are `[[threadId, _, [.., .., .., .., .., .., [flatThread]]], version]`.
 */

export interface SyncAck {
  op: number;
  status: number;
}

export function parseAcks(root: unknown): SyncAck[] {
  const acks: SyncAck[] = [];
  for (const group of arr(at(root, 0)) ?? []) {
    for (const ack of arr(group) ?? []) {
      const op = num(at(ack, 0));
      const status = num(at(ack, 1));
      if (op !== undefined && status !== undefined) acks.push({ op, status });
    }
  }
  return acks;
}

/** Threads Gmail echoes back after a write, with their messages as stored. */
export function parseUpdatedThreads(root: unknown): Thread[] {
  const threads: Thread[] = [];
  for (const entry of arr(at(root, 1, 5)) ?? []) {
    const inner = at(entry, 0, 2, 6, 0);
    const thread = parseThreadWrapper(inner);
    if (thread) threads.push(thread);
  }
  return threads;
}

export interface PollResult {
  historyId?: number;
  threadIds: string[];
  labelCounts: Map<string, { unread?: number; total?: number }>;
}

export function parsePoll(root: unknown): PollResult {
  const ids = new Set<string>();
  collectThreadIds(at(root, 1, 4), ids, 0);
  collectThreadIds(at(root, 1, 5), ids, 0);
  return {
    historyId: readHistoryId(root) ?? num(at(root, 1, 7)),
    threadIds: [...ids],
    labelCounts: parseLabelCounts(at(root, 2)),
  };
}

function collectThreadIds(node: unknown, out: Set<string>, depth: number) {
  if (depth > 8) return;
  if (typeof node === 'string') {
    const id = normalizeThreadId(node);
    if (id && isThreadId(id)) out.add(id);
    return;
  }
  for (const child of arr(node) ?? []) collectThreadIds(child, out, depth + 1);
}
