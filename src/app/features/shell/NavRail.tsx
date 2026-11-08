import { ContextMenu } from '@base-ui/react/context-menu';
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLabels } from '../../data/hooks';
import type { Label } from '../../data/types';
import { sameView, type View } from '../../router/routes';
import { navigate, useRoute } from '../../router/useRoute';
import { useSettings } from '../../state/settings';
import { useUi } from '../../state/ui';
import { Fab, IconButton, cx } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { Ripple } from '../../ui/Ripple';
import { Tooltip } from '../../ui/Tooltip';
import { labelDotColor } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { LabelEditor } from '../labels/LabelEditor';
import { LabelOptions } from '../labels/LabelOptions';
import { backend } from '../../data/client';
import { SplitEditor } from '../splits/SplitEditor';
import { useLocal } from '../../state/local';
import { newCompose } from '../compose/open';
import { MenuItem, MenuSections, MenuSeparator } from '../../ui/Menu';
import { snack } from '../../ui/Snackbar';
import { Brand } from './TopBar';
import { NAV_META, PINNED, moveItem, placeOf, railLayout, type NavId, type SidebarPrefs } from './sidebarLayout';
import { updateSidebar, useSidebar } from './useSidebar';

interface NavItem {
  /** Set on the destinations Settings > Sidebar arranges. */
  id?: NavId;
  view: View;
  label: string;
  icon: IconName;
  count?: number;
  /** Bold when it has unread mail, like Gmail. */
  emphasize?: boolean;
  /** Total instead of unread (Drafts, Scheduled). */
  muted?: boolean;
}

const folder = (f: Extract<View, { kind: 'folder' }>['folder']): View => ({ kind: 'folder', folder: f });

const NO_AI_INBOX: ReadonlySet<NavId> = new Set(['ai-inbox']);
const PAGES = ['purchases', 'subscriptions', 'attachments', 'storage', 'reminders', 'ai-inbox'] as const;
const navView = (id: NavId): View =>
  (PAGES as readonly string[]).includes(id) ? ({ kind: id } as View) : folder(id as Extract<View, { kind: 'folder' }>['folder']);

