import type { View } from '../../router/routes';
import { useUi } from '../../state/ui';
import type { IconName } from '../../ui/Icon';

export type ListFilter = 'unread' | 'starred' | 'attachment' | 'important';

/** Each narrows the open view by adding a search operator. */
export const LIST_FILTERS: { id: ListFilter; label: string; icon: IconName; token: string }[] = [
  { id: 'unread', label: 'Unread', icon: 'mark_email_unread', token: 'is:unread' },
  { id: 'starred', label: 'Starred', icon: 'star', token: 'is:starred' },
  { id: 'attachment', label: 'Has attachment', icon: 'attach_file', token: 'has:attachment' },
  { id: 'important', label: 'Important', icon: 'label_important', token: 'is:important' },
];

export function filteredQuery(q: string, filters: ListFilter[]) {
  if (!filters.length) return q;
  const tokens = LIST_FILTERS.filter((f) => filters.includes(f.id)).map((f) => f.token);
  return [q, ...tokens.filter((t) => !q.split(/\s+/).includes(t))].join(' ');
}

const NONE: ListFilter[] = [];

export const viewKeyOf = (view: View) => JSON.stringify(view);

/** Only for the view they were set on. */
export function useListFilters(view: View): [ListFilter[], (next: ListFilter[]) => void] {
  const key = viewKeyOf(view);
  const stored = useUi((s) => s.listFilters);
  const owner = useUi((s) => s.listFiltersView);
  return [owner === key ? stored : NONE, (next) => useUi.getState().setListFilters(next, key)];
}

export function getListFilters(view: View): ListFilter[] {
  const { listFilters, listFiltersView } = useUi.getState();
  return listFiltersView === viewKeyOf(view) ? listFilters : NONE;
}
