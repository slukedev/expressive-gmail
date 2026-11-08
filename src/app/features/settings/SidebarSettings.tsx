import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useCapabilities } from '../../data/useBackendKind';
import { useSettings } from '../../state/settings';
import { Button, IconButton } from '../../ui/Button';
import { announce } from '../../ui/feedback';
import { Icon, type IconName } from '../../ui/Icon';
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../../ui/Menu';
import { motionToken, reducedMotion } from '../../ui/motion';
import { Switch } from '../../ui/Switch';
import {
  DEFAULT_SIDEBAR,
  NAV_META,
  PINNED,
  PLACES,
  isDefaultSidebar,
  moveItem,
  moveSection,
  showSection,
  stepItem,
  stepSection,
  type NavId,
  type Place,
  type SectionId,
  type SidebarPrefs,
} from '../shell/sidebarLayout';
import { updateSidebar, useSidebar } from '../shell/useSidebar';

const PLACE_NAMES: Record<Place, string> = { main: 'Always shown', more: 'Under More', hidden: 'Hidden' };
const SECTION_META: Record<SectionId, { label: string; icon: IconName }> = {
  splits: { label: 'Splits', icon: 'filter_alt' },
  labels: { label: 'Labels', icon: 'label' },
};

export function SidebarSettings() {
  const saved = useSidebar();
  // AI Inbox isn't in the sidebar for now: left out of every place and step counted here, and saved back unchanged.
  const prefs = useMemo(() => ({ ...saved, items: saved.items.filter((x) => x.id !== 'ai-inbox') }), [saved]);
  const caps = useCapabilities();
  const splits = useSettings((s) => s.splits);
  const list = useRef<HTMLDivElement>(null);
  const sectionList = useRef<HTMLDivElement>(null);
  const flip = useFlip(prefs);

  const change = (next: SidebarPrefs, container: HTMLElement | null) => {
    flip.capture(container);
    updateSidebar(() => (next === DEFAULT_SIDEBAR ? next : { ...next, items: [...next.items, ...saved.items.filter((x) => x.id === 'ai-inbox')] }));
  };

  const describe = (next: SidebarPrefs, id: NavId) => {
    const place = next.items.find((x) => x.id === id)!.place;
    const group = next.items.filter((x) => x.place === place);
    return `${NAV_META[id].label}, ${PLACE_NAMES[place]}, ${group.findIndex((x) => x.id === id) + 1} of ${group.length}`;
  };

  const drag = useDragSort(list, (id, place, index) => {
    const pinned = PINNED.has(id as NavId);
    const next = moveItem(prefs, id as NavId, pinned ? 'main' : place, index);
    if (JSON.stringify(next.items) !== JSON.stringify(prefs.items)) change(next, list.current);
  });
  const dragSection = useDragSort(sectionList, (id, _place, index) => {
    const next = moveSection(prefs, id as SectionId, index);
    if (JSON.stringify(next.sections) !== JSON.stringify(prefs.sections)) change(next, sectionList.current);
  });

  // Moving a focused node in the DOM drops its focus: put it back once the move commits.
  const refocus = useRef<{ container: HTMLElement | null; id: string } | null>(null);
  useLayoutEffect(() => {
    const r = refocus.current;
    refocus.current = null;
    r?.container?.querySelector<HTMLElement>(`[data-slot-id="${r.id}"] .arrange-row__handle`)?.focus();
  });
  const focusHandle = (container: HTMLElement | null, id: string) => {
    refocus.current = { container, id };
  };

  const keyItem = (id: NavId) => (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = stepItem(prefs, id, delta);
    if (next === prefs) return;
    change(next, list.current);
    focusHandle(list.current, id);
    announce(describe(next, id));
  };
  const keySection = (id: SectionId) => (e: KeyboardEvent) => {
    const delta = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = stepSection(prefs, id, delta);
    if (next === prefs) return;
    change(next, sectionList.current);
    focusHandle(sectionList.current, id);
    announce(`${SECTION_META[id].label}, ${next.sections.findIndex((s) => s.id === id) + 1} of ${next.sections.length}`);
  };

  const sectionHint: Record<SectionId, string> = {
    splits: splits.length ? `${splits.length} ${splits.length === 1 ? 'split' : 'splits'}` : 'Shows a tip until you make one',
    labels: caps.labelsEdit ? 'Hide single labels in Settings > Labels' : 'Your labels, in name order',
  };

  return (
    <div className="settings-group">
      <p className="settings-note md-body-medium">
        Drag a handle, or focus it and use the arrow keys. Right-click or long-press anything in the sidebar to move or hide it.
      </p>
      <div ref={list} className="arrange-list" data-dragging={drag.active || undefined}>
        {/* One flat run of siblings, so a row keeps its element (and focus) as it moves between places. */}
        {PLACES.flatMap((place) => {
          const items = prefs.items.filter((x) => x.place === place);
          return [
            ...placeHead(place, items.length === 0),
            ...items.map(({ id }) => (
                <ArrangeRow
                  key={id}
                  id={id}
                  icon={NAV_META[id].icon}
                  label={NAV_META[id].label}
                  description={
                    PINNED.has(id)
                      ? 'Your inbox always stays in the sidebar'
                      : id === 'scheduled' && place === 'more'
                        ? 'Comes up beside Sent while mail waits to send'
                        : undefined
                  }
                  dragging={drag.active === id}
                  onPointerDown={drag.start(id)}
                  onKeyDown={keyItem(id)}
                  trailing={<PlaceMenu id={id} place={place} onMove={(p) => change(moveItem(prefs, id, p), list.current)} prefs={prefs} onStep={(d) => change(stepItem(prefs, id, d), list.current)} />}
                />
              )),
          ];
        })}
      </div>

      <h3 className="md-label-large settings-subhead">Sections</h3>
      <div ref={sectionList} className="arrange-list" data-dragging={dragSection.active || undefined}>
        {prefs.sections.map((s) => (
          <ArrangeRow
            key={s.id}
            id={s.id}
            icon={SECTION_META[s.id].icon}
            label={SECTION_META[s.id].label}
            description={sectionHint[s.id]}
            dragging={dragSection.active === s.id}
            onPointerDown={dragSection.start(s.id)}
            onKeyDown={keySection(s.id)}
            trailing={
              <Switch
                checked={s.shown}
                label={`Show ${SECTION_META[s.id].label} in the sidebar`}
                onCheckedChange={(on) => updateSidebar((p) => showSection(p, s.id, on))}
              />
            }
          />
        ))}
      </div>

      {!isDefaultSidebar(saved) && (
        <Button variant="text" icon="undo" onClick={() => change(DEFAULT_SIDEBAR, list.current)}>
          Restore the default sidebar
        </Button>
      )}
    </div>
  );
}

