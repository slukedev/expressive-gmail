import { describe, expect, it } from 'vitest';
import { highlight, match, prepare } from '../../src/app/features/palette/fuzzy';
import { looksLikeSearch, operatorChips, parseVerb } from '../../src/app/features/palette/grammar';
import { byUse, dedupe, groupRanked, prepareAll, rank } from '../../src/app/features/palette/resolve';
import type { Item } from '../../src/app/features/palette/types';
import { frecency, recordUse, usageBoost, type UsageData } from '../../src/app/features/palette/usage';

const item = (id: string, title: string, group = 'Actions', keywords?: string): Item => ({ id, title, group, keywords, run: () => undefined });

const COMMANDS: Item[] = [
  item('archive', 'Archive “Onboarding v4…”', 'This conversation', 'done remove from inbox'),
  item('delete', 'Delete “Onboarding v4…”', 'This conversation', 'trash bin remove'),
  item('read', 'Mark as read', 'Actions', 'seen'),
  item('go:Trash', 'Trash', 'Go to', 'bin deleted'),
  item('go:Inbox', 'Inbox', 'Go to'),
  item('go:Snoozed', 'Snoozed', 'Go to'),
  item('snooze', 'Snooze “Onboarding v4…”', 'This conversation', 'later'),
  item('setting:showSnippets', 'Message previews', 'Settings', 'setting snippets'),
  item('go:label:Work/Design reviews', 'Work/Design reviews', 'Labels'),
  item('go:label:Work', 'Work', 'Labels'),
];
const entries = prepareAll(COMMANDS);
const NOW = Date.UTC(2026, 9, 13, 12);
const ids = (q: string, uses = {}) => rank(entries, q, uses, NOW).map((r) => r.item.id);

describe('match', () => {
  it('ranks a title that starts with the text above one that only contains it', () => {
    expect(ids('inb')[0]).toBe('go:Inbox');
    expect(ids('snooze').slice(0, 2)).toEqual(['go:Snoozed', 'snooze']);
  });

  it("puts the open conversation's own action ahead of an equal match elsewhere", () => {
    const withContext = prepareAll(COMMANDS.map((c) => (c.id === 'snooze' ? { ...c, boost: 8 } : c)));
    expect(rank(withContext, 'snooze', {}, NOW)[0]?.item.id).toBe('snooze');
    expect(rank(withContext, 'snoozed', {}, NOW)[0]?.item.id).toBe('go:Snoozed');
  });

  it('finds commands by initials', () => {
    expect(ids('mar')[0]).toBe('read');
  });

  it('finds commands by alias, below a title match', () => {
    // "trash" is Delete's alias, but the Trash folder is named that.
    expect(ids('trash')).toEqual(['go:Trash', 'delete']);
    expect(ids('snippets')).toEqual(['setting:showSnippets']);
  });

  it('needs every word to match', () => {
    expect(ids('design rev')).toEqual(['go:label:Work/Design reviews']);
    expect(ids('design banana')).toEqual([]);
  });

  it('prefers the shorter of two titles with the same prefix', () => {
    expect(ids('work')).toEqual(['go:label:Work', 'go:label:Work/Design reviews']);
  });

  it('ignores accents and case', () => {
    const p = prepare({ title: 'Tomás Ferreira' });
    expect(match('tomas', p)).not.toBeNull();
    expect(match('FERR', p)?.hits).toEqual([6, 7, 8, 9]);
  });

  it('reports the matched characters for highlighting', () => {
    const p = prepare({ title: 'Mark as read' });
    const m = match('mar', p)!;
    expect(highlight('Mark as read', m.hits).filter((x) => x.hit).map((x) => x.text).join('')).toBe('Mar');
    const initials = match('mr', p)!;
    expect(initials.hits).toEqual([0, 8]);
  });

  it("doesn't count scattered letters as a match", () => {
    expect(match('xq', prepare({ title: 'Inbox quick' }))).toBeNull();
    expect(match('ae', prepare({ title: 'Snoozed' }))).toBeNull();
  });
});

