import { parseHash, routeToHash, sameView, type Route } from '../../src/app/router/routes';

describe('parseHash and routeToHash', () => {
  it.each<[string, Route]>([
    ['#inbox', { view: { kind: 'folder', folder: 'inbox' } }],
    ['#trash', { view: { kind: 'folder', folder: 'trash' } }],
    ['#imp/FMfcgzQXJWxbcd', { view: { kind: 'folder', folder: 'imp' }, threadId: 'FMfcgzQXJWxbcd' }],
    ['#category/social', { view: { kind: 'category', category: 'social' } }],
    ['#category/promotions/t-42', { view: { kind: 'category', category: 'promotions' }, threadId: 't-42' }],
    ['#label/Receipts', { view: { kind: 'label', label: 'Receipts' } }],
    ['#label/Work%2FDesign+reviews', { view: { kind: 'label', label: 'Work/Design reviews' } }],
    ['#label/Work%2FDesign+reviews/t-9', { view: { kind: 'label', label: 'Work/Design reviews' }, threadId: 't-9' }],
    ['#search/from%3Aana+has%3Aattachment', { view: { kind: 'search', query: 'from:ana has:attachment' } }],
    ['#search/subject%3A%22%C3%A9t%C3%A9+%E6%97%A5%E6%9C%AC%22/t-1', { view: { kind: 'search', query: 'subject:"été 日本"' }, threadId: 't-1' }],
    ['#split/receipts', { view: { kind: 'split', id: 'receipts' } }],
    ['#subscriptions', { view: { kind: 'subscriptions' } }],
    ['#attachments/t-3', { view: { kind: 'attachments' }, threadId: 't-3' }],
    ['#reminders', { view: { kind: 'reminders' } }],
    ['#settings/labels', { view: { kind: 'folder', folder: 'inbox' }, settings: 'labels' }],
  ])('%s parses and serializes back', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
    expect(routeToHash(route)).toBe(hash);
  });

  it.each<[string, Route]>([
    ['#settings', { view: { kind: 'folder', folder: 'inbox' }, settings: 'general' }],
    ['#advanced-search/to%3Abo', { view: { kind: 'search', query: 'to:bo' } }],
    ['', { view: { kind: 'folder', folder: 'inbox' } }],
    ['#', { view: { kind: 'folder', folder: 'inbox' } }],
    ['#nowhere/at/all', { view: { kind: 'folder', folder: 'inbox' } }],
    ['#label', { view: { kind: 'folder', folder: 'inbox' } }],
    ['#category', { view: { kind: 'folder', folder: 'inbox' } }],
    ['#category/nonsense/t-1', { view: { kind: 'folder', folder: 'inbox' }, threadId: 't-1' }],
    ['#inbox?compose=new', { view: { kind: 'folder', folder: 'inbox' } }],
    ['#inbox/FMfcgzQ?compose=new', { view: { kind: 'folder', folder: 'inbox' }, threadId: 'FMfcgzQ' }],
  ])('%j parses to the expected route', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('a thread id with reserved characters survives a round trip', () => {
    const route: Route = { view: { kind: 'folder', folder: 'sent' }, threadId: 'thread-f:1712/x y' };
    expect(parseHash(routeToHash(route))).toEqual(route);
  });

  it('#starred?compose=new stays in Starred', () => {
    expect(parseHash('#starred?compose=new').view).toEqual({ kind: 'folder', folder: 'starred' });
  });

  it.each<[string, Route['view']]>([
    ['label', { kind: 'label', label: 'Lang/C++' }],
    ['search', { kind: 'search', query: 'subject:"1+1"' }],
  ])('a %s containing "+" survives a round trip', (_kind, view) => {
    expect(parseHash(routeToHash({ view })).view).toEqual(view);
  });
});

describe('sameView', () => {
  it('ignores the thread and compares the view', () => {
    expect(sameView(parseHash('#label/Work%2FDesign+reviews/t-1').view, { kind: 'label', label: 'Work/Design reviews' })).toBe(true);
    expect(sameView({ kind: 'label', label: 'Work' }, { kind: 'label', label: 'Work/Design reviews' })).toBe(false);
    expect(sameView({ kind: 'folder', folder: 'inbox' }, { kind: 'category', category: 'primary' })).toBe(false);
  });
});
