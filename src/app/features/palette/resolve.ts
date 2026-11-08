import { match, prepare, type Prepared } from './fuzzy';
import type { Verb } from './grammar';
import type { Item, PageRef } from './types';
import { frecency, usageBoost, type Use } from './usage';

export interface Entry {
  item: Item;
  p: Prepared;
}

export interface Ranked {
  item: Item;
  score: number;
  hits: number[];
}

export function prepareAll(items: Item[]): Entry[] {
  return items.map((item) => ({ item, p: prepare(item) }));
}

/** Use adds a bounded boost, so a daily command beats an equal text match but never a much better one. Pinned rows always lead. */
export function rank(entries: Entry[], query: string, uses: Record<string, Use>, now: number): Ranked[] {
  const out: Ranked[] = [];
  for (const e of entries) {
    const m = match(query, e.p);
    if (!m) {
      if (e.item.pinned) out.push({ item: e.item, score: 10_000, hits: [] });
      continue;
    }
    const boost = e.item.ephemeral ? 0 : usageBoost(uses[e.item.id], now);
    out.push({ item: e.item, score: m.score + boost + (e.item.boost ?? 0) + (e.item.pinned ? 10_000 : 0), hits: m.hits });
  }
  // Stable for equal scores: the builder's order breaks ties.
  return out.sort((a, b) => b.score - a.score);
}

/** For an empty field. */
export function byUse(entries: Entry[], uses: Record<string, Use>, now: number): Entry[] {
  return entries
    .map((e, i) => ({ e, i, f: e.item.ephemeral ? 0 : frecency(uses[e.item.id], now) }))
    .sort((a, b) => b.f - a.f || a.i - b.i)
    .map((x) => x.e);
}

export interface RankedSection {
  title: string;
  items: Ranked[];
}

/** Groups appear in the order of their best row; each shows a few, the best group more. */
export function groupRanked(ranked: Ranked[], opts: { perGroup?: number; firstGroup?: number; total?: number } = {}): RankedSection[] {
  const per = opts.perGroup ?? 5;
  const first = opts.firstGroup ?? 8;
  const total = opts.total ?? 40;
  const sections: RankedSection[] = [];
  const byTitle = new Map<string, RankedSection>();
  let count = 0;
  for (const r of ranked) {
    let s = byTitle.get(r.item.group);
    if (!s) {
      s = { title: r.item.group, items: [] };
      byTitle.set(r.item.group, s);
      sections.push(s);
    }
    const cap = sections[0] === s ? first : per;
    if (s.items.length >= cap || count >= total) continue;
    s.items.push(r);
    count += 1;
  }
  return sections.filter((s) => s.items.length);
}

/** A preset also matched as typed text. */
export function dedupe(sections: RankedSection[]): RankedSection[] {
  const seen = new Set<string>();
  return sections
    .map((s) => ({ ...s, items: s.items.filter((r) => (seen.has(r.item.id) ? false : (seen.add(r.item.id), true))) }))
    .filter((s) => s.items.length);
}

/** Given whether there's a conversation to act on. */
export function verbPage(verb: Verb, hasTarget: boolean): PageRef | null {
  switch (verb) {
    case 'snooze':
      return hasTarget ? { id: 'snooze', title: 'Snooze' } : null;
    case 'remind':
      return hasTarget ? { id: 'remind', title: 'Remind me' } : null;
    case 'label':
      return { id: 'label', title: hasTarget ? 'Label as' : 'Labels' };
    case 'unlabel':
      return hasTarget ? { id: 'unlabel', title: 'Remove label' } : null;
    case 'move':
      return { id: 'move', title: hasTarget ? 'Move to' : 'Labels' };
    case 'write':
      return { id: 'write', title: 'Write to' };
    case 'person':
      return { id: 'person', title: 'People' };
    case 'theme':
      return { id: 'choice:themeMode', title: 'Theme' };
    case 'density':
      return { id: 'choice:density', title: 'Density' };
    case 'go':
      return { id: 'go', title: 'Go to' };
    case 'switch':
      return { id: 'switch', title: 'Accounts' };
    case 'template':
      return { id: 'template', title: 'Templates' };
    case 'setting':
      return { id: 'setting', title: 'Settings' };
    case 'pause':
      return { id: 'pause', title: 'Pause inbox' };
    case 'search':
      return null;
  }
}

