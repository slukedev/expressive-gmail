import {
  appendOp,
  composeBody,
  composeMessage,
  fetchThreadsBody,
  labelChangeBody,
  newThreadOp,
  pollBody,
  threadListBody,
  updateOp,
  type ComposeFields,
} from '../../src/session/requests';
import { fixture } from './helpers';

type Json = any;

/** Rebuild one of Gmail's own compose messages from its fields and compare slot by slot. */
function rebuild(original: Json[], extra: Partial<ComposeFields> = {}): Json[] {
  const contacts = (list: Json[] | null) =>
    (list ?? []).map((c: Json[]) => (c[2] ? { email: c[1], name: c[2] } : { email: c[1] }));
  return composeMessage({
    messageId: original[0],
    from: { email: original[1][1], name: original[1][2] },
    to: contacts(original[2]),
    cc: contacts(original[3]),
    bcc: contacts(original[4]),
    subject: original[7],
    html: original[8][1][0][1],
    labels: original[10],
    inReplyTo: original[15] ?? undefined,
    syncRef: (original[51] as string).split('|')[0]!,
    now: original[6],
    ...extra,
  });
}

/**
 * Slots Gmail fills that we deliberately don't: [35]/[36] (absent from its 2023
 * requests) and the [42] edit counter. Pass 8 to also skip the body, for
 * fixtures whose body Gmail split into a quoted part.
 */
function comparable(message: Json[], ...skip: number[]): Json[] {
  return message.map((v, i) => ([35, 36, 42, ...skip].includes(i) ? 'skip' : v));
}

describe('compose requests match what Gmail sends', () => {
  it('sending a saved draft: thread slot [13], send envelope (InboxSDK cvOnSend_3)', () => {
    const real: Json = fixture('s-send-request-2022.json');
    const [opId, [threadId, slots]] = real[1][0][0];
    const original = slots[13][0];
    const op: Json = updateOp(opId, threadId, rebuild(original), null, original[6]);
    expect(comparable(op[1][1][13][0])).toEqual(comparable(original));
    expect(op[1][1][13].slice(1)).toEqual(slots[13].slice(1));
    expect(op[1][1].slice(0, 13)).toEqual(slots.slice(0, 13));

    const [sessionStart, , now, , counter] = real[3];
    const body = composeBody('send', [op], 999, { sessionStart, now, counter });
    expect(body[0]).toEqual(real[0]);
    expect(body[2]).toBe(real[2]);
    expect(body[3]).toEqual([sessionStart, 1, now, 1, counter]);
    expect(body[4]).toBe(real[4]);
  });

  it('a reply sent without a draft: thread slot [1] naming the answered message (InboxSDK cvOnReplySend_5)', () => {
    const real: Json = fixture('s-reply-send-request-2023.json');
    const [opId, [threadId, slots]] = real[1][0][1];
    const [original, replyToId, , , [ts]] = slots[1];
    const op: Json = appendOp(opId, threadId, rebuild(original), replyToId, ts);
    expect(comparable(op[1][1][1][0], 8)).toEqual(comparable(original, 8));
    expect(op[1][1][1][0][8]).toEqual([null, [[0, original[8][1][0][1]]], null, null, null, null, 1]);
    expect(op[1][1][1].slice(1)).toEqual(slots[1].slice(1));
    expect(op[1][1][0]).toBeNull();
  });

  it('first save of a new draft: thread slot [2] and the save envelope (InboxSDK cvOnDraftSave)', () => {
    const real: Json = fixture('s-draft-save-request-2022.json');
    const [opId, [threadId, slots]] = real[1][0][0];
    const [[threadSubject, , ts, , [original]]] = slots[2];
    const op: Json = newThreadOp(opId, threadId, threadSubject, rebuild(original), ts);
    expect(comparable(op[1][1][2][0][4][0])).toEqual(comparable(original));
    expect(op[1][1][2][0].slice(0, 4)).toEqual(slots[2][0].slice(0, 4));

    const [sessionStart, , now, , counter] = real[3];
    const body = composeBody('save', [op], real[2][1], { sessionStart, now, counter });
    expect(body[0]).toBeNull();
    expect(body[2]).toEqual(real[2]);
    expect(body[3]).toEqual(real[3]);
  });

  it('a reply draft update keeps In-Reply-To in [15] (InboxSDK cvOnReplyDraftSave)', () => {
    const real: Json = fixture('s-reply-draft-save-request-2022.json');
    const original = real[1][0][0][1][1][1][0];
    const rebuilt = rebuild(original);
    expect(rebuilt[15]).toBe('<20221007132948.3ca489969d9cc1c5@cio14991.pipeline.example>');
    expect(comparable(rebuilt, 8)).toEqual(comparable(original, 8));
  });

  it('omits empty recipient lists and names, as Gmail does', () => {
    const m = composeMessage({
      messageId: 'msg-a:r1',
      from: { email: 'ada@example.com' },
      to: [{ email: 'grace@example.org' }],
      cc: [],
      bcc: [],
      subject: 'Hi',
      html: '<div dir="ltr">Hi</div>',
      labels: ['^all', '^r', '^r_bt'],
      syncRef: 's:0011223344556677',
      now: 1,
    });
    expect(m).toHaveLength(52);
    expect(m[1]).toEqual([1, 'ada@example.com', null, null, null, null, null, null, null, 'ada@example.com']);
    expect(m[2]).toEqual([[1, 'grace@example.org']]);
    expect(m[3]).toBeNull();
    expect(m[11]).toBeNull();
    expect(m[15]).toBeNull();
    expect(m[51]).toBe('s:0011223344556677|#msg-a:r1|0');
  });
});

