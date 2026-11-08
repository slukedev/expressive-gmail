import { parseThreadList } from '../../src/session/parse-list';
import { fixture } from './helpers';

describe('bv response from gmail.js (2020, converted)', () => {
  const parsed = parseThreadList(fixture('bv-2020-gmailjs.json'));

  it('reads paging signals and the history id', () => {
    expect(parsed.threads).toHaveLength(2);
    expect(parsed.hasMore).toBe(true);
    expect(parsed.total).toBe(93);
    expect(parsed.historyId).toBe(37377);
  });

  it('summarizes a two-message thread with attachment chips from both messages', () => {
    const thread = parsed.threads[0]!;
    expect(thread.id).toBe('thread-a:r873907427374440696');
    expect(thread.labelIds).toEqual(expect.arrayContaining(['SENT', 'INBOX', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL']));
    expect(thread.participants.map((p) => p.name)).toEqual(['Eli', 'Erin']);
    expect(thread.messageCount).toBe(2);
    expect(thread.attachments.map((a) => [a.filename, a.messageId])).toEqual([
      ['work.txt', 'msg-a:r-5459297729901660292'],
      ['work.txt', 'msg-f:1665118316230599953'],
    ]);
    expect(parsed.messageIds.get(thread.id)).toEqual(['msg-a:r-5459297729901660292', 'msg-f:1665118316230599953']);
  });

  it('names nested user labels from the definitions and attaches counts', () => {
    const labels = parsed.labels!;
    expect(labels.find((l) => l.id === '^x_2')).toEqual({ id: '^x_2', name: 'tomas', type: 'user', unreadCount: 4, totalCount: 605 });
    expect(labels.find((l) => l.id === '^x_7226947756122782844')?.name).toBe('Ops/1');
    expect(labels.find((l) => l.id === 'INBOX')).toEqual({ id: 'INBOX', name: 'INBOX', type: 'system', unreadCount: 19, totalCount: 84 });
  });
});

describe('current bv shape', () => {
  const parsed = parseThreadList(fixture('bv-current.json'));
  const byId = new Map(parsed.threads.map((t) => [t.id, t]));

  it('skips rows without a thread id and strips the "|msg-f" suffix', () => {
    expect(parsed.threads.map((t) => t.id)).toEqual([
      'thread-f:1846473264892611537',
      'thread-f:1846400000000000001',
      'thread-a:r-5102948271633409112',
      'thread-a:r881726354019283746',
    ]);
  });

  it('counts the draft apart from sent messages and keeps the unicode subject', () => {
    const cafe = byId.get('thread-f:1846473264892611537')!;
    expect(cafe.subject).toBe('Café ☕ in Zürich 🇨🇭 next week?');
    expect(cafe.messageCount).toBe(3);
    expect(cafe.draftCount).toBe(1);
    expect(cafe.labelIds).toEqual(expect.arrayContaining(['INBOX', 'UNREAD', 'IMPORTANT', 'SENT', 'DRAFT', 'CATEGORY_PERSONAL']));
    expect(cafe.participants.map((p) => p.email)).toEqual(['ada@example.com', 'grace@example.org']);
    expect(cafe.lastDate).toBe(1760000300000);
  });

  it('maps stars, promotions and user labels, and hides inline images from chips', () => {
    const order = byId.get('thread-f:1846400000000000001')!;
    expect(order.labelIds).toEqual(['INBOX', 'CATEGORY_PROMOTIONS', 'STARRED', '^x_17']);
    expect(order.attachments).toEqual([
      { id: '0.1', filename: 'invoice-4821.pdf', mimeType: 'application/pdf', messageId: 'msg-f:1846400000000000001', size: 48211 },
    ]);
    expect(order.messageCount).toBe(1);
  });

  it('exposes the scheduled time of a scheduled send', () => {
    expect(byId.get('thread-a:r881726354019283746')!.scheduledFor).toBe(1761000000000);
  });

  it('reads labels, including a counted user label with no definition', () => {
    const labels = new Map(parsed.labels!.map((l) => [l.id, l]));
    expect(labels.get('^x_17')).toEqual({ id: '^x_17', name: 'Work/Projects', type: 'user', unreadCount: 2, totalCount: 40 });
    expect(labels.get('^x_99')?.name).toBe('^x_99');
    expect(labels.get('CATEGORY_SOCIAL')?.unreadCount).toBe(5);
    expect(labels.get('SNOOZED')).toEqual({ id: 'SNOOZED', name: 'SNOOZED', type: 'system' });
    expect(parsed.total).toBe(412);
  });
});

describe('search view layout', () => {
  it('finds rows under [15] and reports the last page', () => {
    const parsed = parseThreadList(fixture('bv-search-current.json'));
    expect(parsed.threads.map((t) => t.id)).toEqual(['thread-a:r-5102948271633409112', 'thread-a:r881726354019283746']);
    expect(parsed.hasMore).toBe(false);
    expect(parsed.historyId).toBe(4100400);
    expect(parsed.labels).toBeUndefined();
  });
});

it.each([null, [], [0, null, null], [0, [], [[null, 1], ['x', 2]]]])('returns an empty page for %j', (input) => {
  expect(parseThreadList(input).threads).toEqual([]);
});
