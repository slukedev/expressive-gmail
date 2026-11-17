// Gmail's own URL hashes, so a link copied from classic Gmail opens the same place.
import { parseHash, routeToHash, sameView, viewToHash, type Route } from '../../src/app/router/routes';

const THREAD = 'FMfcgzQXJWDsKmzqvBkzXxNZbVdQjrTw';
const INBOX = { kind: 'folder', folder: 'inbox' } as const;

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

  it.each(['', '#', '#no-such-place', '#nowhere/at/all', '#label', '#category'])('falls back to the inbox for %j', (hash) => {
    expect(parseHash(hash)).toEqual({ view: INBOX });
  });

  it('keeps the thread of an unknown category', () => {
    expect(parseHash('#category/nonsense/t-1')).toEqual({ view: INBOX, threadId: 't-1' });
  });

  it.each<[string, Route]>([
    ['#inbox?compose=new', { view: INBOX }],
    ['#inbox/FMfcgzQ?compose=new', { view: INBOX, threadId: 'FMfcgzQ' }],
    ['#starred?compose=new', { view: { kind: 'folder', folder: 'starred' } }],
  ])('ignores Gmail compose parameters in %s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });

  it('opens a thread inside a folder', () => {
    expect(parseHash(`#inbox/${THREAD}`)).toMatchObject({ view: INBOX, threadId: THREAD });
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

  it('reads an advanced search as a search', () => {
    expect(parseHash('#advanced-search/to%3Abo')).toEqual({ view: { kind: 'search', query: 'to:bo' } });
  });

  it('opens Settings on the inbox, at General unless a tab is named', () => {
    expect(parseHash('#settings')).toEqual({ view: INBOX, settings: 'general' });
    expect(parseHash('#settings/general').settings).toBe('general');
  });
});

describe('routeToHash', () => {
  it.each<[string, Route]>([
    ['#inbox', { view: INBOX }],
    ['#trash', { view: { kind: 'folder', folder: 'trash' } }],
    [`#imp/${THREAD}`, { view: { kind: 'folder', folder: 'imp' }, threadId: THREAD }],
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
    ['#settings/labels', { view: INBOX, settings: 'labels' }],
  ])('writes %s, the hash Gmail uses, and reads it back', (hash, route) => {
    expect(routeToHash(route)).toBe(hash);
    expect(parseHash(hash)).toEqual(route);
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
    { view: { kind: 'folder', folder: 'sent' }, threadId: 'thread-f:1712/x y' },
  ])('round-trips %j', (route) => {
    expect(parseHash(routeToHash(route))).toEqual(route);
  });
});

describe('sameView', () => {
  it('ignores the thread and compares the view', () => {
    expect(sameView(parseHash('#label/Work%2FDesign+reviews/t-1').view, { kind: 'label', label: 'Work/Design reviews' })).toBe(true);
    expect(sameView({ kind: 'label', label: 'Work' }, { kind: 'label', label: 'Work/Design reviews' })).toBe(false);
    expect(sameView(INBOX, { kind: 'category', category: 'primary' })).toBe(false);
  });
});
