import { keys, queryClient } from '../../data/client';
import type { Label } from '../../data/types';
import { useSettingsStore, type Settings } from '../../state/settings';

const CONTENT: (keyof Settings)[] = ['inboxType', 'categories', 'pageSize', 'splits'];
/** Only change row height, so the open one drifts. */
const LAYOUT: (keyof Settings)[] = ['density', 'showSnippets', 'showLabelChips', 'groupByDate', 'showAvatars', 'smartFeatures'];

export interface ListPlace {
  content: string;
  layout: string;
  /** The open (or only selected) conversation's distance from the top of the list's viewport. */
  offset?: number;
  anchor?: 'active' | 'selected';
}

function pick(keys: (keyof Settings)[]) {
  const s = useSettingsStore.getState().settings;
  return JSON.stringify(keys.map((k) => s[k]));
}

function labelsShown() {
  const labels = queryClient.getQueryData<Label[]>(keys.labels) ?? [];
  return labels.map((l) => `${l.id}:${l.hidden ? 0 : 1}`).join(',');
}

function scroller() {
  return document.querySelector<HTMLElement>('.list-scroll');
}

function anchorRow(list: HTMLElement, anchor: ListPlace['anchor']) {
  if (anchor === 'active') return list.querySelector<HTMLElement>('.row[aria-current="true"]');
  const selected = list.querySelectorAll<HTMLElement>('.row--selected');
  return selected.length === 1 ? selected[0]! : null;
}

export function captureListPlace(): ListPlace {
  const place: ListPlace = { content: pick(CONTENT) + labelsShown(), layout: pick(LAYOUT) };
  const list = scroller();
  if (!list) return place;
  for (const anchor of ['active', 'selected'] as const) {
    const row = anchorRow(list, anchor);
    if (!row) continue;
    place.anchor = anchor;
    place.offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    break;
  }
  return place;
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Brings the open conversation back to where it sat, centered if it had scrolled out of view. */
export async function restoreListPlace(before: ListPlace) {
  const contentChanged = pick(CONTENT) + labelsShown() !== before.content;
  if (!contentChanged && pick(LAYOUT) === before.layout) return;
  // The old rows stay up while the new ones load, so there's nothing to flash.
  if (contentChanged) await queryClient.refetchQueries({ queryKey: keys.allThreads, type: 'active' }).catch(() => undefined);
  await frame();
  await frame();
  const list = scroller();
  if (!list || !before.anchor) return;
  const first = anchorRow(list, before.anchor);
  if (!first) return;
  const seen = before.offset !== undefined && before.offset >= 0 && before.offset + first.offsetHeight <= list.clientHeight;
  const want = seen ? before.offset! : (list.clientHeight - first.offsetHeight) / 2;
  // Rows and headers settle over a few hundred milliseconds; hold the conversation on its line until then.
  let stop = false;
  const takeOver = () => (stop = true);
  const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  for (const e of events) list.addEventListener(e, takeOver, { passive: true, once: true });
  const started = performance.now();
  while (!stop && performance.now() - started < 700) {
    const row = anchorRow(list, before.anchor);
    if (!row) break;
    const drift = row.getBoundingClientRect().top - list.getBoundingClientRect().top - want;
    if (Math.abs(drift) >= 1) list.scrollTop += drift;
    await frame();
  }
  for (const e of events) list.removeEventListener(e, takeOver);
}
