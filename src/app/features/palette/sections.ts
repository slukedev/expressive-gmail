import { undoableAction } from '../../data/actions';
import type { Contact, ThreadSummary } from '../../data/types';
import { listDate, participantsLine } from '../../lib/format';
import { openThread } from '../../router/useRoute';
import { openUrl } from '../../lib/host';
import type { Settings } from '../../state/settings';
import { contactItems, runSearch, typedItems, type Env } from './commands';
import type { Context } from './context';
import { looksLikeSearch, operatorChips, parseVerb } from './grammar';
import { threadLink } from './links';
import { byUse, dedupe, groupRanked, prepareAll, rank, verbPage, type Entry, type Ranked, type RankedSection } from './resolve';
import type { Item, PageRef } from './types';
import type { LastRun, Use } from './usage';
import { currentShortcut } from '../../ui/shortcut';

export interface Sources {
  ctx: Context;
  env: Env;
  settings: Settings;
  page: PageRef | null;
  query: string;
  root: Entry[];
  context: Entry[];
  pageEntries: (page: PageRef) => Entry[];
  contacts: Contact[];
  found: ThreadSummary[] | undefined;
  recentSearches: string[];
  uses: Record<string, Use>;
  last?: LastRun;
  now: number;
}

const plain = (items: Item[]): Ranked[] => items.map((item) => ({ item, score: 0, hits: [] }));

/** Navigation-only rows for the ? list; Enter opens the full list. */
const KEYS: [string, string][] = [
  ['j / k', 'Older / newer conversation'],
  ['Shift J / Shift K', 'Next / previous unread'],
  ['o or Enter', 'Open conversation'],
  ['x', 'Select conversation'],
  ['* then n', 'Select none'],
  ['[ / ]', 'Archive and go newer / older'],
  ['Ctrl Enter', 'Send (in a message)'],
  ['/ then name', 'Insert a template (in a message)'],
];

function searchRow(q: string, label = `Search all mail for “${q}”`): Item {
  return {
    id: 'search:run',
    title: label,
    group: 'Mail',
    icon: 'search',
    chips: operatorChips(q),
    shortcut: 'Shift Enter',
    ephemeral: true,
    run: () => runSearch(q),
    alt: { label: 'Search options', run: () => void window.dispatchEvent(new CustomEvent('bg:advanced-search', { detail: q })) },
  };
}

function conversationItems(found: ThreadSummary[], query: string, me: string[]): Item[] {
  return found.slice(0, 6).map((t) => {
    const link = threadLink(t.id);
    return {
      id: `conv:${t.id}`,
      title: t.subject || '(no subject)',
      group: 'Mail',
      icon: 'mail',
      avatar: t.participants.at(-1),
      meta: `${participantsLine(t.participants, me)} · ${listDate(t.lastDate)}`,
      ephemeral: true,
      run: () => openThread(t.id, { kind: 'search', query }),
      alt: link ? { label: 'Open in a new tab', run: () => openUrl(link) } : undefined,
    };
  });
}

function pageSection(src: Sources, page: PageRef, query: string, cap = 60): RankedSection[] {
  const typed = typedItems(page, { query, contacts: src.contacts }, src.ctx, src.env).map((i) => ({ ...i, origin: { page, query } }));
  const entries = src.pageEntries(page);
  const q = query.trim();
  // Typed rows (a parsed time, a contact) lead; the page's own rows follow, filtered.
  const rows: Ranked[] = [...plain(typed.filter((i) => i.pinned || !q || i.avatar)), ...(q ? rank(entries, q, src.uses, src.now) : plain(byUse(entries, src.uses, src.now).map((e) => e.item)))];
  const extra = plain(typed.filter((i) => !(i.pinned || !q || i.avatar)));
  const all = [...rows, ...extra].map((r) => ({ ...r, item: r.item.origin ? r.item : { ...r.item, origin: { page, query } } }));
  return dedupe(groupRanked(all, { perGroup: cap, firstGroup: cap, total: cap }));
}

/** When the last command can still run here. */
function repeatRow(src: Sources): Item | null {
  const last = src.last;
  if (!last) return null;
  let found: Item | undefined;
  if (last.page) {
    const page: PageRef = { id: last.page as PageRef['id'], title: '' };
    const typed = typedItems(page, { query: last.query ?? '', contacts: [] }, src.ctx, src.env);
    found = [...typed, ...src.pageEntries(page).map((e) => e.item)].find((i) => i.id === last.id);
  } else {
    found = src.root.find((e) => e.item.id === last.id)?.item;
  }
  if (!found?.run || found.disabled || found.toggle !== undefined) return null;
  return { ...found, id: 'repeat', title: `Repeat: ${found.title}`, icon: 'redo', group: 'Recent', shortcut: undefined, meta: found.meta, ephemeral: true, page: undefined, origin: undefined };
}

