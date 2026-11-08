// Gmail's own URL hashes, so a link copied from classic Gmail opens the same place.
import { parseHash, routeToHash, viewToHash, type Route } from '../../src/app/router/routes';

const THREAD = 'FMfcgzQXJWDsKmzqvBkzXxNZbVdQjrTw';

describe('parseHash', () => {
  it.each([
    ['#inbox', 'inbox'],
    ['#starred', 'starred'],
    ['#snoozed', 'snoozed'],
    ['#imp', 'imp'],
    ['#sent', 'sent'],
    ['#scheduled', 'scheduled'],
    ['#drafts', 'drafts'],
    ['#all', 'all'],
    ['#spam', 'spam'],
    ['#trash', 'trash'],
  ])('%s is a folder', (hash, folder) => {
    expect(parseHash(hash).view).toEqual({ kind: 'folder', folder });
  });

  it.each(['social', 'promotions', 'updates', 'forums'])('#category/%s', (category) => {
    expect(parseHash(`#category/${category}`).view).toEqual({ kind: 'category', category });
  });

  it.each(['', '#', '#no-such-place'])('falls back to the inbox for %j', (hash) => {
    expect(parseHash(hash).view).toEqual({ kind: 'folder', folder: 'inbox' });
  });

  it('opens a thread inside a folder', () => {
    expect(parseHash(`#inbox/${THREAD}`)).toMatchObject({ view: { kind: 'folder', folder: 'inbox' }, threadId: THREAD });
    expect(parseHash(`#sent/${THREAD}`)).toMatchObject({ view: { kind: 'folder', folder: 'sent' }, threadId: THREAD });
  });

  it('reads Gmail label URLs: "+" for spaces, %2F for nested labels', () => {
    expect(parseHash('#label/Client+Work').view).toEqual({ kind: 'label', label: 'Client Work' });
    expect(parseHash('#label/Projects%2FAlpha').view).toEqual({ kind: 'label', label: 'Projects/Alpha' });
  });

  it('opens a thread inside a nested label', () => {
    expect(parseHash(`#label/Projects%2FAlpha/${THREAD}`)).toMatchObject({
      view: { kind: 'label', label: 'Projects/Alpha' },
      threadId: THREAD,
    });
  });

  it('reads Gmail search URLs', () => {
    expect(parseHash('#search/from%3Aamy%40example.com+dinner').view).toEqual({
      kind: 'search',
      query: 'from:amy@example.com dinner',
    });
  });

  it('opens a thread from a search', () => {
    expect(parseHash(`#search/has%3Aattachment/${THREAD}`)).toMatchObject({
      view: { kind: 'search', query: 'has:attachment' },
      threadId: THREAD,
    });
  });

  it('reads #settings/<tab>', () => {
    expect(parseHash('#settings/general').settings).toBe('general');
  });
});

describe('routeToHash', () => {
  it.each([
    [{ view: { kind: 'folder', folder: 'inbox' } }, '#inbox'],
    [{ view: { kind: 'folder', folder: 'imp' } }, '#imp'],
    [{ view: { kind: 'folder', folder: 'inbox' }, threadId: THREAD }, `#inbox/${THREAD}`],
    [{ view: { kind: 'category', category: 'social' } }, '#category/social'],
  ] as [Route, string][])('%j', (route, hash) => {
    expect(routeToHash(route)).toBe(hash);
  });

  it('keeps a nested label one path segment', () => {
    const hash = viewToHash({ kind: 'label', label: 'Projects/Alpha' });
    expect(hash.startsWith('#label/')).toBe(true);
    expect(hash.slice('#label/'.length)).not.toContain('/');
  });

  it.each<Route>([
    { view: { kind: 'label', label: 'Client Work' } },
    { view: { kind: 'label', label: 'Projects/Alpha/Q4 plans' }, threadId: THREAD },
    { view: { kind: 'label', label: 'C++ & R&D 100%' } },
    { view: { kind: 'label', label: 'Café / Reçus' } },
    { view: { kind: 'search', query: 'from:(ana@example.com) subject:"q3 report" -in:chats' } },
    { view: { kind: 'search', query: 'label:client-work after:2026/10/01 larger:5M' }, threadId: THREAD },
    { view: { kind: 'search', query: '1+1=2 #hash ?q' } },
  ])('round-trips %j', (route) => {
    expect(parseHash(routeToHash(route))).toMatchObject(route);
  });
});
