import { navigate } from '../../router/useRoute';
import { Chip } from '../../ui/Chip';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { getOperator, hasToken, setOperator, toggleToken } from './query';

const TIMES: [string, string][] = [
  ['newer_than:1d', 'Today'],
  ['newer_than:7d', 'Last 7 days'],
  ['newer_than:1m', 'Last 30 days'],
  ['newer_than:6m', 'Last 6 months'],
  ['newer_than:1y', 'Last year'],
  ['older_than:1y', 'Older than a year'],
];

/** Gmail's search chips, editing the query in place. One sideways-scrolling row, as on Gmail Android. */
export function SearchChips({ query }: { query: string }) {
  const go = (q: string) => q.trim() && navigate({ view: { kind: 'search', query: q } });
  const time = TIMES.find(([t]) => hasToken(query, (x) => x === t));
  const from = getOperator(query, 'from');
  const to = getOperator(query, 'to');
  const withoutTime = query.split(/\s+/).filter((tok) => !TIMES.some(([t]) => t === tok)).join(' ');

  return (
    <div className="search-chips search-chips--scroll" role="toolbar" aria-label="Search filters">
      <Menu trigger={<Chip kind="filter" dropdown selected={!!from}>{from ? `From: ${from}` : 'From'}</Chip>}>
        {from && <MenuItem icon="close" onClick={() => go(setOperator(query, 'from', null))}>Any sender</MenuItem>}
        <MenuItem icon="person" onClick={() => go(setOperator(query, 'from', 'me'))}>Me</MenuItem>
      </Menu>
      <Menu trigger={<Chip kind="filter" dropdown selected={!!time}>{time ? time[1] : 'Any time'}</Chip>}>
        <MenuItem onClick={() => go(withoutTime || 'in:anywhere')}>Any time</MenuItem>
        <MenuSeparator />
        {TIMES.map(([t, label]) => (
          <MenuItem key={t} onClick={() => go(`${withoutTime} ${t}`)}>
            {label}
          </MenuItem>
        ))}
      </Menu>
      <Chip kind="filter" selected={hasToken(query, (t) => t === 'has:attachment')} onClick={() => go(toggleToken(query, 'has:attachment'))}>
        Has attachment
      </Chip>
      <Menu trigger={<Chip kind="filter" dropdown selected={!!to}>{to ? `To: ${to}` : 'To'}</Chip>}>
        {to && <MenuItem icon="close" onClick={() => go(setOperator(query, 'to', null))}>Anyone</MenuItem>}
        <MenuItem icon="person" onClick={() => go(setOperator(query, 'to', 'me'))}>Me</MenuItem>
      </Menu>
      <Chip kind="filter" selected={hasToken(query, (t) => t === 'is:unread')} onClick={() => go(toggleToken(query, 'is:unread'))}>
        Is unread
      </Chip>
      <Chip kind="filter" selected={hasToken(query, (t) => t === '-in:chats')} onClick={() => go(toggleToken(query, '-in:chats'))}>
        Exclude chats
      </Chip>
    </div>
  );
}
