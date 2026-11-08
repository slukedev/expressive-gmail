import { mail } from '../../data/actions';
import { keys, queryClient } from '../../data/client';
import type { ThreadSummary } from '../../data/types';
import { viewTitle } from '../../data/views';
import type { View } from '../../router/routes';
import { navigate } from '../../router/useRoute';
import { useSettings } from '../../state/settings';
import { useUi } from '../../state/ui';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { useRef, useState } from 'react';
import { useSpin } from '../../ui/feedback';
import { Menu, MenuCheckboxItem, MenuItem, MenuSeparator, Submenu } from '../../ui/Menu';
import { LIST_FILTERS, useListFilters } from './filters';
import { pauseInbox, pausePresets, resumeInbox, useInboxPause } from '../pause/pause';
import { presetTime } from '../../lib/presets';
import { selectWhere } from './select';
import { saveAsSplit } from '../search/split';
import { ShapeIcon } from '../../ui/ShapeIcon';
import { viewIdentity } from './viewIdentity';
import { useFocusedAccount, useScopeIdentity, useScopeTitle } from '../accounts/AccountBits';
import { useLabels } from '../../data/hooks';
import { useResolvedDark } from '../../theme/ThemeProvider';

/** One row, title and supporting line leading, actions trailing (M3 Expressive flexible app bar). Select-by options live in More. */
export function ListToolbar({
  view,
  threads,
  meta,
  metaPending,
  scrolled,
}: {
  view: View;
  threads: ThreadSummary[];
  meta: string | null;
  /** Keep the supporting line's room while it's on its way. */
  metaPending?: boolean;
  scrolled: boolean;
}) {
  const splits = useSettings((s) => s.splits);
  const savedSplit = view.kind === 'search' && splits.some((s) => s.query === view.query);
  const unread = threads.filter((t) => t.labelIds.includes('UNREAD'));
  const scopeTitle = useScopeTitle();
  const isInbox = view.kind === 'folder' && view.folder === 'inbox';
  // In All inboxes or a circle the inbox is named after it, like Gmail Android.
  const title = view.kind === 'search' ? 'Search results' : isInbox && scopeTitle ? scopeTitle : viewTitle(view, splits);
  const focused = useFocusedAccount();
  // Narrowed to one account: say so under the title, in every view.
  const scoped = scopeTitle && !isInbox ? [scopeTitle, meta] : [meta];
  const line = (focused ? [...scoped, `only ${focused.short}`] : scoped).filter(Boolean).join(' · ') || null;
  const isTrash = view.kind === 'folder' && view.folder === 'trash';
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  useSpin(refreshRef, refreshing);
  const isSpam = view.kind === 'folder' && view.folder === 'spam';
  const inboxLike = (view.kind === 'folder' && view.folder === 'inbox') || view.kind === 'category';
  const pause = useInboxPause();
  const select = (pred: (t: ThreadSummary) => boolean) => useUi.getState().setSelected(selectWhere(threads, pred));
  const { data: labels = [] } = useLabels();
  const dark = useResolvedDark();
  const scopeIdentity = useScopeIdentity();
  const identity = isInbox && scopeIdentity ? scopeIdentity : viewIdentity(view, labels, dark);

  return (
    <header className="list-bar" data-scrolled={scrolled || undefined}>
      {view.kind === 'category' && view.category !== 'primary' && (
        <IconButton icon="arrow_back" label="Back to Primary" onClick={() => navigate({ view: { kind: 'folder', folder: 'inbox' } })} />
      )}
      <ShapeIcon {...identity} size={48} className="list-bar__mark" />
      <div className="list-bar__titles">
        <h1 className="list-bar__title">{title}</h1>
        {line ? (
          <p className="list-bar__meta">{line}</p>
        ) : (
          metaPending && (
            <p className="list-bar__meta" aria-hidden="true">
              <span className="sk list-bar__meta-sk" />
            </p>
          )
        )}
      </div>
      <div className="list-bar__actions" role="toolbar" aria-label="List actions">
        {view.kind !== 'search' && <FilterMenu view={view} />}
        <IconButton
          icon="refresh"
          label="Refresh"
          shortcut="Shift N"
          className="list-bar__refresh"
          ref={refreshRef}
          aria-busy={refreshing || undefined}
          onClick={() => {
            setRefreshing(true);
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: keys.allThreads }),
              queryClient.invalidateQueries({ queryKey: keys.labels }),
            ]).finally(() => setRefreshing(false));
          }}
        />
        <Menu trigger={<IconButton icon="more_vert" label="More" />} align="end">
          <Submenu icon="check_box" label="Select">
            <MenuItem onClick={() => select(() => true)} shortcut="* a">All</MenuItem>
            <MenuItem onClick={() => select(() => false)} shortcut="* n">None</MenuItem>
            <MenuItem onClick={() => select((t) => !t.labelIds.includes('UNREAD'))} shortcut="* r">Read</MenuItem>
            <MenuItem onClick={() => select((t) => t.labelIds.includes('UNREAD'))} shortcut="* u">Unread</MenuItem>
            <MenuItem onClick={() => select((t) => t.labelIds.includes('STARRED'))} shortcut="* s">Starred</MenuItem>
            <MenuItem onClick={() => select((t) => !t.labelIds.includes('STARRED'))} shortcut="* t">Unstarred</MenuItem>
          </Submenu>
          <MenuItem icon="done_all" disabled={!unread.length} onClick={() => void mail.markRead(unread.map((t) => t.id), true)}>
            Mark all as read
          </MenuItem>
          {view.kind === 'search' && (
            <MenuItem icon={savedSplit ? 'check' : 'tab'} disabled={savedSplit} onClick={() => saveAsSplit(view.query)}>
              {savedSplit ? 'Saved as split' : 'Save as split'}
            </MenuItem>
          )}
          {(isTrash || isSpam) && (
            <MenuItem icon="delete_forever" danger disabled={!threads.length} onClick={() => setConfirmEmpty(true)}>
              {isTrash ? 'Empty Trash now' : 'Delete all spam now'}
            </MenuItem>
          )}
          {inboxLike && <MenuSeparator />}
          {inboxLike &&
            (pause ? (
              <MenuItem icon="play_arrow" onClick={resumeInbox}>
                Resume inbox
              </MenuItem>
            ) : (
              <Submenu icon="pause" label="Pause inbox">
                {pausePresets().map((p) => (
                  <MenuItem key={p.id} onClick={() => pauseInbox(p.until)} trailing={p.until ? <span className="menu-time">{presetTime(p.until)}</span> : undefined}>
                    {p.label}
                  </MenuItem>
                ))}
              </Submenu>
            ))}
        </Menu>
      </div>
      <Dialog
        open={confirmEmpty}
        onOpenChange={setConfirmEmpty}
        icon="delete_forever"
        title={isTrash ? 'Empty Trash?' : 'Delete all spam?'}
        description={`Everything in ${isTrash ? 'Trash' : 'Spam'} will be deleted forever. You can't undo this.`}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirmEmpty(false)}>
              Cancel
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setConfirmEmpty(false);
                void mail.emptyFolder(isTrash ? 'trash' : 'spam');
              }}
            >
              {isTrash ? 'Empty Trash' : 'Delete all spam'}
            </Button>
          </>
        }
      />
    </header>
  );
}

function FilterMenu({ view }: { view: View }) {
  const [filters, setFilters] = useListFilters(view);
  const on = filters.length > 0;
  return (
    <Menu
      trigger={
        <IconButton
          icon="filter_list"
          label={on ? `Filters: ${LIST_FILTERS.filter((f) => filters.includes(f.id)).map((f) => f.label).join(', ')}` : 'Filter conversations'}
          variant={on ? 'tonal' : 'standard'}
        />
      }
    >
      {LIST_FILTERS.map((f) => (
        <MenuCheckboxItem
          key={f.id}
          icon={f.icon}
          checked={filters.includes(f.id)}
          onCheckedChange={(checked) =>
            setFilters(checked ? [...filters, f.id] : filters.filter((x) => x !== f.id))
          }
        >
          {f.label}
        </MenuCheckboxItem>
      ))}
      {on && <MenuSeparator />}
      {on && (
        <MenuItem icon="close" onClick={() => setFilters([])}>
          Clear filters
        </MenuItem>
      )}
    </Menu>
  );
}