describe('usage ranking', () => {
  const day = 86_400_000;

  it('lifts a command used often above an equal text match', () => {
    let data: UsageData = { uses: {} };
    for (let i = 0; i < 5; i++) data = recordUse(data, 'go:Snoozed', NOW - i * 1000);
    expect(ids('sno', data.uses)[0]).toBe('go:Snoozed');
    data = { uses: {} };
    for (let i = 0; i < 5; i++) data = recordUse(data, 'snooze', NOW - i * 1000);
    expect(ids('sno', data.uses)[0]).toBe('snooze');
  });

  it("doesn't let use outrank a much better text match", () => {
    let data: UsageData = { uses: {} };
    for (let i = 0; i < 50; i++) data = recordUse(data, 'delete', NOW);
    expect(ids('archive', data.uses)[0]).toBe('archive');
  });

  it('fades use with time', () => {
    const fresh = recordUse({ uses: {} }, 'a', NOW);
    expect(frecency(fresh.uses.a, NOW)).toBeCloseTo(1);
    expect(frecency(fresh.uses.a, NOW + 14 * day)).toBeCloseTo(0.5);
    expect(usageBoost(fresh.uses.a, NOW + 140 * day)).toBeLessThan(usageBoost(fresh.uses.a, NOW));
  });

  it('orders an empty field by use, then by the builder order', () => {
    const data = recordUse(recordUse({ uses: {} }, 'go:Snoozed', NOW - day), 'read', NOW);
    expect(byUse(entries, data.uses, NOW).map((e) => e.item.id).slice(0, 4)).toEqual(['read', 'go:Snoozed', 'archive', 'delete']);
  });

  it('keeps the last run and forgets the least used past the limit', () => {
    let data: UsageData = { uses: {} };
    for (let i = 0; i < 320; i++) data = recordUse(data, `c${i}`, NOW + i, { id: `c${i}`, title: `C ${i}` });
    expect(Object.keys(data.uses)).toHaveLength(300);
    expect(data.uses.c319).toBeDefined();
    expect(data.uses.c0).toBeUndefined();
    expect(data.last?.id).toBe('c319');
  });
});

describe('grouping', () => {
  it('orders groups by their best row and caps each', () => {
    const many = prepareAll(Array.from({ length: 12 }, (_, i) => item(`l${i}`, `Label ${i}`, 'Labels')).concat(item('lx', 'Label', 'Go to')));
    const sections = groupRanked(rank(many, 'label', {}, NOW), { perGroup: 3, firstGroup: 5 });
    expect(sections.map((s) => [s.title, s.items.length])).toEqual([
      ['Go to', 1],
      ['Labels', 3],
    ]);
  });

  it('drops a row that already appeared higher up', () => {
    const a = { item: item('snooze:tomorrow', 'Tomorrow'), score: 1, hits: [] };
    expect(dedupe([{ title: 'Typed', items: [a] }, { title: 'Presets', items: [a] }])).toEqual([{ title: 'Typed', items: [a] }]);
  });
});

describe('grammar', () => {
  it.each([
    ['snooze tomorrow 9am', 'snooze', 'tomorrow 9am'],
    ['snooze until fri', 'snooze', 'fri'],
    ['remind in 3 days', 'remind', 'in 3 days'],
    ['remind me tomorrow', 'remind', 'tomorrow'],
    ['label work', 'label', 'work'],
    ['label as Work/Design', 'label', 'Work/Design'],
    ['move to receipts', 'move', 'receipts'],
    ['move to new label Taxes 2026', 'move', 'new label Taxes 2026'],
    ['to:priya', 'write', 'priya'],
    ['email Priya', 'write', 'Priya'],
    ['theme dark', 'theme', 'dark'],
    ['density compact', 'density', 'compact'],
    ['go starred', 'go', 'starred'],
    ['go to starred', 'go', 'starred'],
    ['pause 2h', 'pause', '2h'],
  ])('reads %j', (input, verb, arg) => {
    expect(parseVerb(input)).toMatchObject({ verb, arg });
  });

  it('leaves a verb alone as a search, so it finds the command itself', () => {
    expect(parseVerb('snooze')).toBeNull();
    expect(parseVerb('labels')).toBeNull();
    expect(parseVerb('moved')).toBeNull();
  });

  it('spots Gmail search operators and lists them as chips', () => {
    expect(looksLikeSearch('from:priya has:attachment')).toBe(true);
    expect(looksLikeSearch('"exact phrase"')).toBe(true);
    expect(looksLikeSearch('archive')).toBe(false);
    expect(looksLikeSearch('note: ship it')).toBe(false);
    expect(operatorChips('invoice from:priya after:2026/10/01 -label:receipts')).toEqual(['from:priya', 'after:2026/10/01', '-label:receipts']);
  });
});
