import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from '../../data/client';
import { useContactSuggestions } from '../../data/contacts';
import { myAddresses, useAccount, useLabels } from '../../data/hooks';
import type { ThreadSummary } from '../../data/types';
import { listDate, participantsLine } from '../../lib/format';
import { navigate, openHome, openThread, useRoute } from '../../router/useRoute';
import { local, useLocal } from '../../state/local';
import { Avatar } from '../../ui/Avatar';
import { IconButton, cx } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { AdvancedSearchPanel } from './AdvancedSearch';
import { isComposing } from '../../lib/ime';

interface Suggestion {
  id: string;
  icon?: IconName;
  label: string;
  supporting?: string;
  thread?: ThreadSummary;
  avatar?: { name?: string; email: string; photoUrl?: string };
  run: () => void;
}

const OPERATORS: { op: string; values: string[]; icon: IconName }[] = [
  { op: 'is', values: ['unread', 'read', 'starred', 'important', 'snoozed'], icon: 'filter_alt' },
  { op: 'has', values: ['attachment', 'drive', 'document', 'spreadsheet', 'pdf', 'youtube'], icon: 'attach_file' },
  { op: 'in', values: ['inbox', 'sent', 'drafts', 'snoozed', 'spam', 'trash', 'anywhere'], icon: 'inbox' },
  { op: 'older_than', values: ['1d', '1w', '1m', '1y'], icon: 'history' },
  { op: 'newer_than', values: ['1d', '1w', '1m'], icon: 'history' },
  { op: 'category', values: ['primary', 'social', 'promotions', 'updates', 'forums'], icon: 'sell' },
];

/** The way Gmail's search menu does. */
function Matched({ text, terms }: { text: string; terms: RegExp | null }) {
  if (!terms) return <>{text}</>;
  return (
    <>
      {text.split(terms).map((part, i) => (i % 2 ? <b key={i} className="search__match">{part}</b> : part))}
    </>
  );
}

