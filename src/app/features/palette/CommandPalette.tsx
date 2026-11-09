import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { useHasPicture } from '../wallpaper/colors';
import { useQuery } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { mail } from '../../data/actions';
import { backend } from '../../data/client';
import { useContactSuggestions } from '../../data/contacts';
import { describeTime } from '../../lib/presets';
import { local, useLocal } from '../../state/local';
import { useSettingsStore } from '../../state/settings';
import { useUi } from '../../state/ui';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Avatar } from '../../ui/Avatar';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { ariaShortcut, currentShortcut } from '../../ui/shortcut';
import { snack } from '../../ui/Snackbar';
import { DateTimeDialog } from '../snooze/DateTimeDialog';
import { findThread } from '../../data/client';
import { actionItems, contextItems, goItems, labelGoItems, pageItems, runSearch, settingItems, type Env } from './commands';
import { readContext } from './context';
import { highlight } from './fuzzy';
import { looksLikeSearch, parseVerb } from './grammar';
import { prepareAll, type Entry, type Ranked, type RankedSection } from './resolve';
import { buildSections } from './sections';
import type { Item, PageRef } from './types';
import { remember, rememberLast, usage } from './usage';
import { localeDayFirst } from './when';
import './palette.css';
import { keyLabel } from '../../ui/keys';
import { isComposing } from '../../lib/ime';

// Read before the first open, so it ranks from the start.
usage();

const DAY_FIRST = localeDayFirst();
const MOD_ENTER = keyLabel('Ctrl Enter');

type Picker = { kind: 'snooze' | 'remind'; ids: string[] } | null;

export function CommandPalette() {
  const open = useUi((s) => s.palette);
  const [picker, setPicker] = useState<Picker>(null);
  // Escape steps out of a page before it closes the palette.
  const back = useRef<(() => boolean) | null>(null);
  const pick = useCallback((kind: 'snooze' | 'remind', ids: string[]) => setPicker({ kind, ids }), []);

  return (
    <>
      <BaseDialog.Root
        open={open}
        onOpenChange={(o, details) => {
          if (!o && details.reason === 'escape-key' && back.current?.()) {
            details.cancel();
            return;
          }
          useUi.getState().set({ palette: o });
        }}
      >
        <BaseDialog.Portal>
          <BaseDialog.Backdrop className="m3-scrim m3-scrim--light" />
          <BaseDialog.Popup className="palette" aria-label="Command palette">
            <Palette onPick={pick} back={back} />
          </BaseDialog.Popup>
        </BaseDialog.Portal>
      </BaseDialog.Root>
      <DateTimeDialog
        open={!!picker}
        title={picker?.kind === 'remind' ? 'Remind me on' : 'Pick date and time'}
        confirmLabel={picker?.kind === 'remind' ? 'Set reminder' : 'Snooze'}
        onClose={() => setPicker(null)}
        onConfirm={(t) => {
          const p = picker;
          setPicker(null);
          if (!p) return;
          if (p.kind === 'snooze') void mail.snooze(p.ids, t, describeTime(t));
          else {
            const s = findThread(p.ids[0]!);
            local.setReminder({ threadId: p.ids[0]!, subject: s?.subject ?? '', due: t, messageCount: s?.messageCount ?? 1, createdAt: Date.now() }, p.ids[0]!);
            snack(`We'll remind you ${describeTime(t)} if nobody replies`);
          }
        }}
      />
    </>
  );
}

const PLACEHOLDER: Partial<Record<string, string>> = {
  snooze: 'Try “fri 9am”',
  remind: 'Try “in 3 days”',
  pause: 'Try “2h” or “5pm”',
  label: 'Find or create a label',
  move: 'Find or create a label',
  unlabel: 'Find a label',
  write: 'Name or email address',
  person: 'Name or email address',
  setting: 'Find a setting',
  help: 'Find a shortcut',
  go: 'Find a place',
};