export function NavRail({
  mode,
  openMore,
  closing,
  onMenu,
  onClose,
}: {
  mode: 'expanded' | 'collapsed' | 'modal';
  /** Opened from the collapsed rail's More. */
  openMore?: boolean;
  /** Modal rail on its way out. */
  closing?: boolean;
  /** The only thing that expands or collapses it (WideNavigationRail header). */
  onMenu?: () => void;
  onClose?: () => void;
}) {
  const route = useRoute();
  const { data: labels = [], isFetched: labelsIn } = useLabels();
  // The first labels land without fading in: a lone colour fade on Inbox as mail loads reads as a flicker.
  const [settled, setSettled] = useState(labelsIn);
  useEffect(() => {
    if (!labelsIn || settled) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [labelsIn, settled]);
  const splits = useSettings((s) => s.splits);
  const reminders = useLocal((s) => s.reminders);
  const [labelEditor, setLabelEditor] = useState<{ open: boolean; label?: Label; parent?: string }>({ open: false });
  const [splitEditor, setSplitEditor] = useState(false);
  const editLabel = useCallback((label: Label) => setLabelEditor({ open: true, label }), []);
  const addSublabel = useCallback((parent: string) => setLabelEditor({ open: true, parent }), []);
  const labelsEditable = backend().capabilities.labelsEdit;
  const byId = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);
  const unread = (id: string) => byId.get(id)?.unreadCount ?? 0;
  const total = (id: string) => byId.get(id)?.totalCount ?? 0;

  const sidebar = useSidebar();
  // Like Gmail, Scheduled sits with the main folders while something waits to send. AI Inbox stays out of the sidebar for now; its page still opens by address.
  const layout = railLayout(sidebar, { scheduledWaiting: total('SCHEDULED') > 0, unavailable: NO_AI_INBOX });
  const extra: Partial<Record<NavId, Omit<NavItem, 'view' | 'label' | 'icon'>>> = {
    inbox: { count: unread('INBOX'), emphasize: true },
    scheduled: { count: total('SCHEDULED'), muted: true },
    drafts: { count: total('DRAFT'), muted: true, emphasize: true },
    spam: { count: unread('SPAM'), emphasize: true },
    reminders: { count: reminders.filter((r) => r.due <= Date.now()).length, emphasize: true },
  };
  const itemFor = (id: NavId): NavItem => ({ id, view: navView(id), ...NAV_META[id], ...extra[id] });
  const primary = layout.main.map(itemFor);
  const more = layout.more.map(itemFor);

  const current = route.view.kind === 'category' && route.view.category === 'primary' ? folder('inbox') : route.view;
  const moreActive = more.some((m) => sameView(m.view, current));
  // A reload into Trash or Spam starts with More open, instead of opening it on the first frame.
  const [moreOpen, setMoreOpen] = useState(!!openMore || moreActive);
  useEffect(() => {
    if (moreActive) setMoreOpen(true);
  }, [moreActive]);

  // Stable, so the memoized rail items skip the re-render every navigation causes.
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  const go = useCallback((view: View) => {
    useUi.getState().clearSelection();
    navigate({ view });
    closeRef.current?.();
  }, []);

  const expanded = mode !== 'collapsed';
  // Splits, labels and More stay mounted a beat after collapsing so they fade out.
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  const [extrasLeaving, setExtrasLeaving] = useState(false);
  if (prevExpanded !== expanded) {
    setPrevExpanded(expanded);
    setExtrasLeaving(!expanded);
  }
  useEffect(() => {
    if (!extrasLeaving) return;
    const t = window.setTimeout(() => setExtrasLeaving(false), 150);
    return () => window.clearTimeout(t);
  }, [extrasLeaving]);
  const extras = expanded || extrasLeaving;
  const userLabels = labels
    .filter((l) => l.type === 'user' && !l.hidden && !l.name.startsWith('['))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  // As wide as its widest item (WideNavigationRail clamps to 220-360px), on the 4px grid. The grid and modal rail read the same variable.
  const navRef = useRef<HTMLElement>(null);
  // A count changing may widen the rail but never narrows it: the layout moving a few pixels on every read looks like a flicker.
  const sized = useRef({ shape: '', width: 0 });
  // A first run has no cached labels: paint at the default width, then keep it if they'd fit in less, so the panes don't shift sideways.
  const waited = useRef(false);
  const shape = `${mode}|${layout.main.join()}|${layout.more.join()}|${layout.sections.join()}|${userLabels.map((l) => l.name).join('/')}|${splits.map((sp) => sp.name).join('/')}`;
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !expanded) return;
    if (!labelsIn) {
      waited.current = true;
      return;
    }
    const measure = (exact = false) => {
      let widest = 0;
      nav.querySelectorAll<HTMLElement>('.rail-item__pill').forEach((pill) => {
        const label = pill.querySelector<HTMLElement>('.rail-item__label');
        const count = pill.querySelector<HTMLElement>('.rail-item__count');
        const item = pill.parentElement as HTMLElement;
        const start = parseFloat(getComputedStyle(item).paddingLeft) || 20;
        // 16 + icon 24 + 8 + label (+ 12 + count) + 16, then room to breathe.
        const w = start + 64 + (label?.scrollWidth ?? 0) + (count ? 12 + count.offsetWidth : 0) + 16;
        widest = Math.max(widest, w);
      });
      let px = Math.ceil(Math.min(360, Math.max(220, widest)) / 4) * 4;
      if (!exact && sized.current.shape === shape) px = Math.max(px, sized.current.width);
      const app = document.querySelector<HTMLElement>('.app');
      if (waited.current && app) {
        px = Math.max(px, parseFloat(getComputedStyle(app).getPropertyValue('--app-rail-expanded')) || 0);
      }
      sized.current = { shape, width: px };
      const width = `${px}px`;
      // A custom property on .app restyles the whole app in WebKit, so only write it when it changes.
      if (app && app.style.getPropertyValue('--app-rail-expanded') !== width) app.style.setProperty('--app-rail-expanded', width);
    };
    measure();
    // Measured with a fallback font: measure again once the real one is in.
    if (document.fonts && document.fonts.status !== 'loaded')
      void document.fonts.ready.then(() => {
        measure(true);
        waited.current = false;
      });
    else waited.current = false;
  }, [expanded, mode, labels, labelsIn, splits, reminders, shape]);

  // The modal rail takes focus: the first More destination when opened from More, else the close button. Focus goes back when it closes.
  useEffect(() => {
    if (mode !== 'modal') return;
    const back = document.activeElement as HTMLElement | null;
    const nav = navRef.current;
    const first = openMore ? nav?.querySelector<HTMLElement>('.rail__more .rail-item') : nav?.querySelector<HTMLElement>('.rail__header button');
    // A pointer-opened rail shouldn't land with a focus ring (WebKit shows one for script focus).
    const keyboard = back?.matches(':focus-visible') ?? false;
    first?.focus({ preventScroll: true, focusVisible: keyboard } as FocusOptions);
    return () => {
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [mode, openMore]);

  // The editors' dialogs sit out the expand and collapse commits.
  const editors = useMemo(
    () => (
      <>
        <LabelEditor state={labelEditor} onClose={() => setLabelEditor({ open: false })} />
        <SplitEditor open={splitEditor} onClose={() => setSplitEditor(false)} />
      </>
    ),
    [labelEditor, splitEditor],
  );

  const content = (
    <nav
      ref={navRef}
      className={cx('rail', mode === 'modal' ? 'rail--modal' : expanded ? 'rail--expanded' : 'rail--collapsed')}
      data-pending={!settled || undefined}
      aria-label="Mailboxes"
      onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
    >
      <div className="rail__header">
        {mode === 'modal' ? (
          <IconButton icon="menu_open" label="Close menu" onClick={onClose} />
        ) : (
          onMenu && (
            <div className="rail__top">
              <MenuButton open={mode === 'expanded'} onClick={onMenu} />
              {expanded && <Brand />}
            </div>
          )
        )}
        <Fab
          icon="edit"
          label="Compose"
          extended={expanded}
          filledIcon
          lowered
          className="rail__fab"
          onClick={() => {
            newCompose();
            onClose?.();
          }}
        />
      </div>
      <div className="rail__scroll">
        <div className="rail__body">
        <ul className="rail__list rail__primary" role="list">
          {primary.map((item) => (
            <RailItem key={item.label} item={item} active={sameView(item.view, current)} onSelect={go} morph />
          ))}
          {expanded ? (
            more.length > 0 && (
            <li>
              <button
                type="button"
                className="rail-item rail-item--toggle"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              >
                <span className="rail-item__pill">
                  <span className="rail-item__active" data-morph="More:ind" data-morph-kind="size" />
                  <span className="rail-item__indicator" data-morph="More:icon">
                    <Icon name="expand_more" size={24} className="rail-item__chevron" />
                  </span>
                  <span className="rail-item__text" data-morph="More:text" data-morph-kind="text">
                    {/* Both words share one cell and cross-fade, so the pill never changes width. */}
                    <span className="rail-item__label rail-item__swap">
                      <span data-on={!moreOpen || undefined} aria-hidden={moreOpen || undefined}>
                        More
                      </span>
                      <span data-on={moreOpen || undefined} aria-hidden={!moreOpen || undefined}>
                        Less
                      </span>
                    </span>
                  </span>
                  <Ripple />
                </span>
              </button>
            </li>
            )
          ) : (
            (more.length > 0 || layout.sections.length > 0) && (
            <RailItem
              item={{ view: folder('all'), label: 'More', icon: 'more_horiz' }}
              active={moreActive}
              onSelect={() => useUi.getState().set({ railOpenModal: 'more' })}
              morph
            />
            )
          )}
          {extras && more.length > 0 && (
            <li className="rail__more" data-open={moreOpen || undefined} data-leaving={!expanded || undefined} data-morph="more-extras" data-morph-enter>
              <ul className="rail__more-inner" role="list">
                {more.map((item, i) => (
                  <RailItem
                    key={item.label}
                    item={item}
                    active={sameView(item.view, current)}
                    onSelect={go}
                    inert={!moreOpen || !expanded}
                    order={i}
                  />
                ))}
              </ul>
            </li>
          )}
        </ul>

        {extras && layout.sections.length > 0 && (
          <div className="rail__extras" data-leaving={!expanded || undefined} data-morph="extras" data-morph-enter>
            {layout.sections.map((section) =>
              section === 'splits' ? (
                <Fragment key="splits">
                  <SectionHeader title="Splits" actionLabel="Create split" onAction={() => setSplitEditor(true)} />
                  <ul className="rail__list" role="list">
                    {splits.length === 0 && (
                      <li className="rail__hint md-body-small">Turn any search into its own inbox tab.</li>
                    )}
                    {splits.map((s) => (
                      <RailItem
                        key={s.id}
                        item={{ view: { kind: 'split', id: s.id }, label: s.name, icon: (s.icon as IconName) ?? 'filter_alt' }}
                        active={sameView({ kind: 'split', id: s.id }, current)}
                        onSelect={go}
                      />
                    ))}
                  </ul>
                </Fragment>
              ) : (
                <Fragment key="labels">
                  <SectionHeader title="Labels" actionLabel="Create new label" onAction={() => setLabelEditor({ open: true })} />
                  <ul className="rail__list" role="list">
                    {userLabels.map((l) => (
                      <LabelItem
                        key={l.id}
                        label={l}
                        active={current.kind === 'label' && current.label === l.name}
                        onSelect={go}
                        onEdit={labelsEditable ? editLabel : undefined}
                        onAddSublabel={addSublabel}
                      />
                    ))}
                  </ul>
                </Fragment>
              ),
            )}
          </div>
        )}
        </div>
      </div>
      {editors}
      {/* Morph.tsx fades labels out from here when they change layout. */}
      <div className="rail__ghosts" aria-hidden="true" />
    </nav>
  );

  if (mode !== 'modal') return content;
  return (
    <div className="rail-modal" role="dialog" aria-modal="true" aria-label="Menu" data-closing={closing || undefined} data-morph-off={closing || undefined}>
      <div className="rail-modal__scrim" onClick={onClose} />
      {content}
    </div>
  );
}

/** Both glyphs stay mounted and swap in place: one turns and shrinks away as the other turns in. The container keeps the icon button's press shape. */
function MenuButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const label = open ? 'Collapse menu' : 'Expand menu';
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="m3-icon-button m3-icon-button--standard m3-size--s m3-width--default rail__menu"
        data-open={open || undefined}
        onClick={onClick}
      >
        <span className="rail__menu-icons">
          <Icon name="menu" size={24} className="rail__menu-glyph rail__menu-glyph--closed" />
          <Icon name="menu_open" size={24} className="rail__menu-glyph rail__menu-glyph--open" />
        </span>
        <Ripple />
      </button>
    </Tooltip>
  );
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel: string; onAction: () => void }) {
  return (
    <div className="rail__section">
      <h2 className="md-title-small rail__section-title">{title}</h2>
      <IconButton icon="add" label={actionLabel} size="xs" onClick={onAction} />
    </div>
  );
}

