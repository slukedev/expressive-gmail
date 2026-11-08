import { BackendError } from '../app/data/backend';
import type { Label, LabelChange, LabelId, SystemLabelId } from '../app/data/types';
import { arr, at, num, str } from './json';

/**
 * Gmail's internal system label ids and their Gmail-API names. Sources:
 * message label arrays in InboxSDK and gmail.js fixtures, the label list a
 * real /i/s draft-save request asks counts for ("^i ^t ^t_z ^io_im ^f ^r ^all
 * ^s ^k ^b ^scheduled", the order of Gmail's sidebar), and the category
 * labels on real messages ("^smartlabel_personal" next to "^sq_ig_i_personal").
 */
const SYSTEM: ReadonlyArray<readonly [string, SystemLabelId]> = [
  ['^i', 'INBOX'],
  ['^t', 'STARRED'],
  ['^u', 'UNREAD'],
  ['^io_im', 'IMPORTANT'],
  ['^f', 'SENT'],
  ['^r', 'DRAFT'],
  ['^s', 'SPAM'],
  ['^k', 'TRASH'],
  ['^t_z', 'SNOOZED'],
  ['^scheduled', 'SCHEDULED'],
  ['^b', 'CHAT'],
  ['^smartlabel_personal', 'CATEGORY_PERSONAL'],
  ['^smartlabel_social', 'CATEGORY_SOCIAL'],
  ['^smartlabel_promo', 'CATEGORY_PROMOTIONS'],
  ['^smartlabel_notification', 'CATEGORY_UPDATES'],
  ['^smartlabel_group', 'CATEGORY_FORUMS'],
];

const TO_API = new Map<string, SystemLabelId>(SYSTEM);
const TO_INTERNAL = new Map<string, string>(SYSTEM.map(([internal, api]) => [api, internal]));

/** User labels are "^x_<n>"; anything without a caret counts as one too. */
function isUserLabel(internal: string): boolean {
  return internal.startsWith('^x_') || !internal.startsWith('^');
}

/** Bookkeeping labels ("^all", "^io_lr", "^sq_ig_*") map to undefined. */
function toLabelId(internal: string): LabelId | undefined {
  return TO_API.get(internal) ?? (isUserLabel(internal) ? internal : undefined);
}

function toInternalLabel(id: LabelId): string {
  return TO_INTERNAL.get(id) ?? id;
}

export function mapLabels(internal: readonly string[]): LabelId[] {
  const out = new Set<LabelId>();
  for (const label of internal) {
    const id = toLabelId(label);
    if (id) out.add(id);
  }
  return [...out];
}

const STAR_STYLES = ['^ss_sy', '^ss_so', '^ss_sr', '^ss_sp', '^ss_sb', '^ss_sg', '^ss_cr', '^ss_co', '^ss_cy', '^ss_cg', '^ss_cb', '^ss_cp'];
const NOT_MODIFIABLE = new Set<LabelId>(['SENT', 'DRAFT', 'SNOOZED', 'SCHEDULED', 'CHAT']);

/**
 * What Gmail's own client adds and removes for each change. Archive and trash
 * come from real requests in gmail.js test data (archive adds "^a" and drops
 * "^i"; trash adds "^k" and drops "^i", "^s"); star, read and importance from
 * the action map gmail.js derived from live traffic.
 */
function expand(id: LabelId, adding: boolean): { add: string[]; remove: string[] } {
  if (NOT_MODIFIABLE.has(id)) {
    throw new BackendError(`${id} can't be added or removed directly in Gmail`, 'unsupported');
  }
  switch (id) {
    case 'INBOX':
      return adding ? { add: ['^i'], remove: ['^a'] } : { add: ['^a'], remove: ['^i'] };
    case 'STARRED':
      return adding ? { add: ['^t', '^ss_sy'], remove: [] } : { add: [], remove: ['^t', ...STAR_STYLES] };
    case 'UNREAD':
      return adding ? { add: ['^u'], remove: [] } : { add: [], remove: ['^u', '^us'] };
    case 'IMPORTANT':
      return adding ? { add: ['^io_im', '^imi'], remove: ['^imn'] } : { add: ['^imn'], remove: ['^io_im', '^imi'] };
    case 'SPAM':
      return adding ? { add: ['^s'], remove: ['^i'] } : { add: ['^i'], remove: ['^s'] };
    case 'TRASH':
      return adding ? { add: ['^k'], remove: ['^i', '^s'] } : { add: ['^i'], remove: ['^k'] };
    default: {
      const internal = toInternalLabel(id);
      return adding ? { add: [internal], remove: [] } : { add: [], remove: [internal] };
    }
  }
}

export interface InternalLabelChange {
  add: string[];
  remove: string[];
}

export function toInternalChange(change: LabelChange): InternalLabelChange {
  const add = new Set<string>();
  const remove = new Set<string>();
  for (const id of change.add ?? []) {
    const e = expand(id, true);
    e.add.forEach((l) => add.add(l));
    e.remove.forEach((l) => remove.add(l));
  }
  for (const id of change.remove ?? []) {
    const e = expand(id, false);
    e.add.forEach((l) => add.add(l));
    e.remove.forEach((l) => remove.add(l));
  }
  // An explicit add wins over a side effect of another change (e.g. add INBOX + remove SPAM).
  for (const l of add) remove.delete(l);
  return { add: [...add], remove: [...remove] };
}

const SYSTEM_ORDER: SystemLabelId[] = SYSTEM.map(([, api]) => api);

/**
 * Labels from a bv response: definitions at [1] as [[def, version], ...] with
 * def[0] the internal id and def[1] the display name, counts at [6] (or [2] in
 * an /i/s response) as [[[id, unread, total], ...]]. Unread/total order was
 * established by sluice's analysis (unread <= total in every row; ^all is a
 * superset of ^i on both numbers).
 */
export function parseLabels(defsNode: unknown, countsNode: unknown): Label[] {
  const counts = parseLabelCounts(countsNode);
  const labels = new Map<string, Label>();

  for (const api of SYSTEM_ORDER) {
    const c = counts.get(toInternalLabel(api));
    labels.set(api, { id: api, name: api, type: 'system', ...countFields(c) });
  }

  for (const row of arr(defsNode) ?? []) {
    const internal = str(at(row, 0, 0));
    if (!internal || !isUserLabel(internal)) continue;
    const name = str(at(row, 0, 1)) ?? internal;
    labels.set(internal, { id: internal, name, type: 'user', ...countFields(counts.get(internal)) });
  }
  // Counted user labels missing from the definitions still exist; name them by id.
  for (const [internal, c] of counts) {
    if (isUserLabel(internal) && !labels.has(internal)) {
      labels.set(internal, { id: internal, name: internal, type: 'user', ...countFields(c) });
    }
  }
  return [...labels.values()];
}

export function parseLabelCounts(node: unknown): Map<string, { unread?: number; total?: number }> {
  const out = new Map<string, { unread?: number; total?: number }>();
  for (const row of arr(at(node, 0)) ?? []) {
    const id = str(at(row, 0));
    if (!id) continue;
    const unread = num(at(row, 1));
    const total = num(at(row, 2));
    if (unread === undefined && total === undefined) continue;
    out.set(id, { unread, total });
  }
  return out;
}

function countFields(c: { unread?: number; total?: number } | undefined): Pick<Label, 'unreadCount' | 'totalCount'> {
  const out: Pick<Label, 'unreadCount' | 'totalCount'> = {};
  if (c?.unread !== undefined) out.unreadCount = c.unread;
  if (c?.total !== undefined) out.totalCount = c.total;
  return out;
}