describe('label change request', () => {
  it('puts the change where Gmail\'s own archive request does', () => {
    const real: Json = fixture('s-archive-request-2018-gmailjs.json');
    const [, [threadId, slots]] = real[1][0][0];
    const [add, remove, messageIds] = slots[6];
    const body: Json = labelChangeBody([{ threadId, messageIds, add, remove }], 1, 1153798, { sessionStart: 1, now: 2, counter: 3 });
    const ours = body[1][0][0][1];
    expect(ours[0]).toBe(threadId);
    expect(ours[1].slice(0, 6)).toEqual(slots.slice(0, 6));
    expect(ours[1][6]).toEqual([add, remove, messageIds]);
    expect(body[2]).toEqual([1, 1153798, null, null, [null, 0], null, 1]);
    expect(body[4]).toBe(2);
  });

  it('sends null for an empty side, like Gmail\'s 2023 "^io_lr" op', () => {
    const real: Json = fixture('s-reply-send-request-2023.json');
    const [, [threadId, slots]] = real[1][0][0];
    const body: Json = labelChangeBody([{ threadId, messageIds: slots[6][2], add: ['^io_lr'], remove: [] }], 140, undefined, {
      sessionStart: 1,
      now: 2,
      counter: 3,
    });
    expect(body[1][0][0]).toEqual(real[1][0][0]);
    expect(body[2]).toBeNull();
  });

  it('numbers one op per thread', () => {
    const body: Json = labelChangeBody(
      [
        { threadId: 'thread-f:1', messageIds: ['msg-f:1'], add: ['^k'], remove: [] },
        { threadId: 'thread-f:2', messageIds: ['msg-f:2'], add: ['^k'], remove: [] },
      ],
      7,
      undefined,
      { sessionStart: 1, now: 2, counter: 3 },
    );
    expect(body[1][0].map((op: Json) => [op[0], op[1][0]])).toEqual([
      [7, 'thread-f:1'],
      [8, 'thread-f:2'],
    ]);
  });
});

describe('read requests', () => {
  it('fetches whole threads the way Gmail\'s client does', () => {
    expect(fetchThreadsBody(['thread-f:7160586525412252733'])).toEqual([[['thread-f:7160586525412252733', 1]], 2]);
  });

  it('puts the query at [0][3] and the page start at [0][9]', () => {
    expect(threadListBody('in:inbox', 0, 50)).toEqual([[null, 50, null, 'in:inbox']]);
    const page2 = threadListBody('from:grace has:attachment', 100, 50) as Json;
    expect(page2[0][3]).toBe('from:grace has:attachment');
    expect(page2[0][9]).toBe(100);
    expect(page2[0]).toHaveLength(10);
  });

  it('polls with the last history id in the sync state slot', () => {
    expect(pollBody(3254694, { sessionStart: 10, now: 20, counter: 284 })).toEqual([
      null,
      null,
      [1, 3254694, null, null, [null, 0], null, 1],
      [10, 0, null, 0, 284],
      2,
    ]);
  });
});