function emptyRoot(src: Sources): RankedSection[] {
  const out: RankedSection[] = [];
  if (src.context.length) out.push({ title: src.context[0]!.item.group, items: plain(byUse(src.context, src.uses, src.now).slice(0, 8).map((e) => e.item)) });
  const recent: Item[] = [];
  const repeat = repeatRow(src);
  if (repeat) recent.push(repeat);
  const undo = undoableAction();
  if (undo !== null) {
    const u = src.root.find((e) => e.item.id === 'undo');
    if (u) recent.push({ ...u.item, group: 'Recent' });
  }
  const contextIds = new Set(src.context.map((e) => e.item.id));
  const used = byUse(src.root, src.uses, src.now)
    .filter((e) => !contextIds.has(e.item.id) && e.item.id !== 'undo' && (src.uses[e.item.id]?.n ?? 0) > 0)
    .slice(0, 4)
    .map((e) => ({ ...e.item, group: 'Recent' }));
  recent.push(...used);
  if (recent.length) out.push({ title: 'Recent', items: plain(recent) });
  if (src.recentSearches.length) {
    out.push({
      title: 'Recent searches',
      items: plain(src.recentSearches.slice(0, 3).map((q) => ({ id: `recent-search:${q}`, title: q, group: 'Recent searches', icon: 'history', chips: undefined, ephemeral: true, run: () => runSearch(q) }))),
    });
  }
  const go = src.root.filter((e) => e.item.group === 'Go to' && e.item.id.startsWith('go:') && !e.item.id.startsWith('go:split')).slice(0, 7);
  out.push({ title: 'Go to', items: plain(go.map((e) => e.item)) });
  const actions = src.root.filter((e) => e.item.group === 'Actions' && ['compose', 'write-to', 'search', 'aside-start', 'pause', 'resume'].includes(e.item.id));
  out.push({ title: 'Actions', items: plain(actions.map((e) => e.item)) });
  out.push({ title: 'Settings', items: plain(src.root.filter((e) => ['all-settings', 'shortcuts'].includes(e.item.id)).map((e) => e.item)) });
  return dedupe(out.filter((s) => s.items.length));
}

function help(src: Sources, q: string): RankedSection[] {
  const withKeys = src.root.filter((e) => e.item.shortcut);
  const info = prepareAll(
    KEYS.map(([keys, title]) => ({ id: `help:${title}`, title, group: 'Moving around', icon: 'keyboard' as const, shortcut: keys, ephemeral: true, run: () => undefined })),
  );
  const entries = [...withKeys, ...info].map((e) => ({ ...e, item: { ...e.item, keywords: `${e.item.keywords ?? ''} ${currentShortcut(e.item.shortcut) ?? ''}` } }));
  const ranked = q ? rank(entries, q, {}, src.now) : plain(entries.map((e) => e.item));
  return groupRanked(ranked, { perGroup: 40, firstGroup: 40, total: 200 });
}

export function buildSections(src: Sources): RankedSection[] {
  const q = src.query.trim();
  if (src.page) return pageSection(src, src.page, src.query);
  if (!q) return emptyRoot(src);
  if (q.startsWith('?')) return help(src, q.slice(1).trim());

  const out: RankedSection[] = [];
  const verb = parseVerb(src.query);
  const search = looksLikeSearch(q) && verb?.verb !== 'write' ? q : verb?.verb === 'search' ? verb.arg : '';
  if (verb && verb.verb !== 'search') {
    const page = verbPage(verb.verb, !!src.ctx.target);
    if (page) out.push(...pageSection(src, page, verb.arg, 12));
  }
  if (search) {
    out.push({ title: 'Mail', items: plain([searchRow(search), ...conversationItems(src.found ?? [], search, src.ctx.me)]) });
  }
  out.push(...groupRanked(rank(src.root, q, src.uses, src.now)));
  if (!verb && !search && q.length >= 2 && src.contacts.length) {
    out.push({ title: 'People', items: plain(contactItems(src.contacts, q, src.ctx, 'People', 'person').slice(0, 3)) });
  }
  if (!search) {
    const mail = q.length > 2 ? conversationItems(src.found ?? [], verb?.verb === 'write' ? q : q, src.ctx.me) : [];
    out.push({ title: 'Mail', items: plain([...mail, searchRow(verb?.phrase === 'to:' ? q : q)]) });
  }
  return mergeSameTitles(dedupe(out));
}

/** Labels from a page and root can share a heading; keep one each. */
function mergeSameTitles(sections: RankedSection[]): RankedSection[] {
  const out: RankedSection[] = [];
  const byTitle = new Map<string, RankedSection>();
  for (const s of sections) {
    const existing = byTitle.get(s.title);
    if (existing) existing.items.push(...s.items);
    else {
      const copy = { title: s.title, items: [...s.items] };
      byTitle.set(s.title, copy);
      out.push(copy);
    }
  }
  return out;
}
