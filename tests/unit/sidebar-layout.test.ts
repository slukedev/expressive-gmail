import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIDEBAR,
  NAV_IDS,
  isDefaultSidebar,
  moveItem,
  moveSection,
  railLayout,
  resolveSidebar,
  showSection,
  stepItem,
  type SidebarPrefs,
} from '../../src/app/features/shell/sidebarLayout';

const ids = (p: SidebarPrefs, place: string) => p.items.filter((x) => x.place === place).map((x) => x.id);

describe('resolveSidebar', () => {
  it('repairs stored prefs from an older or hand-edited version without losing a destination', () => {
    const stored = {
      items: [
        { id: 'trash', place: 'main' },
        { id: 'inbox', place: 'hidden' }, // Inbox can't leave the rail
        { id: 'trash', place: 'more' }, // duplicate
        { id: 'gone', place: 'main' }, // removed destination
        { id: 'spam', place: 'sideways' }, // bad place
        { id: 'sent', place: 'hidden' },
      ],
      sections: [{ id: 'labels', shown: false }, { id: 'nope' }],
    };
    const p = resolveSidebar(stored);
    expect(p.items.map((x) => x.id).sort()).toEqual([...NAV_IDS].sort());
    expect(ids(p, 'main').slice(0, 2)).toEqual(['trash', 'inbox']);
    expect(ids(p, 'hidden')).toEqual(['sent']);
    // Spam's bad entry is dropped, so it comes back where the defaults put it.
    expect(ids(p, 'more')).toContain('spam');
    expect(p.sections).toEqual([
      { id: 'labels', shown: false },
      { id: 'splits', shown: true },
    ]);
  });

  it('puts a destination added since the prefs were saved after its default neighbour', () => {
    const saved = DEFAULT_SIDEBAR.items.filter((x) => x.id !== 'all');
    const p = resolveSidebar({ items: saved, sections: DEFAULT_SIDEBAR.sections });
    const more = ids(p, 'more');
    expect(more[more.indexOf('scheduled') + 1]).toBe('all');
  });

  it('treats garbage as the default', () => {
    expect(resolveSidebar(null)).toEqual(DEFAULT_SIDEBAR);
    expect(isDefaultSidebar(resolveSidebar('x'))).toBe(true);
  });
});

describe('moving destinations', () => {
  it('steps across the place headings instead of past a neighbour', () => {
    let p = resolveSidebar(DEFAULT_SIDEBAR);
    const lastMain = ids(p, 'main').at(-1)!;
    p = stepItem(p, lastMain, 1);
    expect(ids(p, 'more')[0]).toBe(lastMain);
    p = stepItem(p, lastMain, -1);
    expect(ids(p, 'main').at(-1)).toBe(lastMain);

    const lastMore = ids(p, 'more').at(-1)!;
    p = stepItem(p, lastMore, 1);
    expect(ids(p, 'hidden')).toEqual([lastMore]);
    // Already last of all: nothing to step into.
    expect(stepItem(p, lastMore, 1)).toBe(p);
  });

  it('keeps Inbox on the rail but lets it reorder', () => {
    let p = resolveSidebar(DEFAULT_SIDEBAR);
    expect(moveItem(p, 'inbox', 'hidden')).toBe(p);
    p = moveItem(p, 'inbox', 'main', 2);
    expect(ids(p, 'main').indexOf('inbox')).toBe(2);
    const n = ids(p, 'main').length;
    for (let i = 0; i < n; i++) p = stepItem(p, 'inbox', 1);
    expect(ids(p, 'main').at(-1)).toBe('inbox');
    expect(ids(p, 'more')).not.toContain('inbox');
  });

  it('clamps an index past the end and keeps places grouped', () => {
    const p = moveItem(resolveSidebar(DEFAULT_SIDEBAR), 'trash', 'main', 99);
    expect(ids(p, 'main').at(-1)).toBe('trash');
    const places = p.items.map((x) => x.place);
    expect(places).toEqual([...places].sort((a, b) => ['main', 'more', 'hidden'].indexOf(a) - ['main', 'more', 'hidden'].indexOf(b)));
  });
});

describe('railLayout', () => {
  it('lifts Scheduled beside Sent only while it is left under More and mail is waiting', () => {
    const p = resolveSidebar(DEFAULT_SIDEBAR);
    const waiting = railLayout(p, { scheduledWaiting: true });
    expect(waiting.main[waiting.main.indexOf('sent') + 1]).toBe('scheduled');
    expect(waiting.more).not.toContain('scheduled');
    expect(railLayout(p, { scheduledWaiting: false }).more).toContain('scheduled');

    const hidden = moveItem(p, 'scheduled', 'hidden');
    const l = railLayout(hidden, { scheduledWaiting: true });
    expect([...l.main, ...l.more]).not.toContain('scheduled');

    // With Sent hidden, it lands at the end of the rail.
    const noSent = moveItem(p, 'sent', 'hidden');
    expect(railLayout(noSent, { scheduledWaiting: true }).main.at(-1)).toBe('scheduled');
  });

  it('draws sections in order and leaves hidden ones out', () => {
    let p = moveSection(resolveSidebar(DEFAULT_SIDEBAR), 'labels', 0);
    expect(railLayout(p, { scheduledWaiting: false }).sections).toEqual(['labels', 'splits']);
    p = showSection(p, 'splits', false);
    expect(railLayout(p, { scheduledWaiting: false }).sections).toEqual(['labels']);
    expect(isDefaultSidebar(p)).toBe(false);
  });
});
