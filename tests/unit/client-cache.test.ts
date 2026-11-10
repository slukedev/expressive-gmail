import type { InfiniteData } from '@tanstack/react-query';
import { adjustUnread, applyLabelChange, forgetChange, keys, patchThreads, pruneAfterCollapse, pruneLists, queryClient, rememberChange, shareListById, withPendingUnread, withRecentChanges } from '../../src/app/data/client';
import type { Label, LabelId, Message, Thread, ThreadPage, ThreadSummary } from '../../src/app/data/types';
import type { View } from '../../src/app/router/routes';

const DATE = new Date(2026, 9, 8, 9, 0).getTime();

function summary(id: string, labelIds: LabelId[]): ThreadSummary {
  return {
    id,
    subject: `Subject ${id}`,
    snippet: '',
    labelIds,
    participants: [{ name: 'Ana Lopez', email: 'ana@x.com' }],
    messageCount: 2,
    draftCount: 0,
    lastDate: DATE,
    hasAttachments: false,
    attachments: [],
  };
}

function message(id: string, labelIds: LabelId[]): Message {
  return { id, threadId: 't1', labelIds, from: { email: 'ana@x.com' }, to: [], cc: [], bcc: [], date: DATE, subject: 's', snippet: '', attachments: [], headers: {} };
}

const list = (...threads: ThreadSummary[]): InfiniteData<ThreadPage> => ({ pages: [{ threads }], pageParams: [undefined] });
const listIds = (q: string, view: View) => queryClient.getQueryData<InfiniteData<ThreadPage>>(keys.threads(q, view))?.pages.flatMap((p) => p.threads.map((t) => t.id));
const listThread = (q: string, view: View, id: string) =>
  queryClient.getQueryData<InfiniteData<ThreadPage>>(keys.threads(q, view))?.pages.flatMap((p) => p.threads).find((t) => t.id === id);

describe('applyLabelChange', () => {
  it.each<[string, LabelId[], { add?: LabelId[]; remove?: LabelId[] }, LabelId[]]>([
    ['adds a label', ['INBOX'], { add: ['STARRED'] }, ['INBOX', 'STARRED']],
    ['adding a present label does not duplicate it', ['INBOX', 'STARRED'], { add: ['STARRED', 'STARRED'] }, ['INBOX', 'STARRED']],
    ['removes a label', ['INBOX', 'UNREAD'], { remove: ['UNREAD'] }, ['INBOX']],
    ['removing a missing label is a no-op', ['INBOX'], { remove: ['TRASH'] }, ['INBOX']],
    ['a label both added and removed ends up present', ['INBOX'], { add: ['Label_1'], remove: ['Label_1', 'INBOX'] }, ['Label_1']],
    ['an empty change keeps everything', ['INBOX', 'UNREAD'], {}, ['INBOX', 'UNREAD']],
  ])('%s', (_name, before, change, after) => {
    const t = summary('t1', before);
    const next = applyLabelChange(t, change);
    expect([...next.labelIds].sort()).toEqual([...after].sort());
    expect(t.labelIds).toEqual(before);
    expect(next.subject).toBe(t.subject);
  });
});