/** So mail search doesn't run per keystroke. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

interface Level {
  page: PageRef;
  query: string;
}

function Palette({ onPick, back }: { onPick: Env['pick']; back: React.RefObject<(() => boolean) | null> }) {
  const [ctx] = useState(() => readContext());
  const settings = useSettingsStore((s) => s.settings);
  const recentSearches = useLocal((s) => s.recentSearches);
  const dark = useResolvedDark();
  const [rootQuery, setRootQuery] = useState('');
  const [stack, setStack] = useState<Level[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const level = stack.at(-1);
  const page = level?.page ?? null;
  const query = level ? level.query : rootQuery;

  const env = useMemo<Env>(() => ({ dark, pick: onPick, whenOptions: { dayFirst: DAY_FIRST } }), [dark, onPick]);

  // Prepared once per open; settings rows again when a switch flips.
  const contextEntries = useMemo(() => prepareAll(contextItems(ctx, env)), [ctx, env]);
  const placeEntries = useMemo(() => prepareAll([...goItems(ctx), ...labelGoItems(ctx, env)]), [ctx, env]);
  const actionEntries = useMemo(() => prepareAll(actionItems(ctx, env, settings)), [ctx, env, settings]);
  // Picture rows depend on whether At a glance shows one.
  const picture = useHasPicture();
  const settingEntries = useMemo(() => prepareAll(settingItems(settings)), [settings, picture]); // eslint-disable-line react-hooks/exhaustive-deps
  const root = useMemo(() => [...contextEntries, ...placeEntries, ...actionEntries, ...settingEntries], [contextEntries, placeEntries, actionEntries, settingEntries]);

  // Each page's rows, built the first time it's needed.
  const pageCache = useMemo(() => new Map<string, Entry[]>(), [ctx, env, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageEntries = useCallback(
    (p: PageRef) => {
      const key = `${p.id}|${p.person?.email ?? ''}`;
      let entries = pageCache.get(key);
      if (!entries) {
        entries = prepareAll(pageItems(p, ctx, env, settings));
        pageCache.set(key, entries);
      }
      return entries;
    },
    [pageCache, ctx, env, settings],
  );

  // Who to look up, and what mail to search.
  const verb = page ? null : parseVerb(rootQuery);
  const trimmed = rootQuery.trim();
  const peopleQuery =
    page?.id === 'write' || (page?.id === 'person' && !page.person)
      ? query
      : verb?.verb === 'write' || verb?.verb === 'person'
        ? verb.arg
        : !page && !verb && trimmed.length >= 2 && !trimmed.startsWith('?') && !looksLikeSearch(trimmed)
          ? trimmed
          : '';
  const contacts = useContactSuggestions(peopleQuery, 6);
  const searchText = page || trimmed.startsWith('?') ? '' : verb?.verb === 'search' ? verb.arg : verb && verb.verb !== 'write' ? '' : trimmed;
  const settledSearch = useSettled(searchText, 150);
  const { data: found } = useQuery({
    queryKey: ['palette-search', settledSearch],
    queryFn: () => backend().listThreads({ q: settledSearch, pageSize: 6 }),
    enabled: settledSearch.length > 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const sections = useMemo<RankedSection[]>(
    () =>
      buildSections({
        ctx,
        env,
        settings,
        page,
        query,
        root,
        context: contextEntries,
        pageEntries,
        contacts,
        found: searchText.length > 2 ? found?.threads : undefined,
        recentSearches,
        uses: usage().uses,
        last: usage().last,
        now: ctx.now.getTime(),
      }),
    [ctx, env, settings, page, query, root, contextEntries, pageEntries, contacts, found, searchText, recentSearches],
  );

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const current = Math.min(active, Math.max(flat.length - 1, 0));
  const starts = useMemo(() => {
    const out: number[] = [];
    let i = 0;
    for (const s of sections) {
      out.push(i);
      i += s.items.length;
    }
    return out;
  }, [sections]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current, sections]);

  const push = (p: PageRef) => {
    setStack((s) => [...s, { page: p, query: '' }]);
    setActive(0);
    inputRef.current?.focus();
  };
  const pop = useCallback(() => {
    setStack((s) => s.slice(0, -1));
    setActive(0);
    inputRef.current?.focus();
  }, []);
  back.current = stack.length ? () => (pop(), true) : null;

  const setQuery = (value: string) => {
    if (level) setStack((s) => [...s.slice(0, -1), { ...level, query: value }]);
    else setRootQuery(value);
    setActive(0);
  };

  const close = () => useUi.getState().set({ palette: false });

  const run = (item: Item, mode: 'default' | 'alt' = 'default') => {
    if (item.disabled) return;
    if (mode === 'alt' && item.alt) {
      close();
      if (!item.ephemeral) remember(item.id);
      window.setTimeout(item.alt.run, 0);
      return;
    }
    if (item.page) {
      push(item.page);
      return;
    }
    if (!item.run) return;
    const last = item.id === 'repeat' || item.toggle !== undefined ? undefined : { id: item.id, title: item.title, page: item.origin?.page.id, query: item.origin?.query };
    if (!item.ephemeral) remember(item.id, last);
    else if (item.origin && last) rememberLast(last);
    // Switches flip in place so you can see them change; everything else closes first.
    if (item.toggle !== undefined) {
      item.run();
      return;
    }
    const fn = item.run;
    close();
    window.setTimeout(fn, 0);
  };

  // Rows are memoized; they call through a ref so a new `run` doesn't re-render them all.
  const runRef = useRef(run);
  runRef.current = run;
  const onRun = useCallback((item: Item, mode?: 'default' | 'alt') => runRef.current(item, mode), []);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // An input method's Enter, Tab and arrows pick its own candidates.
    if (isComposing(e)) return;
    const n = flat.length;
    const move = (to: number) => {
      e.preventDefault();
      setActive(n ? Math.max(0, Math.min(n - 1, to)) : 0);
    };
    switch (e.key) {
      case 'ArrowDown':
        return move(current + 1 >= n ? 0 : current + 1);
      case 'ArrowUp':
        return move(current - 1 < 0 ? n - 1 : current - 1);
      case 'Home':
        return move(0);
      case 'End':
        return move(n - 1);
      case 'PageDown':
        return move(current + 8);
      case 'PageUp':
        return move(current - 8);
      case 'Tab': {
        if (!starts.length) return;
        e.preventDefault();
        const at = starts.findLastIndex((s) => s <= current);
        const next = e.shiftKey ? (at <= 0 ? starts.length - 1 : at - 1) : (at + 1) % starts.length;
        setActive(starts[next]!);
        return;
      }
      case 'Backspace':
        if (!e.currentTarget.value && stack.length && e.currentTarget.selectionStart === 0) {
          e.preventDefault();
          pop();
        }
        return;
      case 'Enter': {
        e.preventDefault();
        if (e.shiftKey && !page && trimmed && !trimmed.startsWith('?')) {
          const q = verb?.verb === 'search' ? verb.arg : trimmed;
          close();
          window.setTimeout(() => runSearch(q), 0);
          return;
        }
        const item = flat[current]?.item;
        if (item) run(item, e.metaKey || e.ctrlKey ? 'alt' : 'default');
        return;
      }
    }
  };

  // Spoken after typing settles.
  const count = flat.length;
  const spoken = useSettled(page ? `${page.title}, ${count} ${count === 1 ? 'option' : 'options'}` : query.trim() ? `${count} ${count === 1 ? 'result' : 'results'}` : '', 400);
  const placeholder = page ? (PLACEHOLDER[page.id.startsWith('choice:') ? 'choice' : page.id] ?? `Filter ${page.title.toLowerCase()}`) : 'Search commands, mail and people';

  return (
    <>
      <div className="palette__field">
        {page ? (
          <IconButton icon="arrow_back" label="Back" className="palette__back" onClick={pop} />
        ) : (
          <Icon name="search" size={24} className="palette__icon" />
        )}
        {page && <span className="palette__chip md-label-large">{page.title}</span>}
        <input
          ref={inputRef}
          autoFocus
          className="palette__input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-label={page ? page.title : 'Search commands, mail and people'}
          aria-expanded="true"
          aria-controls="palette-list"
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? `palette-opt-${current}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        {query && <IconButton icon="close" label="Clear" className="palette__clear" onClick={() => (setQuery(''), inputRef.current?.focus())} />}
      </div>
      <div className="palette__list" id="palette-list" role="listbox" aria-label={page ? page.title : 'Results'} ref={listRef}>
        {flat.length === 0 && <p className="palette__empty md-body-medium">{query.trim() ? `Nothing matches “${query.trim()}”` : 'Nothing here yet'}</p>}
        {sections.map((s, si) => (
          <div key={`${s.title}-${si}`} role="group" aria-labelledby={`palette-group-${si}`} className="palette__section">
            <div id={`palette-group-${si}`} className="palette__group md-label-medium" role="presentation">
              {s.title}
            </div>
            {s.items.map((r, k) => {
              const i = starts[si]! + k;
              return <Row key={r.item.id} r={r} index={i} active={i === current} onRun={onRun} onHover={setActive} />;
            })}
          </div>
        ))}
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {spoken}
      </div>
    </>
  );
}

interface RowProps {
  r: Ranked;
  index: number;
  active: boolean;
  onRun: (item: Item, mode?: 'default' | 'alt') => void;
  onHover: (i: number) => void;
}

const Row = memo(function Row({ r, index, active, onRun, onHover }: RowProps) {
  const { item, hits } = r;
  const checked = item.toggle ?? (item.current !== undefined ? item.current : undefined);
  const shortcut = currentShortcut(item.shortcut);
  return (
    <div
      id={`palette-opt-${index}`}
      data-index={index}
      role="option"
      aria-selected={active}
      aria-checked={checked}
      aria-disabled={item.disabled || undefined}
      aria-keyshortcuts={ariaShortcut(item.shortcut)}
      aria-haspopup={item.page ? 'listbox' : undefined}
      className="palette__item"
      data-disabled={item.disabled || undefined}
      onClick={(e) => onRun(item, e.metaKey || e.ctrlKey ? 'alt' : 'default')}
      onMouseMove={() => !active && onHover(index)}
    >
      {item.avatar ? (
        <span className="palette__lead">
          <Avatar name={item.avatar.name} email={item.avatar.email} size={28} />
        </span>
      ) : (
        <span className="palette__lead palette__item-icon">
          <Icon name={item.icon ?? 'bolt'} size={20} filled={!!item.iconColor} style={item.iconColor ? { color: item.iconColor } : undefined} />
        </span>
      )}
      <span className="palette__item-text">
        <span className="palette__title md-body-large">
          {highlight(item.title, hits).map((part, k) =>
            part.hit ? (
              <b key={k} className="palette__hit">
                {part.text}
              </b>
            ) : (
              part.text
            ),
          )}
        </span>
        {item.chips && item.chips.length > 0 && (
          <span className="palette__chips" aria-hidden="true">
            {item.chips.map((c) => (
              <span key={c} className="palette__op md-label-medium">
                {c}
              </span>
            ))}
          </span>
        )}
        {item.meta && <span className="md-body-small palette__item-meta">{item.meta}</span>}
        {item.alt && <span className="sr-only">{`, ${MOD_ENTER}: ${item.alt.label}`}</span>}
      </span>
      {active && item.alt && (
        <span className="palette__alt md-label-medium" aria-hidden="true">
          {MOD_ENTER}: {item.alt.label}
        </span>
      )}
      {shortcut && !(active && item.alt) && (
        <span className="palette__shortcut md-label-large" aria-hidden="true">
          {keyLabel(shortcut)}
        </span>
      )}
      {item.toggle !== undefined ? (
        <span className="m3-switch palette__switch" data-checked={item.toggle || undefined} aria-hidden="true">
          <span className="m3-switch__thumb">
            <Icon name={item.toggle ? 'check' : 'close'} size={16} weight={500} className="m3-switch__icon" />
          </span>
        </span>
      ) : item.current ? (
        <Icon name="check" size={20} className="palette__check" />
      ) : item.page ? (
        <Icon name="chevron_right" size={20} className="palette__chevron" />
      ) : null}
    </div>
  );
});