const sameItem = (a: NavItem, b: NavItem) =>
  a.id === b.id &&
  a.label === b.label && a.icon === b.icon && a.count === b.count && a.emphasize === b.emphasize && a.muted === b.muted && sameView(a.view, b.view);

const RailItem = memo(
  RailItemImpl,
  (a, b) =>
    a.active === b.active &&
    a.onSelect === b.onSelect &&
    a.inert === b.inert &&
    a.morph === b.morph &&
    a.order === b.order &&
    sameItem(a.item, b.item),
);

function RailItemImpl({
  item,
  active,
  onSelect,
  inert,
  morph,
  order,
}: {
  item: NavItem;
  active: boolean;
  onSelect: (v: View) => void;
  inert?: boolean;
  /** So the parts morph between the collapsed and expanded layouts. */
  morph?: boolean;
  /** For the stagger in a revealed group. */
  order?: number;
}) {
  const count = item.count ?? 0;
  const strong = item.emphasize && count > 0 && !item.muted;
  const key = (part: string) => (morph ? `${item.label}:${part}` : undefined);
  const button = (
    <a
      href={`#${item.view.kind === 'folder' ? item.view.folder : item.view.kind}`}
      className={cx('rail-item', strong && 'rail-item--unread')}
      aria-current={active ? 'page' : undefined}
      data-active={active || undefined}
      tabIndex={inert ? -1 : undefined}
      onClick={(e) => {
        e.preventDefault();
        onSelect(item.view);
      }}
    >
      <span className="rail-item__pill">
        <span className="rail-item__active" data-morph={key('ind')} data-morph-kind="size" />
        <span className="rail-item__indicator" data-morph={key('icon')}>
          <Icon name={item.icon} size={24} filled={active} />
          {count > 0 && !item.muted && (
            <span className="rail-badge" aria-hidden="true">
              {count > 999 ? '999+' : count}
            </span>
          )}
        </span>
        {/* Label and count move as one. */}
        <span className="rail-item__text" data-morph={key('text')} data-morph-kind="text">
          <span className="rail-item__label">{item.label}</span>
          {count > 0 && (
            <span className="rail-item__count" aria-label={`${count} ${item.muted ? 'total' : 'unread'}`}>
              {count.toLocaleString()}
            </span>
          )}
        </span>
        <Ripple />
      </span>
    </a>
  );
  // No tooltip: the label is always on screen.
  const style = order === undefined ? undefined : ({ '--rail-order': order } as CSSProperties);
  if (!item.id) return <li style={style}>{button}</li>;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={<li style={style} />}>{button}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="m3-menu-positioner" collisionPadding={8}>
          <ContextMenu.Popup className="m3-menu">
            <ArrangeItems id={item.id} label={item.label} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** The quick moves from Settings > Sidebar, and the way there. */
function ArrangeItems({ id, label }: { id: NavId; label: string }) {
  const place = placeOf(useSidebar(), id);
  const arrange = (change: (p: SidebarPrefs) => SidebarPrefs, done: string) => {
    let before: SidebarPrefs | undefined;
    updateSidebar((p) => {
      before = p;
      return change(p);
    });
    snack(done, { action: { label: 'Undo', onClick: () => before && updateSidebar(() => before!) } });
  };
  return (
    <MenuSections>
      {!PINNED.has(id) && (
        <>
          {place === 'main' ? (
            <MenuItem icon="expand_more" onClick={() => arrange((p) => moveItem(p, id, 'more'), `${label} moved to More`)}>
              Move to More
            </MenuItem>
          ) : (
            <MenuItem icon="keyboard_arrow_up" onClick={() => arrange((p) => moveItem(p, id, 'main'), `${label} always shows`)}>
              Always show
            </MenuItem>
          )}
          <MenuItem icon="visibility_off" onClick={() => arrange((p) => moveItem(p, id, 'hidden'), `${label} hidden from the sidebar`)}>
            Hide from sidebar
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      <MenuItem icon="side_navigation" onClick={() => useUi.getState().set({ settingsSection: 'sidebar' })}>
        Customize sidebar
      </MenuItem>
    </MenuSections>
  );
}

const LabelItem = memo(function LabelItem({
  label,
  active,
  onSelect,
  onEdit,
  onAddSublabel,
}: {
  label: Label;
  active: boolean;
  onSelect: (v: View) => void;
  /** Present when the connection can edit labels. */
  onEdit?: (label: Label) => void;
  onAddSublabel: (parent: string) => void;
}) {
  const dark = useResolvedDark();
  const [options, setOptions] = useState(false);
  const depth = label.name.split('/').length - 1;
  const name = label.name.split('/').pop()!;
  const color = label.color ? labelDotColor(label.color.background, dark) : undefined;
  const count = label.unreadCount ?? 0;
  return (
    <li className="rail-label" data-options={options || undefined}>
      <a
        href={`#label/${encodeURIComponent(label.name)}`}
        className={cx('rail-item', count > 0 && 'rail-item--unread')}
        aria-current={active ? 'page' : undefined}
        data-active={active || undefined}
        style={depth ? { paddingLeft: `calc(var(--rail-item-start) + ${depth * 16}px)` } : undefined}
        onClick={(e) => {
          e.preventDefault();
          onSelect({ kind: 'label', label: label.name });
        }}
        onContextMenu={
          onEdit
            ? (e) => {
                e.preventDefault();
                setOptions(true);
              }
            : undefined
        }
        title={label.name}
      >
        <span className="rail-item__pill">
          <span className="rail-item__active" />
          <span className="rail-item__indicator">
            <Icon name="label" size={24} filled={!!color || active} style={color ? { color } : undefined} />
          </span>
          <span className="rail-item__text">
            <span className="rail-item__label">{name}</span>
            {count > 0 && <span className="rail-item__count">{count.toLocaleString()}</span>}
          </span>
          <Ripple />
        </span>
      </a>
      {onEdit && <LabelOptions label={label} open={options} onOpenChange={setOptions} onEdit={onEdit} onAddSublabel={onAddSublabel} />}
    </li>
  );
});