function matchTerms(text: string): RegExp | null {
  const words = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^-?\w+:/, '').replace(/^"|"$/g, ''))
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return words.length ? new RegExp(`(${words.join('|')})`, 'gi') : null;
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchBar({ compact }: { compact: boolean }) {
  const route = useRoute();
  const routeQuery = route.view.kind === 'search' ? route.view.query : '';
  const [text, setText] = useState(routeQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [advanced, setAdvanced] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const recent = useLocal((s) => s.recentSearches);
  const { data: labels = [] } = useLabels();
  const { data: account } = useAccount();

  const [textFor, setTextFor] = useState(routeQuery);
  if (textFor !== routeQuery) {
    setTextFor(routeQuery);
    setText(routeQuery);
  }

  useEffect(() => {
    const focus = () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('bg:focus-search', focus);
    return () => window.removeEventListener('bg:focus-search', focus);
  }, []);

  // "Filter messages like these" opens search options with the sender filled in.
  useEffect(() => {
    const show = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      setOpen(false);
      setAdvanced(true);
    };
    window.addEventListener('bg:advanced-search', show);
    return () => window.removeEventListener('bg:advanced-search', show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const debounced = useDebounced(text.trim(), 180);
  const lastToken = text.split(/\s+/).pop() ?? '';
  const opMatch = lastToken.match(/^(-?)(\w+):(.*)$/);

  const { data: quick } = useQuery({
    queryKey: ['search-peek', debounced],
    queryFn: () => backend().listThreads({ q: debounced, pageSize: 5 }),
    enabled: open && debounced.length > 1 && !opMatch,
    staleTime: 30_000,
    placeholderData: (p) => p,
  });
  const contactPrefix = opMatch && (opMatch[2] === 'from' || opMatch[2] === 'to') ? opMatch[3] : !opMatch ? debounced : '';
  // The same people as a To field, with photos.
  const contacts = useContactSuggestions(open ? contactPrefix : '', 6);

  const submit = (q: string) => {
    const query = q.trim();
    if (!query) return;
    local.addRecentSearch(query);
    setOpen(false);
    inputRef.current?.blur();
    navigate({ view: { kind: 'search', query } });
  };

  const replaceLast = (value: string) => {
    const parts = text.split(/\s+/);
    parts[parts.length - 1] = value;
    const next = `${parts.join(' ')} `;
    setText(next);
    inputRef.current?.focus();
  };

  const suggestions: Suggestion[] = useMemo(() => {
    const out: Suggestion[] = [];
    const t = text.trim();
    if (!t) {
      recent.forEach((r, i) => out.push({ id: `r${i}`, icon: 'history', label: r, run: () => submit(r) }));
      return out;
    }
    if (opMatch) {
      const [, neg, op, partial] = opMatch;
      const p = partial.toLowerCase();
      if (op === 'label') {
        labels
          .filter((l) => l.type === 'user' && l.name.toLowerCase().includes(p))
          .slice(0, 6)
          .forEach((l) => out.push({ id: l.id, icon: 'label', label: `${neg}label:${/\s/.test(l.name) ? `"${l.name}"` : l.name}`, supporting: l.name, run: () => replaceLast(`${neg}label:${/\s/.test(l.name) ? `"${l.name}"` : l.name}`) }));
      } else if (op === 'from' || op === 'to') {
        contacts.slice(0, 6).forEach((c) =>
          out.push({ id: c.email, avatar: c, label: c.name ?? c.email, supporting: `${op}:${c.email}`, run: () => replaceLast(`${neg}${op}:${c.email}`) }),
        );
      } else {
        const def = OPERATORS.find((o) => o.op === op);
        def?.values
          .filter((v) => v.startsWith(p))
          .forEach((v) => out.push({ id: v, icon: def.icon, label: `${neg}${op}:${v}`, run: () => replaceLast(`${neg}${op}:${v}`) }));
      }
      return out;
    }
    out.push({ id: 'search', icon: 'search', label: t, supporting: 'Search all mail', run: () => submit(t) });
    // Earlier searches that start the same way, as Gmail offers them.
    const lower = t.toLowerCase();
    recent
      .filter((r) => r.toLowerCase() !== lower && r.toLowerCase().startsWith(lower))
      .slice(0, 3)
      .forEach((r, i) => out.push({ id: `r${i}`, icon: 'history', label: r, run: () => submit(r) }));
    contacts.slice(0, 4).forEach((c) =>
      out.push({ id: `c${c.email}`, avatar: c, label: c.name ?? c.email, supporting: `Mail from ${c.email}`, run: () => submit(`from:${c.email}`) }),
    );
    (quick?.threads ?? []).forEach((th) =>
      out.push({
        id: th.id,
        thread: th,
        label: th.subject || '(no subject)',
        supporting: participantsLine(th.participants, myAddresses(account)),
        run: () => {
          setOpen(false);
          inputRef.current?.blur();
          local.addRecentSearch(t);
          openThread(th.id, { kind: 'search', query: t });
        },
      }),
    );
    return out;
  }, [text, recent, opMatch?.[0], labels, contacts, quick, account]); // eslint-disable-line react-hooks/exhaustive-deps

  const [activeFor, setActiveFor] = useState(text);
  if (activeFor !== text) {
    setActiveFor(text);
    setActive(-1);
  }

  const showPanel = open && (suggestions.length > 0 || !text.trim());
  const terms = useMemo(() => matchTerms(text), [text]);

  return (
    <div
      className={cx('search', open && 'search--open', compact && 'search--compact')}
      ref={boxRef}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && boxRef.current?.contains(next)) return;
        // Switching windows isn't leaving search.
        if (!document.hasFocus()) return;
        setOpen(false);
      }}
    >
      <div className="search__bar" role="search">
        {route.view.kind === 'search' && !open ? (
          <IconButton icon="arrow_back" label="Back" onClick={openHome} />
        ) : (
          <IconButton icon="search" label="Search" onClick={() => (text.trim() ? submit(text) : inputRef.current?.focus())} />
        )}
        <input
          ref={inputRef}
          className="search__input"
          value={text}
          placeholder="Search in mail"
          aria-label="Search in mail"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="search-suggestions"
          aria-activedescendant={active >= 0 ? `sugg-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            // An input method's Enter and arrows pick its own candidates.
            if (isComposing(e)) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, -1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (active >= 0 && suggestions[active]) suggestions[active].run();
              else submit(text);
            } else if (e.key === 'Escape') {
              if (text && text !== routeQuery) setText(routeQuery);
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
        />
        {text && <IconButton icon="close" label="Clear search" onClick={() => (setText(''), inputRef.current?.focus())} />}
        {!compact && (
          <IconButton icon="tune" label="Show search options" selected={advanced} onClick={() => (setAdvanced((a) => !a), setOpen(false))} />
        )}
      </div>
      {showPanel && <div className="search__scrim" aria-hidden="true" onMouseDown={() => setOpen(false)} />}
      {showPanel && (
        <div
          className="search__panel"
          id="search-suggestions"
          role="listbox"
          aria-label="Search suggestions"
          // Clicks inside the panel keep focus in the field, so they never read as leaving search.
          onMouseDown={(e) => e.preventDefault()}
        >
          {!text.trim() && (
            <div className="search__quick" role="group" aria-label="Quick filters">
              {[
                ['is:unread', 'Unread', 'mark_email_unread'],
                ['has:attachment', 'Has attachment', 'attach_file'],
                ['is:starred', 'Starred', 'star'],
                ['newer_than:7d', 'Last 7 days', 'history'],
                [account?.members ? 'from:me' : `from:${account?.email ?? 'me'}`, 'From me', 'person'],
              ].map(([q, label, icon]) => (
                <button key={q} type="button" className="m3-chip m3-chip--assist" data-has-leading="" onMouseDown={(e) => e.preventDefault()} onClick={() => submit(q)}>
                  <Icon name={icon as IconName} size={18} className="m3-chip__leading" />
                  <span className="m3-chip__label">{label}</span>
                </button>
              ))}
            </div>
          )}
          {!text.trim() && recent.length > 0 && (
            <div className="search__group-head">
              <span className="md-label-large">Recent searches</span>
              <button type="button" className="text-toggle" onMouseDown={(e) => e.preventDefault()} onClick={() => local.clearRecentSearches()}>
                Clear
              </button>
            </div>
          )}
          {suggestions.map((s, i) => (
            <div
              key={s.id}
              id={`sugg-${i}`}
              role="option"
              aria-selected={i === active}
              className="search__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={s.run}
              onMouseEnter={() => setActive(i)}
            >
              {s.thread ? (
                <Avatar name={s.thread.participants.at(-1)?.name} email={s.thread.participants.at(-1)?.email ?? '?'} size={32} />
              ) : s.avatar ? (
                <Avatar name={s.avatar.name} email={s.avatar.email} photoUrl={s.avatar.photoUrl} size={32} />
              ) : (
                <span className="search__item-icon">
                  <Icon name={s.icon ?? 'search'} size={20} />
                </span>
              )}
              <span className="search__item-text">
                <span className={cx('md-body-medium', s.thread?.labelIds.includes('UNREAD') && 'search__item--unread')}>
                  <Matched text={s.label} terms={s.id === 'search' ? null : terms} />
                </span>
                {s.supporting && (
                  <span className="md-body-small search__item-support">
                    <Matched text={s.supporting} terms={s.id === 'search' ? null : terms} />
                  </span>
                )}
              </span>
              {s.thread && <span className="md-body-small search__item-date">{listDate(s.thread.lastDate)}</span>}
            </div>
          ))}
        </div>
      )}
      {advanced && (
        <AdvancedSearchPanel
          initialFrom={text}
          onClose={() => setAdvanced(false)}
          onSearch={(q) => {
            setAdvanced(false);
            setText(q);
            submit(q);
          }}
        />
      )}
    </div>
  );
}