describe('patchThreads and pruneLists', () => {
  const inbox: View = { kind: 'folder', folder: 'inbox' };
  const starred: View = { kind: 'folder', folder: 'starred' };
  const work: View = { kind: 'label', label: 'Work' };
  const search: View = { kind: 'search', query: 'from:ana' };
  const LABELS: Label[] = [{ id: 'Label_1', name: 'Work', type: 'user' }];

  beforeEach(() => {
    queryClient.clear();
    const t1 = summary('t1', ['INBOX', 'STARRED', 'Label_1', 'UNREAD']);
    const t2 = summary('t2', ['INBOX', 'STARRED']);
    queryClient.setQueryData(keys.labels, LABELS);
    queryClient.setQueryData(keys.threads('in:inbox', inbox), list(t1, t2));
    queryClient.setQueryData(keys.threads('is:starred', starred), list(t1, t2));
    queryClient.setQueryData(keys.threads('label:Work', work), list(t1));
    queryClient.setQueryData(keys.threads('from:ana', search), list(t1));
    queryClient.setQueryData<Thread>(keys.thread('t1'), {
      ...t1,
      messages: [message('m1', ['SENT']), message('m2', ['INBOX', 'STARRED', 'Label_1', 'UNREAD'])],
    });
  });

  afterAll(() => {
    queryClient.clear();
  });

  it('archiving removes the thread from the inbox only', () => {
    patchThreads(['t1'], (t) => applyLabelChange(t, { remove: ['INBOX'] }));
    pruneLists();

    expect(listIds('in:inbox', inbox)).toEqual(['t2']);
    expect(listIds('is:starred', starred)).toEqual(['t1', 't2']);
    expect(listIds('label:Work', work)).toEqual(['t1']);
    expect(listIds('from:ana', search)).toEqual(['t1']);
    expect(listThread('is:starred', starred, 't1')?.labelIds).not.toContain('INBOX');
    expect(listThread('is:starred', starred, 't2')?.labelIds).toContain('INBOX');
  });

  it('the open thread and its messages follow the change', () => {
    patchThreads(['t1'], (t) => applyLabelChange(t, { add: ['IMPORTANT'], remove: ['INBOX', 'UNREAD'] }));
    const thread = queryClient.getQueryData<Thread>(keys.thread('t1'))!;
    expect([...thread.labelIds].sort()).toEqual(['IMPORTANT', 'Label_1', 'STARRED']);
    expect(thread.messages.map((m) => [...m.labelIds].sort())).toEqual([
      ['IMPORTANT', 'SENT'],
      ['IMPORTANT', 'Label_1', 'STARRED'],
    ]);
  });

  it('removing a user label drops the thread from that label list, found by name', () => {
    patchThreads(['t1'], (t) => applyLabelChange(t, { remove: ['Label_1'] }));
    pruneLists();
    expect(listIds('label:Work', work)).toEqual([]);
    expect(listIds('in:inbox', inbox)).toEqual(['t1', 't2']);
  });

  it('trashing drops the thread from every list, searches included', () => {
    patchThreads(['t1'], (t) => applyLabelChange(t, { add: ['TRASH'] }));
    pruneLists();
    expect(listIds('in:inbox', inbox)).toEqual(['t2']);
    expect(listIds('is:starred', starred)).toEqual(['t2']);
    expect(listIds('label:Work', work)).toEqual([]);
    expect(listIds('from:ana', search)).toEqual([]);
  });

  it('an archived row keeps its slot through another prune until its collapse has played', () => {
    vi.useFakeTimers();
    try {
      patchThreads(['t1'], (t) => applyLabelChange(t, { remove: ['INBOX'] }));
      pruneAfterCollapse(['t1'], 460);
      // Opening the next thread marks it read, which prunes straight away.
      patchThreads(['t2'], (t) => applyLabelChange(t, { remove: ['UNREAD'] }));
      pruneLists();
      expect(listIds('in:inbox', inbox)).toEqual(['t1', 't2']);
      vi.advanceTimersByTime(460);
      expect(listIds('in:inbox', inbox)).toEqual(['t2']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a patch for a thread that is not cached changes nothing', () => {
    const before = queryClient.getQueryData(keys.threads('in:inbox', inbox));
    patchThreads(['t9'], (t) => applyLabelChange(t, { remove: ['INBOX'] }));
    pruneLists();
    expect(queryClient.getQueryData(keys.threads('in:inbox', inbox))).toEqual(before);
    expect(queryClient.getQueryData(keys.thread('t9'))).toBeUndefined();
  });
});

describe('recent changes over stale list pages', () => {
  const inbox: View = { kind: 'folder', folder: 'inbox' };
  const trash: View = { kind: 'folder', folder: 'trash' };
  // Gmail answering a list request with the state from before the write.
  const stale = (): ThreadPage => ({ threads: [summary('a', ['INBOX']), summary('b', ['INBOX', 'UNREAD'])] });
  afterEach(() => forgetChange(['a', 'b']));

  it('keeps a trashed thread out of the inbox when a stale page arrives, and shows it in Trash', () => {
    rememberChange(['a'], { add: ['TRASH'], remove: ['INBOX'] }, DATE);
    expect(withRecentChanges(stale(), inbox, DATE + 2_000).threads.map((t) => t.id)).toEqual(['b']);
    expect(withRecentChanges(stale(), trash, DATE + 2_000).threads.find((t) => t.id === 'a')?.labelIds).toEqual(['TRASH']);
  });

  it('applies several changes to one thread in order, so read-then-archive stays both', () => {
    rememberChange(['b'], { remove: ['UNREAD'] }, DATE);
    rememberChange(['b'], { remove: ['INBOX'] }, DATE + 500);
    const all: View = { kind: 'folder', folder: 'all' };
    expect(withRecentChanges(stale(), all, DATE + 1_000).threads.find((t) => t.id === 'b')?.labelIds).toEqual([]);
    expect(withRecentChanges(stale(), inbox, DATE + 1_000).threads.map((t) => t.id)).toEqual(['a']);
  });

  it('lets the server win again after undo, and after the change has had time to settle', () => {
    rememberChange(['a'], { add: ['TRASH'], remove: ['INBOX'] }, DATE);
    forgetChange(['a']);
    expect(withRecentChanges(stale(), inbox, DATE + 1_000).threads.map((t) => t.id)).toEqual(['a', 'b']);

    rememberChange(['a'], { add: ['TRASH'], remove: ['INBOX'] }, DATE);
    expect(withRecentChanges(stale(), inbox, DATE + 31_000).threads.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('withPendingUnread', () => {
  const inbox = (unreadCount: number): Label[] => [{ id: 'INBOX', name: 'INBOX', type: 'system', unreadCount }];
  const shown = () => queryClient.getQueryData<Label[]>(keys.labels)?.[0]?.unreadCount;
  const read = (id: string) => adjustUnread(new Map([['INBOX', -1]]), [id]);

  beforeEach(() => {
    queryClient.clear();
    forgetChange(['t1', 't2']);
    queryClient.setQueryData(keys.labels, inbox(29));
  });

  it('keeps a read showing while the server still answers with the old count', () => {
    read('t1');
    expect(shown()).toBe(28);
    expect(withPendingUnread(inbox(29))[0]!.unreadCount).toBe(28);
  });

  it('lets go once the server count moves', () => {
    read('t1');
    expect(withPendingUnread(inbox(28))[0]!.unreadCount).toBe(28);
    // New mail after that is the server's to report.
    expect(withPendingUnread(inbox(29))[0]!.unreadCount).toBe(29);
  });

  it('stacks two changes and drops only the one the server has', () => {
    read('t1');
    read('t2');
    expect(withPendingUnread(inbox(29))[0]!.unreadCount).toBe(27);
    expect(withPendingUnread(inbox(28))[0]!.unreadCount).toBe(27);
  });

  it('an undo lets go of its own change only, and old changes give way to the server', () => {
    read('t1');
    read('t2');
    forgetChange(['t1']);
    expect(withPendingUnread(inbox(29))[0]!.unreadCount).toBe(28);
    forgetChange(['t2']);
    expect(withPendingUnread(inbox(29))[0]!.unreadCount).toBe(29);
    read('t1');
    expect(withPendingUnread(inbox(29), Date.now() + 60_000)[0]!.unreadCount).toBe(29);
  });

  it("adjusts a category's inbox tab apart from its own count, and leaves an uncounted tab unknown", () => {
    const updates = (unreadCount: number, inboxUnreadCount?: number): Label[] => [
      { id: 'CATEGORY_UPDATES', name: 'CATEGORY_UPDATES', type: 'system', unreadCount, ...(inboxUnreadCount === undefined ? {} : { inboxUnreadCount }) },
    ];
    // Archiving an unread update: the tab drops by one, the label keeps it.
    queryClient.setQueryData(keys.labels, updates(40, 5));
    adjustUnread(new Map([['CATEGORY_UPDATES', -1]]), ['t1'], 'inboxUnreadCount');
    expect(queryClient.getQueryData<Label[]>(keys.labels)![0]).toMatchObject({ unreadCount: 40, inboxUnreadCount: 4 });
    expect(withPendingUnread(updates(40, 5))[0]).toMatchObject({ unreadCount: 40, inboxUnreadCount: 4 });
    forgetChange(['t1']);
    expect(withPendingUnread(updates(40, 5))[0]!.inboxUnreadCount).toBe(5);

    queryClient.setQueryData(keys.labels, updates(40));
    adjustUnread(new Map([['CATEGORY_UPDATES', -1]]), ['t2'], 'inboxUnreadCount');
    expect(queryClient.getQueryData<Label[]>(keys.labels)![0]!.inboxUnreadCount).toBeUndefined();
  });
});

describe('shareListById', () => {
  it('keeps the objects of unchanged threads when a row above them leaves', () => {
    const [a, b, c] = [summary('a', ['INBOX']), summary('b', ['INBOX']), summary('c', ['INBOX'])];
    const fresh = list(...[b, c].map((t) => ({ ...t, labelIds: [...t.labelIds] })));
    const shared = shareListById(list(a, b, c), fresh) as InfiniteData<ThreadPage>;
    expect(shared.pages[0]!.threads[0]).toBe(b);
    expect(shared.pages[0]!.threads[1]).toBe(c);
  });

  it('hands over a new object for a thread that changed', () => {
    const b = summary('b', ['INBOX']);
    const shared = shareListById(list(summary('a', ['INBOX']), b), list({ ...b, labelIds: ['INBOX', 'STARRED'] })) as InfiniteData<ThreadPage>;
    expect(shared.pages[0]!.threads[0]).not.toBe(b);
    expect(shared.pages[0]!.threads[0]!.labelIds).toEqual(['INBOX', 'STARRED']);
  });
});
