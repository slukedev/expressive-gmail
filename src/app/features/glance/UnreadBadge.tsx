import { useEffect, useRef, useState } from 'react';
import { useLabels } from '../../data/hooks';
import { getRoute, openView, useRoute } from '../../router/useRoute';
import type { View } from '../../router/routes';
import { useUi } from '../../state/ui';
import { Icon } from '../../ui/Icon';
import { Tooltip } from '../../ui/Tooltip';
import { getListFilters, useListFilters, viewKeyOf } from '../list/filters';

const INBOX: View = { kind: 'folder', folder: 'inbox' };
const isInbox = (v: View) => (v.kind === 'folder' && v.folder === 'inbox') || v.kind === 'category';

/** Opening the inbox first if another view is up. */
function toggleUnreadInbox() {
  const current = getRoute().view;
  const view = isInbox(current) ? current : INBOX;
  if (view !== current) openView(INBOX);
  const filters = getListFilters(view);
  useUi.getState().setListFilters(filters.includes('unread') ? filters.filter((f) => f !== 'unread') : [...filters, 'unread'], viewKeyOf(view));
}

const compact = (n: number) => (n > 999 ? '999+' : n.toLocaleString());

/** Pressing it narrows the inbox to unread, and again shows everything. Reading the last one turns it into a check and lifts the picture. */
export function UnreadBadge({ onCleared }: { onCleared: () => void }) {
  const { data: labels } = useLabels();
  const route = useRoute();
  const view = isInbox(route.view) ? route.view : INBOX;
  const [filters] = useListFilters(view);
  const on = filters.includes('unread');
  const count = labels?.find((l) => l.id === 'INBOX')?.unreadCount;

  // New mail pops the badge; the last unread read turns it into a check.
  const last = useRef(count);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const before = last.current;
    last.current = count;
    if (before === undefined || count === undefined || before === count) return;
    if (count > before) setBump((b) => b + 1);
    if (before > 0 && count === 0) onCleared();
  }, [count, onCleared]);

  if (count === undefined) return null;
  if (count === 0 && !on) {
    return (
      <Tooltip content="No unread mail in your inbox">
        <span className="glance-badge glance-badge--clear" role="img" aria-label="No unread mail">
          <Icon name="done_all" size={16} />
        </span>
      </Tooltip>
    );
  }
  const label = on ? 'Show all conversations' : `Show only unread (${count.toLocaleString()})`;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className="glance-badge"
        aria-pressed={on}
        aria-label={on ? `Showing only unread, ${count.toLocaleString()} unread. Show all conversations` : `${count.toLocaleString()} unread. Show only unread`}
        data-on={on || undefined}
        onClick={toggleUnreadInbox}
      >
        <span className="glance-badge__icon" aria-hidden="true">
          <Icon name="mark_email_unread" size={16} filled />
        </span>
        <span key={bump} className="glance-badge__count" data-bump={bump > 0 || undefined}>
          {compact(count)}
        </span>
      </button>
    </Tooltip>
  );
}