/** After the first, a heading is the drop boundary the drag counts. */
function placeHead(place: Place, empty: boolean): ReactNode[] {
  return [
    <h3 key={`head-${place}`} className="md-label-large settings-subhead arrange-list__head" data-slot={place === 'main' ? undefined : 'boundary'}>
      {PLACE_NAMES[place]}
    </h3>,
    empty && (
      <p key={`empty-${place}`} className="arrange-list__empty md-body-medium">
        {place === 'hidden' ? 'Nothing is hidden. Drag a row here to take it out of the sidebar.' : 'Nothing is under More, so the sidebar leaves it out.'}
      </p>
    ),
  ];
}

function ArrangeRow({
  id,
  icon,
  label,
  description,
  dragging,
  onPointerDown,
  onKeyDown,
  trailing,
}: {
  id: string;
  icon: IconName;
  label: string;
  description?: string;
  dragging: boolean;
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  trailing: ReactNode;
}) {
  return (
    <div className="arrange-row" data-slot="item" data-slot-id={id} data-dragging={dragging || undefined}>
      <button
        type="button"
        className="arrange-row__handle"
        aria-label={`Move ${label}`}
        aria-description="Use the up and down arrow keys to move it"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      >
        <Icon name="drag_indicator" size={24} />
      </button>
      <Icon name={icon} size={24} className="arrange-row__icon" />
      <span className="arrange-row__text">
        <span className="md-body-large">{label}</span>
        {description && <span className="md-body-medium arrange-row__desc">{description}</span>}
      </span>
      <span className="arrange-row__control">{trailing}</span>
    </div>
  );
}

function PlaceMenu({
  id,
  place,
  prefs,
  onMove,
  onStep,
}: {
  id: NavId;
  place: Place;
  prefs: SidebarPrefs;
  onMove: (place: Place) => void;
  onStep: (delta: -1 | 1) => void;
}) {
  const label = NAV_META[id].label;
  const pinned = PINNED.has(id);
  const first = prefs.items[0]?.id === id;
  const last = prefs.items[prefs.items.length - 1]?.id === id || (pinned && prefs.items.filter((x) => x.place === 'main').at(-1)?.id === id);
  return (
    <Menu align="end" trigger={<IconButton icon="more_vert" label={`Options for ${label}`} size="xs" />}>
      {!pinned && (
        <>
          <MenuRadioGroup value={place} onValueChange={(v) => onMove(v as Place)}>
            <MenuRadioItem value="main">Always show</MenuRadioItem>
            <MenuRadioItem value="more">Under More</MenuRadioItem>
            <MenuRadioItem value="hidden">Hide</MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
        </>
      )}
      <MenuItem icon="arrow_upward" disabled={first} onClick={() => onStep(-1)}>
        Move up
      </MenuItem>
      <MenuItem icon="arrow_downward" disabled={last} onClick={() => onStep(1)}>
        Move down
      </MenuItem>
    </Menu>
  );
}

