import { BackendError } from '../../src/app/data/backend';
import { mapLabels, parseLabels, toInternalChange } from '../../src/session/labels';
import { fixture } from './helpers';

describe('category inbox tabs', () => {
  it("reads each tab's unread count from Gmail's ^sq_ig_i labels, apart from the category's own", () => {
    // A real /i/s response: Promotions has 1,098 unread in all, 1,048 of them still in the inbox.
    const root = fixture<unknown[]>('s-send-response-2022.json') as any;
    const labels = parseLabels(undefined, root[2]);
    const of = (id: string) => labels.find((l) => l.id === id);
    expect(of('CATEGORY_PROMOTIONS')).toMatchObject({ unreadCount: 1098, inboxUnreadCount: 1048, inboxTotalCount: 1180 });
    expect(of('CATEGORY_SOCIAL')).toMatchObject({ unreadCount: 0, inboxUnreadCount: 0, inboxTotalCount: 1 });
    // Gmail sent no unread number for the Updates tab: it stays unknown, not 0, while its total still comes through.
    expect(of('CATEGORY_UPDATES')?.inboxUnreadCount).toBeUndefined();
    expect(of('CATEGORY_UPDATES')?.inboxTotalCount).toBe(4594);
    expect(of('INBOX')?.inboxUnreadCount).toBeUndefined();
  });
});

describe('toInternalChange', () => {
  it('archives the way Gmail does: adds ^a and drops ^i', () => {
    // Gmail's own archive request (gmail.js test data) adds exactly ["^a"] and removes "^i".
    const archive = fixture<unknown[]>('s-archive-request-2018-gmailjs.json');
    const [gmailAdd, gmailRemove] = (archive as any)[1][0][0][1][1][6] as [string[], string[]];
    const change = toInternalChange({ remove: ['INBOX'] });
    expect(change.add).toEqual(gmailAdd);
    expect(gmailRemove).toEqual(expect.arrayContaining(change.remove));
  });

  it('unstars every star style so a coloured star does not survive', () => {
    const change = toInternalChange({ remove: ['STARRED'] });
    expect(change.remove).toEqual(expect.arrayContaining(['^t', '^ss_sy', '^ss_cb']));
    expect(change.add).toEqual([]);
  });

  it('marks read by removing both unread markers', () => {
    expect(toInternalChange({ remove: ['UNREAD'] })).toEqual({ add: [], remove: ['^u', '^us'] });
  });

  it('lets an explicit add win over another change\'s side effect', () => {
    // Trashing removes ^i as a side effect; an explicit INBOX add in the same change keeps it.
    const change = toInternalChange({ add: ['INBOX', 'TRASH'] });
    expect(change.add).toEqual(expect.arrayContaining(['^i', '^k']));
    expect(change.remove).not.toContain('^i');
    expect(change.remove).toEqual(expect.arrayContaining(['^a', '^s']));
  });

  it('passes user labels and categories through as internal ids', () => {
    expect(toInternalChange({ add: ['^x_17', 'CATEGORY_SOCIAL'], remove: ['CATEGORY_PROMOTIONS'] })).toEqual({
      add: ['^x_17', '^smartlabel_social'],
      remove: ['^smartlabel_promo'],
    });
  });

  it.each(['SENT', 'DRAFT', 'SNOOZED', 'SCHEDULED'] as const)('refuses to touch %s directly', (id) => {
    for (const change of [{ add: [id] }, { remove: [id] }]) {
      let error: unknown;
      try {
        toInternalChange(change);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(BackendError);
      expect((error as BackendError).code).toBe('unsupported');
    }
  });
});

it('drops Gmail bookkeeping labels when mapping message labels', () => {
  expect(mapLabels(['^all', '^i', '^io_lr', '^sq_ig_i_personal', '^smartlabel_notification', '^x_9', '^pfg', '^t'])).toEqual([
    'INBOX',
    'CATEGORY_UPDATES',
    '^x_9',
    'STARRED',
  ]);
});

it('reads label counts from an /i/s response (InboxSDK draft-save fixture)', () => {
  const root = fixture<unknown[]>('s-draft-save-response-2022.json');
  const labels = new Map(parseLabels(undefined, root[2]).map((l) => [l.id, l]));
  expect(labels.get('INBOX')).toMatchObject({ unreadCount: 4701, totalCount: 5192 });
  expect(labels.get('DRAFT')).toMatchObject({ unreadCount: 0, totalCount: 39 });
  expect(labels.get('CATEGORY_SOCIAL')).toMatchObject({ unreadCount: 1822, totalCount: 1824 });
  expect(labels.get('^x_4')).toMatchObject({ type: 'user', name: '^x_4' });
  // "^afw" has no numbers: an uncounted label, not a label with zero mail.
  expect([...labels.keys()]).not.toContain('^afw');
});
