import type { InfiniteData } from '@tanstack/react-query';
import { BackendError, type MailBackend } from '../../src/app/data/backend';
import type { LabelChange, LabelId, ThreadPage, ThreadSummary } from '../../src/app/data/types';

const snacks: { message: string; onClick?: () => void }[] = [];
vi.mock('../../src/app/ui/Snackbar', () => ({
  snack: (message: string, options: { action?: { onClick: () => void } } = {}) => snacks.push({ message, onClick: options.action?.onClick }),
  snackbarManager: { close: () => {} },
}));

const { mail, undoLast, deleteEveryPage } = await import('../../src/app/data/actions');
const { keys, queryClient, setBackend, withRecentChanges } = await import('../../src/app/data/client');

function summary(id: string, labelIds: LabelId[]): ThreadSummary {
  return {
    id,
    subject: id,
    snippet: '',
    labelIds,
    participants: [{ email: 'ana@example.com' }],
    messageCount: 1,
    draftCount: 0,
    lastDate: 1,
    hasAttachments: false,
    attachments: [],
  };
}

function fakeBackend() {
  const calls: { ids: string[]; change: LabelChange }[] = [];
  const b = {
    kind: 'demo',
    capabilities: {},
    modifyThreads: vi.fn(async (ids: string[], change: LabelChange) => {
      calls.push({ ids: [...ids], change });
    }),
  } as unknown as MailBackend;
  return { b, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('mail actions undo', () => {
  beforeEach(() => {
    snacks.length = 0;
    queryClient.clear();
  });

  it('undoing mark as read makes only the threads that were unread unread again', async () => {
    const { b, calls } = fakeBackend();
    setBackend(b);
    const data: InfiniteData<ThreadPage> = { pages: [{ threads: [summary('a', ['INBOX', 'UNREAD']), summary('b', ['INBOX'])] }], pageParams: [undefined] };
    queryClient.setQueryData(keys.threads('in:all', { kind: 'folder', folder: 'all' }), data);

    await mail.markRead(['a', 'b'], true);
    calls.length = 0;
    undoLast();
    await flush();

    expect(calls).toEqual([{ ids: ['a'], change: { add: ['UNREAD'], remove: [] } }]);
  });

  it('undoing Move to Inbox from Trash puts it back in Trash only, not in Spam too', async () => {
    const { b, calls } = fakeBackend();
    setBackend(b);
    const data: InfiniteData<ThreadPage> = { pages: [{ threads: [summary('t', ['TRASH'])] }], pageParams: [undefined] };
    queryClient.setQueryData(keys.threads('in:trash', { kind: 'folder', folder: 'trash' }), data);

    await mail.moveToInbox(['t']);
    calls.length = 0;
    undoLast();
    await flush();

    expect(calls).toEqual([{ ids: ['t'], change: { add: ['TRASH'], remove: ['INBOX'] } }]);
  });

  it('undo from the snackbar cannot be run a second time with z', async () => {
    const { b, calls } = fakeBackend();
    setBackend(b);
    await mail.archive(['x']);
    calls.length = 0;
    snacks.find((s) => s.onClick)!.onClick!();
    await flush();
    undoLast();
    await flush();

    expect(calls).toHaveLength(1);
    expect(snacks.at(-1)?.message).toBe('Nothing to undo');
  });

  it('after undo, a list Gmail answers with the old state still shows the thread back in the inbox', async () => {
    const { b } = fakeBackend();
    setBackend(b);
    const inbox = { kind: 'folder', folder: 'inbox' } as const;
    queryClient.setQueryData(keys.threads('in:inbox', inbox), { pages: [{ threads: [summary('u', ['INBOX'])] }], pageParams: [undefined] });
    await mail.archive(['u']);
    undoLast();
    await flush();
    // Gmail hasn't caught up with the undo yet: the thread still reads as archived.
    const stale = withRecentChanges({ threads: [summary('u', [])] }, inbox);
    expect(stale.threads.map((t) => [t.id, t.labelIds])).toEqual([['u', ['INBOX']]]);
  });

  it('undo goes to the backend the action went to, even after a switch', async () => {
    const first = fakeBackend();
    const second = fakeBackend();
    setBackend(first.b);
    await mail.archive(['x']);
    setBackend(second.b);
    undoLast();
    await flush();

    expect(second.calls).toHaveLength(0);
    expect(first.calls.at(-1)).toEqual({ ids: ['x'], change: { add: ['INBOX'], remove: [] } });
  });
});

describe('moving to Trash and deleting forever', () => {
  const inbox = { kind: 'folder', folder: 'inbox' } as const;
  const trash = { kind: 'folder', folder: 'trash' } as const;
  const list = (...threads: ThreadSummary[]): InfiniteData<ThreadPage> => ({ pages: [{ threads }], pageParams: [undefined] });

  beforeEach(() => {
    snacks.length = 0;
    queryClient.clear();
  });

  it('a Trash list loaded before the trash is refetched when next shown, so the conversation turns up there', async () => {
    const b = { kind: 'session', capabilities: {}, trashThreads: vi.fn(async () => {}), untrashThreads: vi.fn(async () => {}) } as unknown as MailBackend;
    setBackend(b);
    queryClient.setQueryData(keys.threads('in:inbox', inbox), list(summary('m', ['INBOX'])));
    queryClient.setQueryData(keys.threads('in:trash', trash), list(summary('old', ['TRASH'])));
    await mail.trash(['m']);
    expect(queryClient.getQueryState(keys.threads('in:trash', trash))?.isInvalidated).toBe(true);
    // Gmail still lists it in the inbox for a moment; it stays gone there.
    expect(withRecentChanges({ threads: [summary('m', ['INBOX'])] }, inbox).threads).toEqual([]);
  });

  it('in All inboxes, a trashed conversation stays out of a stale list under its qualified id', async () => {
    const b = { kind: 'merged', capabilities: {}, trashThreads: vi.fn(async () => {}), untrashThreads: vi.fn(async () => {}) } as unknown as MailBackend;
    setBackend(b);
    const id = 'k1~thread-f:1846473264892611537';
    queryClient.setQueryData(keys.threads('in:inbox', inbox), list(summary(id, ['INBOX'])));
    await mail.trash([id]);
    expect(b.trashThreads).toHaveBeenCalledWith([id]);
    expect(withRecentChanges({ threads: [summary(id, ['INBOX']), summary('k2~thread-f:7', ['INBOX'])] }, inbox).threads.map((t) => t.id)).toEqual(['k2~thread-f:7']);
  });

  it('a conversation deleted forever stays gone from a Trash list Gmail answers with the old state', async () => {
    const b = { kind: 'session', capabilities: { deleteForever: true }, deleteThreadsForever: vi.fn(async () => {}) } as unknown as MailBackend;
    setBackend(b);
    queryClient.setQueryData(keys.threads('in:trash', trash), list(summary('d', ['TRASH'])));
    await mail.deleteForever(['d']);
    expect(withRecentChanges({ threads: [summary('d', ['TRASH']), summary('k', ['TRASH'])] }, trash).threads.map((t) => t.id)).toEqual(['k']);
  });

  it('a delete forever that fails puts the conversation back in Trash', async () => {
    const b = {
      kind: 'session',
      capabilities: { deleteForever: true },
      deleteThreadsForever: vi.fn(async () => Promise.reject(new BackendError("Gmail's page didn't respond. Open classic Gmail to delete it.", 'unknown'))),
    } as unknown as MailBackend;
    setBackend(b);
    queryClient.setQueryData(keys.threads('in:trash', trash), list(summary('f', ['TRASH'])));
    await mail.deleteForever(['f']);
    const cached = queryClient.getQueryData<InfiniteData<ThreadPage>>(keys.threads('in:trash', trash));
    expect(cached?.pages[0]?.threads.map((t) => [t.id, t.labelIds])).toEqual([['f', ['TRASH']]]);
    expect(withRecentChanges({ threads: [summary('f', ['TRASH'])] }, trash).threads.map((t) => t.id)).toEqual(['f']);
  });
});

describe('mail action errors', () => {
  beforeEach(() => {
    snacks.length = 0;
    queryClient.clear();
  });

  it('a server that fails while the browser is online is not called being offline', async () => {
    const { b } = fakeBackend();
    vi.mocked(b.modifyThreads).mockRejectedValueOnce(new BackendError('Gmail had a server error (502). Try again.', 'network', true));
    setBackend(b);
    await mail.archive(['x']);
    expect(snacks.at(-1)?.message).toBe("Couldn't archive.");
    expect(snacks.at(-1)?.message).not.toMatch(/offline/);
  });

  it('Retry on a failed action runs it again', async () => {
    const { b } = fakeBackend();
    vi.mocked(b.modifyThreads).mockRejectedValueOnce(new BackendError('Gmail had a server error (502). Try again.', 'network', true));
    setBackend(b);
    await mail.archive(['x']);
    const failure = snacks.at(-1)!;
    expect(failure.onClick).toBeTypeOf('function');
    failure.onClick!();
    await flush();
    expect(b.modifyThreads).toHaveBeenCalledTimes(2);
    expect(vi.mocked(b.modifyThreads).mock.calls[1]).toEqual([['x'], { remove: ['INBOX'] }]);
    expect(snacks.at(-1)?.message).toBe('Conversation archived');
  });

  it('says offline when the browser is', async () => {
    const { b } = fakeBackend();
    vi.mocked(b.modifyThreads).mockRejectedValueOnce(new BackendError("Couldn't reach Gmail.", 'network', true));
    setBackend(b);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await mail.archive(['x']);
    expect(snacks.at(-1)?.message).toMatch(/offline/);
    vi.restoreAllMocks();
  });
});


describe('emptying Trash and Spam', () => {
  beforeEach(() => {
    snacks.length = 0;
    queryClient.clear();
  });

  const withEmpty = (emptyFolder: MailBackend['emptyFolder']) =>
    ({ kind: 'session', capabilities: { deleteForever: true }, emptyFolder, listThreads: vi.fn(), deleteThreadsForever: vi.fn() }) as unknown as MailBackend;

  it('shows progress, then how many conversations went', async () => {
    setBackend(withEmpty(vi.fn(async () => 1234)));
    await mail.emptyFolder('trash');
    expect(snacks.map((s) => s.message)).toEqual(['Emptying Trash…', 'Trash emptied. 1,234 conversations deleted forever']);
  });

  it('passes on what the backend says is left, with a way to classic Gmail', async () => {
    const left = "Couldn't empty Trash: Gmail still lists 3 conversations there. Open classic Gmail to finish.";
    setBackend(withEmpty(vi.fn(async () => Promise.reject(new BackendError(left, 'unknown')))));
    await mail.emptyFolder('trash');
    expect(snacks.at(-1)?.message).toBe(left);
    expect(snacks.at(-1)?.onClick).toBeTypeOf('function');
  });

  it('never reports success on an unexplained failure', async () => {
    setBackend(withEmpty(vi.fn(async () => Promise.reject(new Error('boom')))));
    await mail.emptyFolder('spam');
    expect(snacks.map((s) => s.message)).toEqual(['Deleting all spam…', "Couldn't empty Spam. Open classic Gmail to finish."]);
  });

  it('without a folder-wide call, deletes every page, not just the loaded one', async () => {
    let trash = Array.from({ length: 250 }, (_, i) => summary(`t${i}`, ['TRASH']));
    const b = {
      listThreads: vi.fn(async ({ pageSize }: { pageSize: number }) => ({ threads: trash.slice(0, pageSize) })),
      deleteThreadsForever: vi.fn(async (ids: string[]) => {
        trash = trash.filter((t) => !ids.includes(t.id));
      }),
    } as unknown as MailBackend;
    expect(await deleteEveryPage(b, 'trash')).toBe(250);
    expect(trash).toEqual([]);
    expect(b.deleteThreadsForever).toHaveBeenCalledTimes(3);
    expect(vi.mocked(b.listThreads).mock.calls.every(([q]) => q.q === 'in:trash')).toBe(true);
  });

  it('stops instead of looping when a batch would not delete', async () => {
    const stuck = [summary('t1', ['TRASH'])];
    const b = { listThreads: vi.fn(async () => ({ threads: stuck })), deleteThreadsForever: vi.fn(async () => {}) } as unknown as MailBackend;
    await expect(deleteEveryPage(b, 'trash')).rejects.toThrow(/Open classic Gmail to finish/);
    expect(b.deleteThreadsForever).toHaveBeenCalledTimes(1);
  });
});
