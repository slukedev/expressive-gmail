import { parseAcks, parsePoll, parseUpdatedThreads } from '../../src/session/parse-sync';
import { fixture } from './helpers';

describe('/i/s write responses (InboxSDK fixtures)', () => {
  it('reads the per-op acknowledgement', () => {
    expect(parseAcks(fixture('s-send-response-2022.json'))).toEqual([{ op: 84, status: 0 }]);
    expect(parseAcks(fixture('s-ack-rejected.json'))).toEqual([{ op: 1, status: 3 }]);
  });

  it('reads back the sent message with its Gmail-assigned labels and Message-ID', () => {
    const [thread] = parseUpdatedThreads(fixture('s-send-response-2022.json'));
    expect(thread!.id).toBe('thread-a:r-8891700334768116294');
    const message = thread!.messages[0]!;
    expect(message.id).toBe('msg-a:r-329565169840451245');
    expect(message.labelIds).toEqual(['SENT', 'INBOX', 'UNREAD']);
    expect(message.headers.messageId).toBe('<CAGx7AOQiYaKpc6Zb5=+mRqU3K-WF+G3KxmmaYKdzCisHqSaRAQ@mail.gmail.com>');
    expect(message.bcc).toEqual([{ email: 'test+bcc@test.com', name: 'test bcc' }]);
  });

  it('reads a saved draft as a draft', () => {
    const [thread] = parseUpdatedThreads(fixture('s-draft-save-response-2022.json'));
    expect(thread!.messages[0]).toMatchObject({ id: 'msg-a:r8190137112111191537', isDraft: true, labelIds: ['DRAFT'] });
    expect(thread!.draftCount).toBe(1);
  });

  it('keeps both messages of a reply thread, oldest first', () => {
    const [thread] = parseUpdatedThreads(fixture('s-reply-send-response-2023.json'));
    expect(thread!.messages.map((m) => m.id)).toEqual(['msg-a:r2752434536700201264', 'msg-a:r5645180764593433440']);
  });

  it('returns nothing for an ack-only response', () => {
    expect(parseUpdatedThreads(fixture('s-ack-ok.json'))).toEqual([]);
  });
});

describe('poll responses', () => {
  it('reports nothing for a quiet poll', () => {
    const poll = parsePoll(fixture('s-poll-quiet.json'));
    expect(poll).toMatchObject({ historyId: 4100500, threadIds: [] });
    expect(poll.labelCounts.get('^i')).toEqual({ unread: 12, total: 340 });
  });

  it('collects thread ids from both change lists, without "|msg" suffixes or duplicates', () => {
    const poll = parsePoll(fixture('s-poll-changed.json'));
    expect(poll.historyId).toBe(4100600);
    expect(poll.threadIds.sort()).toEqual(['thread-f:1846473264892611537', 'thread-f:1846500000000000007']);
  });

  it('survives a truncated body', () => {
    expect(parsePoll([null, [0]])).toEqual({ historyId: undefined, threadIds: [], labelCounts: new Map() });
  });
});