/**
 * Reorders live as the row crosses its neighbours' midpoints. Headings marked `data-slot="boundary"`
 * divide places: the slot count above the pointer says where the row lands.
 */
function useDragSort(container: React.RefObject<HTMLElement | null>, onMove: (id: string, place: Place, index: number) => void) {
  const [active, setActive] = useState<string | null>(null);
  const state = useRef<{ id: string; row: HTMLElement; startY: number; startTop: number; startScroll: number; y: number; scroller: HTMLElement | null; raf: number } | null>(null);
  const moveRef = useRef(onMove);
  useLayoutEffect(() => {
    moveRef.current = onMove;
  });

  const position = () => {
    const s = state.current;
    if (!s) return;
    // The row may have been re-rendered into a new node; find it again by id.
    const row = container.current?.querySelector<HTMLElement>(`[data-slot-id="${s.id}"]`) ?? s.row;
    s.row = row;
    const scroll = s.scroller?.scrollTop ?? 0;
    row.style.transform = `translateY(${s.y - s.startY + (scroll - s.startScroll) - (row.offsetTop - s.startTop)}px)`;
  };

  const target = () => {
    const s = state.current;
    if (!s || !container.current) return;
    const slots = [...container.current.querySelectorAll<HTMLElement>('[data-slot]')].filter((el) => el.dataset.slotId !== s.id);
    let place = 0;
    let index = 0;
    for (const el of slots) {
      const r = el.getBoundingClientRect();
      if (r.top + r.height / 2 >= s.y) break;
      if (el.dataset.slot === 'boundary') {
        place++;
        index = 0;
      } else index++;
    }
    moveRef.current(s.id, PLACES[place], index);
  };

  useLayoutEffect(position);

  const autoscroll = () => {
    const s = state.current;
    if (!s?.scroller) return;
    const r = s.scroller.getBoundingClientRect();
    const edge = 48;
    const speed = s.y < r.top + edge ? -(r.top + edge - s.y) / 4 : s.y > r.bottom - edge ? (s.y - (r.bottom - edge)) / 4 : 0;
    if (speed) {
      s.scroller.scrollTop += speed;
      target();
      position();
    }
    s.raf = requestAnimationFrame(autoscroll);
  };

  const start = (id: string) => (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-slot-id]');
    if (!row) return;
    e.preventDefault();
    // Window listeners, not pointer capture: the handle can move in the DOM as the list reorders.
    const scroller = row.closest<HTMLElement>('.settings__scroll');
    state.current = { id, row, startY: e.clientY, startTop: row.offsetTop, startScroll: scroller?.scrollTop ?? 0, y: e.clientY, scroller, raf: 0 };
    state.current.raf = requestAnimationFrame(autoscroll);
    setActive(id);
    const move = (ev: globalThis.PointerEvent) => {
      if (!state.current) return;
      state.current.y = ev.clientY;
      target();
      position();
    };
    const end = () => {
      const s = state.current;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!s) return;
      cancelAnimationFrame(s.raf);
      state.current = null;
      setActive(null);
      const from = s.row.style.transform;
      s.row.style.transform = '';
      if (from && !reducedMotion()) {
        const t = motionToken('--md-sys-motion-spatial-fast');
        s.row.animate([{ transform: from }, { transform: 'none' }], { duration: t.duration, easing: t.easing });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  return { active, start };
}

function useFlip(deps: unknown) {
  const before = useRef<{ container: HTMLElement; tops: Map<string, number> } | null>(null);
  useLayoutEffect(() => {
    const b = before.current;
    before.current = null;
    if (!b || reducedMotion()) return;
    const t = motionToken('--md-sys-motion-spatial-fast');
    b.container.querySelectorAll<HTMLElement>('[data-slot-id]').forEach((row) => {
      if (row.dataset.dragging) return;
      const was = b.tops.get(row.dataset.slotId!);
      const dy = was === undefined ? 0 : was - row.offsetTop;
      if (dy) row.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: t.duration, easing: t.easing });
    });
  }, [deps]);
  return {
    capture(container: HTMLElement | null) {
      if (!container) return;
      const tops = new Map<string, number>();
      container.querySelectorAll<HTMLElement>('[data-slot-id]').forEach((row) => tops.set(row.dataset.slotId!, row.offsetTop));
      before.current = { container, tops };
    },
  };
}
