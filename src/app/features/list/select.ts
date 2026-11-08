import { getVisibleThreadIds } from '../../data/actions';
import type { ThreadSummary } from '../../data/types';
import { useUi } from '../../state/ui';

export function selectWhere(threads: ThreadSummary[], pred: (t: ThreadSummary) => boolean) {
  return new Set(threads.filter(pred).map((t) => t.id));
}

/** The last row checked or unchecked by hand; Shift ranges start here. By id, so archiving above it can't move it. */
let anchor: string | null = null;

/** The anchor moves to it. */
export function toggleOne(id: string) {
  useUi.getState().toggleSelected(id);
  anchor = id;
}

export interface RangePlan {
  /** In list order. */
  ids: string[];
  on: boolean;
}

/** Gmail style: the whole range takes the anchor's state, or flips when that would change nothing. Null without an anchor in the list. */
export function rangePlan(id: string, ids = getVisibleThreadIds(), selected = useUi.getState().selected): RangePlan | null {
  if (!anchor || anchor === id) return null;
  const a = ids.indexOf(anchor);
  const b = ids.indexOf(id);
  if (a < 0 || b < 0) return null;
  const span = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  let on = selected.has(anchor);
  let change = span.filter((x) => selected.has(x) !== on);
  if (!change.length) {
    on = !on;
    change = span.filter((x) => selected.has(x) !== on);
  }
  return { ids: change, on };
}

/** Toggles one row when there's no anchor to range from. */
export function selectRangeTo(id: string) {
  const plan = rangePlan(id);
  if (!plan) return toggleOne(id);
  const ui = useUi.getState();
  const next = new Set(ui.selected);
  for (const x of plan.ids) {
    if (plan.on) next.add(x);
    else next.delete(x);
  }
  ui.setSelected(next);
  anchor = id;
}
