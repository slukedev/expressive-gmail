import { createHash } from 'node:crypto';
import { SessionBackend, type SessionBackendOptions } from '../../src/session/backend';
import { GmailPageError, type GmailPage } from '../../src/session/gmail-page';
import { DRAFT_LABELS, SEND_LABELS } from '../../src/session/requests';
import { FALLBACK_API_KEY } from '../../src/session/contacts';
import { FakeTokens, SESSION, fakeFetch, fixture, json, rejection, status, type Call } from './helpers';

type Json = any;

const NOW = 1_760_000_000_000;
/** Deterministic ids: every random byte is 1, so new ids end in 72340172838076673. */
const ONES = (b: Uint8Array<ArrayBuffer>) => b.fill(1);
const NEW_THREAD = 'thread-a:r72340172838076673';
const NEW_MESSAGE = 'msg-a:r72340172838076673';

function backend(fetchImpl: typeof fetch, options: SessionBackendOptions = {}) {
  return new SessionBackend({
    tokens: new FakeTokens(),
    fetch: fetchImpl,
    now: () => NOW,
    random: ONES,
    sleep: async () => {},
    ...options,
  });
}

/** A minimal /i/s echo of one thread holding `messageId` with the given labels. */
function echo(threadId: string, messageId: string, labels: string[]) {
  const message: Json[] = new Array(56).fill(null);
  Object.assign(message, { 0: messageId, 1: [1, 'ada@example.com', 'Ada'], 6: NOW, 7: 'Hi', 10: labels });
  const thread: Json[] = ['Hi', '', NOW, threadId, [message]];
  return [[[[9, 0, null, 5]]], [0, null, null, null, [], [[[threadId, null, [null, null, null, null, null, null, [thread]]], 5]], 0, 5], [[]], [5]];
}

const CAFE = 'thread-f:1846473264892611537';
const TRIP = 'thread-f:1846500000000000007';

/** bv-current with the first thread's messages relabelled, as an fd response would carry it. */
function cafeAfter(mutate: (labels: string[]) => string[]) {
  const thread = structuredClone(fixture<Json>('bv-current.json')[2][0][0]);
  for (const m of thread[4]) m[10] = mutate(m[10]);
  return [0, [thread], null, null, [4100999]];
}

describe('listThreads', () => {
  it('signs the request like Gmail and returns a page with a next token', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('bv-current.json')));
    const page = await backend(fetch).listThreads({ q: 'in:inbox' });
    const [call] = calls as [Call];
    expect(call.url).toBe('https://mail.google.com/sync/u/1/i/bv?hl=en&c=0&rt=r&pt=ji');
    expect(call.init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Framework-Xsrf-Token': SESSION.xsrf, 'X-Gmail-BTAI': SESSION.btai, 'Content-Type': 'application/json' },
    });
    expect(call.body).toEqual([[null, 50, null, 'in:inbox']]);
    expect(page.threads).toHaveLength(4);
    expect(page.resultSizeEstimate).toBe(412);
    expect(page.nextPageToken).toBeDefined();
  });

  it("reads a search count Gmail stopped at as a floor", async () => {
    const capped = fixture<Json>('bv-current.json');
    capped[11] = [2, 201];
    const { fetch } = fakeFetch(json(capped));
    const page = await backend(fetch).listThreads({ q: 'larger:10M' });
    expect(page.resultSizeEstimate).toBe(200);
    expect(page.resultSizeAtLeast).toBe(true);
  });

  it('asks for the next page by offset and stops when Gmail says there is no more', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('bv-current.json')), json(fixture('bv-search-current.json')));
    const b = backend(fetch);
    const first = await b.listThreads({ q: 'label:work', pageSize: 4 });
    const second = await b.listThreads({ q: 'label:work', pageSize: 4, pageToken: first.nextPageToken });
    expect((calls[1]!.body as Json)[0][9]).toBe(4);
    expect(second.threads.map((t) => t.id)).toEqual(['thread-a:r-5102948271633409112', 'thread-a:r881726354019283746']);
    expect(second.nextPageToken).toBeUndefined();
  });

  it('refuses to loop when Gmail ignores the offset and repeats page one', async () => {
    const { fetch } = fakeFetch(json(fixture('bv-current.json')), json(fixture('bv-current.json')));
    const b = backend(fetch);
    const first = await b.listThreads({ q: 'in:inbox' });
    const err = await rejection(b.listThreads({ q: 'in:inbox', pageToken: first.nextPageToken }));
    expect(err.code).toBe('unsupported');
  });

  it('rejects a garbled page token without calling Gmail', async () => {
    const { fetch, calls } = fakeFetch();
    const err = await rejection(backend(fetch).listThreads({ q: '', pageToken: 'nope~x' }));
    expect(err.code).toBe('not-found');
    expect(calls).toHaveLength(0);
  });
});

describe('transport failures', () => {
  const redirectedToLogin = () => {
    const response = new Response('<html></html>', { status: 200 });
    Object.defineProperty(response, 'redirected', { value: true });
    Object.defineProperty(response, 'url', { value: 'https://accounts.google.com/ServiceLogin?service=mail' });
    return response;
  };

  it.each([
    ['401', status(401), 'unauthenticated', false],
    ['a redirect to the sign-in page', redirectedToLogin, 'unauthenticated', false],
    ['an HTML page instead of JSON', () => new Response('<!doctype html><title>Sign in</title>'), 'unauthenticated', false],
    ['a body that is not JSON', () => new Response('garbage'), 'unknown', false],
    ['429', status(429), 'rate-limited', true],
    ['503', status(503), 'network', true],
    ['404', status(404), 'unsupported', false],
  ] as const)('maps %s', async (_label, responder, code, retryable) => {
    const { fetch } = fakeFetch(responder);
    const err = await rejection(backend(fetch).listThreads({ q: 'in:inbox' }));
    expect(err.code).toBe(code);
    expect(err.retryable).toBe(retryable);
  });

  it('maps a dropped connection to a retryable network error', async () => {
    const err = await rejection(backend((async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch).getThread(TRIP));
    expect(err).toMatchObject({ code: 'network', retryable: true });
  });

  it('gives up on a request that never answers, so syncing does not stall for good', async () => {
    const hang = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    const err = await rejection(backend(hang, { requestTimeoutMs: 20 }).getThread(TRIP));
    expect(err).toMatchObject({ code: 'network', retryable: true });
  });

  it('retries once with Gmail\'s next token after an expired-token 403', async () => {
    const fresh = { ...SESSION, xsrf: 'AKxsrf-token-two:1760000001000', capturedAt: 2 };
    const { fetch, calls } = fakeFetch(status(403), json(fixture('fd-current.json')));
    const b = backend(fetch, { tokens: new FakeTokens(SESSION, fresh) });
    const thread = await b.getThread(TRIP);
    expect(thread.messages).toHaveLength(3);
    expect((calls[1]!.init.headers as Record<string, string>)['X-Framework-Xsrf-Token']).toBe(fresh.xsrf);
  });

  it('gives up with session-unavailable when no fresh token arrives after a 403', async () => {
    const { fetch, calls } = fakeFetch(status(403));
    const err = await rejection(backend(fetch).getThread(TRIP));
    expect(err).toMatchObject({ code: 'session-unavailable', retryable: true });
    expect(calls).toHaveLength(1);
  });

  it('reports session-unavailable before Gmail has made any sync call', async () => {
    const { fetch, calls } = fakeFetch();
    const err = await rejection(backend(fetch, { tokens: new FakeTokens(null) }).listLabels());
    expect(err.code).toBe('session-unavailable');
    expect(calls).toHaveLength(0);
  });
});

describe('getThread', () => {
  it('fetches one thread by sync id', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('fd-current.json')));
    const thread = await backend(fetch).getThread(`${TRIP}|msg-f:1846500000000000007`);
    expect(calls[0]!.body).toEqual([[[TRIP, 1]], 2]);
    expect(thread.id).toBe(TRIP);
  });

  it('is not-found when Gmail returns a different thread or none', async () => {
    const { fetch } = fakeFetch(json(fixture('fd-current.json')));
    expect((await rejection(backend(fetch).getThread('thread-f:999'))).code).toBe('not-found');
    expect((await rejection(backend(fakeFetch().fetch).getThread('160d7d788da7ba7a'))).code).toBe('not-found');
  });
});

describe('label changes', () => {
  it('archives with the cached message ids, then confirms by re-reading the thread', async () => {
    const { fetch, calls } = fakeFetch(
      json(fixture('bv-current.json')),
      json(fixture('s-ack-ok.json')),
      json(cafeAfter((labels) => labels.filter((l) => l !== '^i').concat('^a'))),
    );
    const b = backend(fetch);
    await b.listThreads({ q: 'in:inbox' });
    await b.modifyThreads([CAFE], { remove: ['INBOX'] });

    expect(calls.map((c) => c.endpoint)).toEqual(['bv', 's', 'fd']);
    const body = calls[1]!.body as Json;
    expect(body[1][0][0]).toEqual([
      1,
      [
        CAFE,
        [null, null, null, null, null, null, [['^a'], ['^i'], [
          'msg-f:1846473264892611537',
          'msg-a:r-6612904833172234991',
          'msg-f:1846473890114005529',
          'msg-a:r4417290118735561102',
        ]]],
      ],
    ]);
    expect(body[2]).toEqual([1, 4100321, null, null, [null, 0], null, 1]);
    expect(calls[2]!.body).toEqual([[[CAFE, 1]], 2]);
  });

  it('writes once more with what the re-read found, then fails loudly if the thread still stays unchanged', async () => {
    const stale = json(cafeAfter((l) => l));
    const ok = json(fixture('s-ack-ok.json'));
    const { fetch, calls } = fakeFetch(json(fixture('bv-current.json')), ok, stale, stale, stale, ok, stale, stale, stale);
    const b = backend(fetch);
    await b.listThreads({ q: 'in:inbox' });
    const err = await rejection(b.modifyThreads([CAFE], { add: ['STARRED'] }));
    expect(err.code).toBe('unsupported');
    expect(calls.map((c) => c.endpoint)).toEqual(['bv', 's', 'fd', 'fd', 'fd', 's', 'fd', 'fd', 'fd']);
  });

  it('confirms a trash once Gmail stops echoing the old labels, instead of undoing it on screen', async () => {
    const { fetch, calls } = fakeFetch(
      json(fixture('bv-current.json')),
      json(fixture('s-ack-ok.json')),
      json(cafeAfter((l) => l)),
      json(cafeAfter((l) => l.filter((x) => x !== '^i').concat('^k'))),
    );
    const b = backend(fetch);
    await b.listThreads({ q: 'in:inbox' });
    await b.trashThreads([CAFE]);
    expect(calls.map((c) => c.endpoint)).toEqual(['bv', 's', 'fd', 'fd']);
  });

  it('retries a refused change once with the threads read again, then surfaces it without verifying', async () => {
    const refused = json(fixture('s-ack-rejected.json'));
    const { fetch, calls } = fakeFetch(json(fixture('bv-current.json')), refused, json(cafeAfter((l) => l)), refused);
    const b = backend(fetch);
    await b.listThreads({ q: 'in:inbox' });
    const err = await rejection(b.trashThreads([CAFE]));
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/^Gmail turned down the change\. Reload Gmail and try again \(code \d+\)\.$/);
    expect(calls.map((c) => c.endpoint)).toEqual(['bv', 's', 'fd', 's']);
  });

  it('a change refused once goes through on the retry', async () => {
    const { fetch, calls } = fakeFetch(
      json(fixture('bv-current.json')),
      json(fixture('s-ack-rejected.json')),
      json(cafeAfter((l) => l)),
      json(fixture('s-ack-ok.json')),
      json(cafeAfter((l) => l.filter((x) => x !== '^i').concat('^k'))),
    );
    const b = backend(fetch);
    await b.listThreads({ q: 'in:inbox' });
    await b.trashThreads([CAFE]);
    expect(calls.map((c) => c.endpoint)).toEqual(['bv', 's', 'fd', 's', 'fd']);
  });

  it('looks up message ids for threads it has not seen', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('fd-current.json')), json(fixture('s-ack-ok.json')));
    await backend(fetch, { verifyWrites: false }).modifyThreads([TRIP], { remove: ['UNREAD'], add: ['^x_17'] });
    expect(calls.map((c) => c.endpoint)).toEqual(['fd', 's']);
    expect((calls[1]!.body as Json)[1][0][0][1][1][6]).toEqual([
      ['^x_17'],
      ['^u', '^us'],
      ['msg-f:1846500000000000007', 'msg-f:1846500000000099001', 'msg-a:r7712093846501823344'],
    ]);
  });

  it('refuses system labels Gmail manages itself, before any request', async () => {
    const { fetch, calls } = fakeFetch();
    const err = await rejection(backend(fetch).modifyThreads([CAFE], { add: ['SENT'] }));
    expect(err.code).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['deleteThreadsForever, for an account whose page is not this tab', (b: SessionBackend) => b.deleteThreadsForever([CAFE])],
    ['emptyFolder, for an account whose page is not this tab', (b: SessionBackend) => b.emptyFolder('trash')],
    ['snoozeThreads', (b: SessionBackend) => b.snoozeThreads()],
    ['createLabel', (b: SessionBackend) => b.createLabel()],
    ['deleteDraft, for an account whose page is not this tab', (b: SessionBackend) => b.deleteDraft(NEW_MESSAGE, NEW_THREAD)],
  ])('%s says it is unsupported instead of doing nothing', async (_name, run) => {
    const { fetch, calls } = fakeFetch();
    expect((await rejection(run(backend(fetch)))).code).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });
});

describe('delete forever through Gmail\'s own page', () => {
  const gone = () => [0, [], null, null, [4100999]];
  /** An /i/bv answer with no rows: the folder is empty. */
  const emptyList = () => [0, null, [], 0];
  function page(missing: string[] = []) {
    return { deleteForever: vi.fn(async () => missing), emptyFolder: vi.fn(async () => {}) } as unknown as GmailPage & {
      deleteForever: ReturnType<typeof vi.fn>;
      emptyFolder: ReturnType<typeof vi.fn>;
    };
  }

  it('only offers it where the page is this account\'s own', () => {
    const { fetch } = fakeFetch();
    expect(backend(fetch).capabilities.deleteForever).toBe(false);
    expect(backend(fetch, { page: page() }).capabilities.deleteForever).toBe(true);
  });

  it('presses Delete forever in Trash with what the sync API lists there, then re-reads to make sure the thread is gone', async () => {
    const p = page();
    const { fetch, calls } = fakeFetch(json(cafeAfter((l) => [...l, '^k'])), json(fixture('bv-current.json')), json(gone()));
    await backend(fetch, { page: p }).deleteThreadsForever([CAFE]);
    expect(calls.map((c) => c.endpoint)).toEqual(['fd', 'bv', 'fd']);
    expect((calls[1]!.body as Json)[0][3]).toBe('in:trash');
    const [ids, folder, view] = p.deleteForever.mock.calls[0]!;
    expect([ids, folder]).toEqual([[CAFE], 'trash']);
    // The page waits for these rows before trusting Gmail's list, and pages up to the total.
    expect(view.landmarks).toHaveLength(4);
    expect(view.total).toBe(412);
  });

  it('goes to Spam for spam, and says so when Gmail kept a thread', async () => {
    const p = page();
    const kept = json(cafeAfter((l) => [...l.filter((x) => x !== '^i'), '^s']));
    const { fetch } = fakeFetch(kept, json(fixture('bv-current.json')), ...Array.from({ length: 15 }, () => kept));
    const err = await rejection(backend(fetch, { page: p }).deleteThreadsForever([CAFE]));
    expect(p.deleteForever).toHaveBeenCalledWith([CAFE], 'spam', expect.anything());
    expect(err.message).toMatch(/didn't delete one conversation\. Open classic Gmail/);
  });

  it('waits for Gmail to forget a deleted thread instead of failing on the first re-read', async () => {
    const p = page();
    const trashed = json(cafeAfter((l) => [...l, '^k']));
    const { fetch, calls } = fakeFetch(trashed, json(fixture('bv-current.json')), trashed, json(gone()));
    await backend(fetch, { page: p }).deleteThreadsForever([CAFE]);
    expect(calls.map((c) => c.endpoint)).toEqual(['fd', 'bv', 'fd', 'fd']);
  });

  it('trusts the re-read over the page: a thread the page never found but Gmail no longer has is gone', async () => {
    const p = page([CAFE]);
    const { fetch } = fakeFetch(json(cafeAfter((l) => [...l, '^k'])), json(fixture('bv-current.json')), json(gone()));
    await expect(backend(fetch, { page: p }).deleteThreadsForever([CAFE])).resolves.toBeUndefined();
  });

  it('empties Trash, then re-reads it through the sync API until it lists nothing, and reports the count', async () => {
    const p = page();
    const { fetch, calls } = fakeFetch(json(fixture('bv-current.json')), json(fixture('bv-current.json')), json(emptyList()));
    const n = await backend(fetch, { page: p }).emptyFolder('trash');
    expect(n).toBe(412);
    expect(p.emptyFolder).toHaveBeenCalledTimes(1);
    expect(p.emptyFolder.mock.calls[0]![0]).toBe('trash');
    expect(calls.every((c) => (c.body as Json)[0][3] === 'in:trash')).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it('presses nothing when Trash is already empty', async () => {
    const p = page();
    const { fetch } = fakeFetch(json(emptyList()));
    expect(await backend(fetch, { page: p }).emptyFolder('spam')).toBe(0);
    expect(p.emptyFolder).not.toHaveBeenCalled();
  });

  it('never claims Trash is empty while Gmail still lists conversations there', async () => {
    const p = page();
    const full = json(fixture('bv-current.json'));
    const { fetch } = fakeFetch(...Array.from({ length: 1 + 3 * 15 }, () => full));
    const err = await rejection(backend(fetch, { page: p }).emptyFolder('trash'));
    expect(p.emptyFolder).toHaveBeenCalledTimes(3);
    expect(err.message).toBe("Couldn't empty Trash: Gmail still lists 412 conversations there. Open classic Gmail to finish.");
  });

  it('turns a page that stops responding into advice, not a stack trace', async () => {
    const p = page();
    p.emptyFolder.mockRejectedValueOnce(new GmailPageError("Gmail's page didn't respond in time (couldn't find Empty Trash now)."));
    const { fetch } = fakeFetch(json(fixture('bv-current.json')));
    const err = await rejection(backend(fetch, { page: p }).emptyFolder('trash'));
    expect(err.message).toMatch(/didn't respond in time.*Open classic Gmail to finish there\./);
  });
});

describe('send', () => {
  const outgoing = {
    to: [{ email: 'grace@example.org', name: 'Grace Hopper' }],
    cc: [],
    bcc: [{ email: 'linus@example.net' }],
    subject: 'Ünïcödé subject 🎉',
    html: '<div dir="ltr">Hello</div>',
    attachments: [],
  };

  it('saves a new message as a draft, then sends it, like Gmail\'s client', async () => {
    const { fetch, calls } = fakeFetch(
      json(fixture('bv-current.json')),
      json(fixture('s-ack-ok.json')),
      json(echo(NEW_THREAD, NEW_MESSAGE, ['^all', '^f', '^pfg', '^f_bt'])),
    );
    const result = await backend(fetch).send(outgoing);
    expect(result).toEqual({ id: NEW_MESSAGE, threadId: NEW_THREAD });
    expect(calls.map((c) => c.endpoint)).toEqual(['bv', 's', 's']);

    const save = calls[1]!.body as Json;
    expect(save[0]).toBeNull();
    expect(save[2][1]).toBe(4100321);
    const [, [threadId, slots]] = save[1][0][0];
    expect(threadId).toBe(NEW_THREAD);
    const draft = slots[2][0][4][0];
    expect(draft[0]).toBe(NEW_MESSAGE);
    expect(draft[10]).toEqual(DRAFT_LABELS);
    expect(draft[4]).toEqual([[1, 'linus@example.net']]);

    const send = calls[2]!.body as Json;
    expect(send[0]).toEqual([null, null, 2]);
    const sent = send[1][0][0][1][1][13];
    expect(sent[1]).toBeNull();
    expect(sent[0][7]).toBe('Ünïcödé subject 🎉');
    expect(sent[0][10]).toEqual(SEND_LABELS);
    expect(sent[0][1]).toEqual([1, 'ada@example.com', null, null, null, null, null, null, null, 'ada@example.com']);
  });

  it('answers the message named by In-Reply-To, in place, without a draft step', async () => {
    const { fetch, calls } = fakeFetch(
      json(fixture('fd-current.json')),
      json(echo(TRIP, NEW_MESSAGE, ['^all', '^f', '^pfg'])),
    );
    await backend(fetch).send({ ...outgoing, threadId: TRIP, inReplyTo: '<CAF1=trip@mail.gmail.com>' });
    const slot = (calls[1]!.body as Json)[1][0][0][1][1][1];
    expect(slot[1]).toBe('msg-f:1846500000000000007');
    expect(slot[0][15]).toBe('<CAF1=trip@mail.gmail.com>');
  });

  it('answers the newest non-draft message when no In-Reply-To is given', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('fd-current.json')), json(echo(TRIP, NEW_MESSAGE, ['^f'])));
    await backend(fetch).send({ ...outgoing, threadId: TRIP });
    const slot = (calls[1]!.body as Json)[1][0][0][1][1][1];
    expect(slot[1]).toBe('msg-f:1846500000000099001');
    expect(slot[0][15]).toBe('<CAA2=reply@mail.gmail.com>');
  });

  it('sends a saved draft by rewriting it in place', async () => {
    const { fetch, calls } = fakeFetch(
      json(fixture('bv-current.json')),
      json(fixture('s-ack-ok.json')),
      json(echo(NEW_THREAD, NEW_MESSAGE, ['^f', '^pfg'])),
    );
    const b = backend(fetch);
    const draft = await b.saveDraft(outgoing);
    expect(draft.id).toBe(NEW_MESSAGE);
    expect(draft.message).toMatchObject({ threadId: NEW_THREAD, isDraft: true, labelIds: ['DRAFT'], subject: outgoing.subject });

    await b.send({ ...outgoing, draftId: draft.id, threadId: draft.message.threadId });
    const send = calls[2]!.body as Json;
    expect(send[1][0][0][1][0]).toBe(NEW_THREAD);
    expect(send[1][0][0][1][1][13][0][0]).toBe(NEW_MESSAGE);
    expect(calls).toHaveLength(3);
  });

  it('does not claim success when Gmail does not echo the sent message', async () => {
    const { fetch } = fakeFetch(json(fixture('fd-current.json')), json(fixture('s-ack-ok.json')));
    const err = await rejection(backend(fetch).send({ ...outgoing, threadId: TRIP }));
    expect(err.code).toBe('unknown');
    expect(err.message).toMatch(/Check Sent/);
  });

  it('uploads attachments, then references the returned blob in the message', async () => {
    const uploadUrl = 'https://mail.google.com/_/upload?upload_id=XYZ&upload_protocol=resumable';
    const { fetch, calls } = fakeFetch(
      json(fixture('fd-current.json')),
      () => new Response('', { headers: { 'x-goog-upload-url': uploadUrl } }),
      () => new Response('BLOBREF123\n'),
      json(echo(TRIP, NEW_MESSAGE, ['^f'])),
    );
    const file = { id: 'local-1', filename: 'Grüße.pdf', mimeType: 'application/pdf', size: 3, data: btoa('PDF') };
    await backend(fetch).send({ ...outgoing, threadId: TRIP, attachments: [file] });

    const [, start, upload, send] = calls as [Call, Call, Call, Call];
    expect(start.url).toBe('https://mail.google.com/_/upload?authuser=1&dcp=asu-n');
    expect(start.body).toEqual([NEW_MESSAGE]);
    expect(start.init.headers).toMatchObject({ 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-File-Name': 'Gr%C3%BC%C3%9Fe.pdf' });
    expect(upload.url).toBe(uploadUrl);
    expect(Array.from(upload.init.body as Uint8Array)).toEqual([80, 68, 70]);
    const message = (send.body as Json)[1][0][0][1][1][1][0];
    expect(message[11]).toEqual([['application/pdf', 'Grüße.pdf', 3, null, 'f_111111111', null, 0, [], null, 'BLOBREF123']]);
  });

  it('stops before sending when the upload is refused', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('fd-current.json')), status(413));
    const file = { id: 'x', filename: 'big.bin', mimeType: 'application/octet-stream', size: 1, data: btoa('x') };
    const err = await rejection(backend(fetch).send({ ...outgoing, threadId: TRIP, attachments: [file] }));
    expect(err.code).toBe('unknown');
    expect(calls.map((c) => c.endpoint ?? 'upload')).toEqual(['fd', 'upload']);
  });
});

describe('schedule send through Gmail\'s own page', () => {
  const outgoing = { to: [{ email: 'grace@example.org' }], cc: [], bcc: [], subject: 'Monday', html: '<div>Hi</div>', attachments: [] };
  const SEND_AT = NOW + 86_400_000;
  /** An /i/fd answer: one thread holding one message with these labels and date. */
  function fd(threadId: string, messageId: string, labels: string[], date = NOW) {
    const message: Json[] = new Array(56).fill(null);
    Object.assign(message, { 0: messageId, 1: [1, 'ada@example.com', 'Ada'], 6: date, 9: 'Hi', 10: labels, 17: date });
    return json([0, [['Monday', 'Hi', date, threadId, [message]]], null, null, [4100999]]);
  }
  const asDraft = () => fd(NEW_THREAD, NEW_MESSAGE, ['^all', '^r']);
  const asScheduled = (date = SEND_AT) => fd(NEW_THREAD, NEW_MESSAGE, ['^all', '^scheduled'], date);
  /** The answers to saving the app's draft again just before scheduling: its conversation, then the save. */
  const saved = () => [asDraft(), json(fixture('s-ack-ok.json'))];
  function page() {
    return { scheduleDraft: vi.fn(async () => {}), cancelSend: vi.fn(async () => {}) } as unknown as GmailPage & {
      scheduleDraft: ReturnType<typeof vi.fn>;
      cancelSend: ReturnType<typeof vi.fn>;
    };
  }
  const draft = { ...outgoing, draftId: NEW_MESSAGE, threadId: NEW_THREAD, sendAt: SEND_AT };

  it('discards a draft with Gmail\'s own Discard draft, and checks it went', async () => {
    const discarding = { discardDraft: vi.fn(async () => {}) } as unknown as GmailPage & { discardDraft: ReturnType<typeof vi.fn> };
    const { fetch } = fakeFetch(json([0, [], null, null, [4100999]]));
    await backend(fetch, { page: discarding }).deleteDraft(NEW_MESSAGE, NEW_THREAD);
    expect(discarding.discardDraft).toHaveBeenCalledWith({ threadId: NEW_THREAD, messageId: NEW_MESSAGE });

    const ignored = { discardDraft: vi.fn(async () => {}) } as unknown as GmailPage;
    const stays = fakeFetch(...Array.from({ length: 20 }, asDraft));
    expect((await rejection(backend(stays.fetch, { page: ignored }).deleteDraft(NEW_MESSAGE, NEW_THREAD))).message).toMatch(/didn't discard/);
  });

  it('is offered only where Gmail\'s page is this account\'s own', async () => {
    const { fetch, calls } = fakeFetch();
    expect(backend(fetch).capabilities.scheduleSend).toBe(false);
    expect(backend(fetch, { page: page() }).capabilities.scheduleSend).toBe(true);
    expect((await rejection(backend(fetch).send(draft))).code).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });

  it('saves the draft as it is now, has Gmail schedule it, then trusts the re-read that shows it under ^scheduled', async () => {
    const p = page();
    const { fetch, calls } = fakeFetch(...saved(), asScheduled());
    expect(await backend(fetch, { page: p }).send(draft)).toEqual({ id: NEW_MESSAGE, threadId: NEW_THREAD });
    expect(p.scheduleDraft).toHaveBeenCalledWith({ threadId: NEW_THREAD, messageId: NEW_MESSAGE, sendAt: SEND_AT, recipients: ['grace@example.org'] });
    // The latest edits (here, the recipient) reached Gmail before it was asked to schedule; nothing went through the sync API's send.
    expect(calls.map((c) => c.endpoint)).toEqual(['fd', 's', 'fd']);
    expect(JSON.stringify(calls[1]!.body)).toContain('grace@example.org');
  });

  it('saves the draft first when it hasn\'t been', async () => {
    const p = page();
    const { fetch, calls } = fakeFetch(json(fixture('bv-current.json')), json(fixture('s-ack-ok.json')), asScheduled());
    await backend(fetch, { page: p }).send({ ...outgoing, sendAt: SEND_AT });
    expect(calls.map((c) => c.endpoint)).toEqual(['bv', 's', 'fd']);
    expect(((calls[1]!.body as Json)[1][0][0][1][1][2][0][4][0] as Json)[10]).toEqual(DRAFT_LABELS);
    expect(p.scheduleDraft).toHaveBeenCalledWith({ threadId: NEW_THREAD, messageId: NEW_MESSAGE, sendAt: SEND_AT, recipients: ['grace@example.org'] });
  });

  it('waits for Gmail to list it as scheduled, and fails plainly when it never does', async () => {
    const p = page();
    const ok = fakeFetch(...saved(), asDraft(), asDraft(), asScheduled());
    await backend(ok.fetch, { page: p }).send(draft);
    expect(ok.calls).toHaveLength(5);

    const never = fakeFetch(...saved(), ...Array.from({ length: 15 }, asDraft));
    const err = await rejection(backend(never.fetch, { page: page() }).send(draft));
    expect(err.message).toBe("Couldn't schedule in Gmail. Your message is saved in Drafts.");
    expect(err.code).toBe('unknown');
    expect(never.calls.slice(2).every((c) => c.endpoint === 'fd')).toBe(true);
  });

  it('reads once after the page gives up, so a send Gmail did take still counts', async () => {
    const stalled = page();
    stalled.scheduleDraft.mockRejectedValue(new GmailPageError("Gmail's page didn't respond in time (couldn't open Schedule send)."));
    const taken = fakeFetch(...saved(), asScheduled());
    await expect(backend(taken.fetch, { page: stalled }).send(draft)).resolves.toMatchObject({ threadId: NEW_THREAD });

    const lines: string[] = [];
    const notTaken = fakeFetch(...saved(), asDraft());
    const err = await rejection(backend(notTaken.fetch, { page: stalled, diagnostic: (l) => lines.push(l) }).send(draft));
    expect(err.message).toBe("Couldn't schedule in Gmail. Your message is saved in Drafts.");
    expect(notTaken.calls).toHaveLength(3);
    expect(lines.join()).toMatch(/couldn't open Schedule send/);
  });

  it('names the step Gmail\'s page stopped at, and says nothing was sent', async () => {
    const stalled = page();
    stalled.scheduleDraft.mockRejectedValue(new GmailPageError("Gmail's page didn't respond in time (couldn't open Schedule send).", 'open Schedule send'));
    const err = await rejection(backend(fakeFetch(...saved(), asDraft()).fetch, { page: stalled }).send(draft));
    expect(err.message).toBe('Gmail stopped responding before it could open Schedule send, so nothing was sent. Your message is saved in Drafts.');
  });

  it('passes on what Gmail said when it refused', async () => {
    const refused = page();
    refused.scheduleDraft.mockRejectedValue(new GmailPageError('Gmail said: Please specify at least one recipient.', undefined, 'Please specify at least one recipient.'));
    const err = await rejection(backend(fakeFetch(...saved(), asDraft()).fetch, { page: refused }).send(draft));
    expect(err.message).toBe("Gmail didn't schedule it: Please specify at least one recipient. Your message is saved in Drafts.");
  });

  it('runs one schedule for a draft asked twice while the first is still going', async () => {
    const p = page();
    let release!: () => void;
    p.scheduleDraft.mockImplementation(() => new Promise<void>((r) => (release = r)));
    const { fetch, calls } = fakeFetch(...saved(), asScheduled());
    const b = backend(fetch, { page: p });
    const first = b.send(draft);
    const again = b.send(draft);
    await vi.waitFor(() => expect(p.scheduleDraft).toHaveBeenCalled());
    release();
    expect(await again).toEqual(await first);
    expect(p.scheduleDraft).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(3);
  });

  it('cancels in Gmail when Gmail scheduled a different time than the one picked', async () => {
    const p = page();
    const wrong = SEND_AT + 3_600_000;
    const { fetch } = fakeFetch(...saved(), asScheduled(wrong), asScheduled(wrong), json(fixture('bv-current.json')), asDraft());
    const err = await rejection(backend(fetch, { page: p }).send(draft));
    expect(p.cancelSend).toHaveBeenCalledWith(NEW_THREAD, expect.anything());
    expect(err.message).toMatch(/instead, so it was cancelled\. Your message is saved in Drafts\./);
  });

  it('cancels a send with Gmail\'s own Cancel send, done once the re-read shows a draft again', async () => {
    const p = page();
    const { fetch, calls } = fakeFetch(asScheduled(), json(fixture('bv-current.json')), asScheduled(), asDraft());
    await backend(fetch, { page: p }).cancelScheduled(NEW_THREAD);
    expect(calls.map((c) => c.endpoint)).toEqual(['fd', 'bv', 'fd', 'fd']);
    expect((calls[1]!.body as Json)[0][3]).toBe('in:scheduled');
    expect(p.cancelSend).toHaveBeenCalledWith(NEW_THREAD, expect.objectContaining({ landmarks: expect.any(Array) }));
  });

  it('says so, with classic Gmail as the way out, when the send stays scheduled', async () => {
    const p = page();
    p.cancelSend.mockRejectedValue(new GmailPageError("Gmail's page didn't respond in time (couldn't find Cancel send)."));
    const { fetch } = fakeFetch(asScheduled(), json(fixture('bv-current.json')), asScheduled());
    const err = await rejection(backend(fetch, { page: p }).cancelScheduled(NEW_THREAD));
    expect(err.message).toMatch(/couldn't find Cancel send\)\. Gmail didn't cancel the send\. Open classic Gmail/);

    const nothing = fakeFetch(asDraft());
    expect((await rejection(backend(nothing.fetch, { page: page() }).cancelScheduled(NEW_THREAD))).code).toBe('not-found');
  });
});

describe('getAttachment', () => {
  const pdf = new Uint8Array([37, 80, 68, 70, 0, 255]);

  it('downloads from the URL Gmail gave, scoped to the account and forced to disp=safe', async () => {
    const { fetch, calls } = fakeFetch(
      json(fixture('fd-current.json')),
      () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } }),
    );
    const b = backend(fetch);
    await b.getThread(TRIP);
    const file = await b.getAttachment('msg-f:1846500000000000007', '0.2');
    expect(calls[1]!.url).toBe(
      'https://mail.google.com/mail/u/1/?ui=2&ik=abc123&attid=0.2&permmsgid=msg-f:1846500000000000007&th=199f1c0e9b6f0007&view=att&zw&disp=safe',
    );
    expect(calls[1]!.init.credentials).toBe('include');
    expect(file).toEqual({ data: btoa(String.fromCharCode(...pdf)), mimeType: 'application/pdf' });
  });

  it('builds the documented URL from ik when the thread was never opened', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(pdf, { headers: { 'content-type': 'image/png' } }));
    const file = await backend(fetch).getAttachment('msg-f:42', '0.1');
    expect(calls[0]!.url).toBe('https://mail.google.com/mail/u/1/?ui=2&ik=abc123&attid=0.1&permmsgid=msg-f%3A42&view=att&disp=safe');
    expect(file.mimeType).toBe('image/png');
  });

  it('treats an HTML page in place of a binary as a missing attachment', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>error</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect((await rejection(backend(fetch).getAttachment('msg-f:42', '0.9'))).code).toBe('not-found');
  });

  it('cannot build a URL before Gmail exposes ik', async () => {
    const { fetch, calls } = fakeFetch();
    const tokens = new FakeTokens({ ...SESSION, ik: undefined });
    expect((await rejection(backend(fetch, { tokens }).getAttachment('msg-f:42', '0.1'))).code).toBe('session-unavailable');
    expect(calls).toHaveLength(0);
  });
});

/** lookupPhotos' answer without the note on how it got there. */
function photosOnly(found: Record<string, string>) {
  const { '#how': _how, ...photos } = found;
  return photos;
}

describe('searchContacts', () => {
  const doc = (cookie: string) => ({ cookie, location: { pathname: '/mail/u/1/' } }) as unknown as Document;

  it('signs the People Stack request with SAPISIDHASH and parses suggestions', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('autocomplete.json')));
    const contacts = await backend(fetch, { document: doc('NID=1; SAPISID=sap/123; __Secure-3PAPISID=three') }).searchContacts('  gra ');
    const ts = Math.floor(NOW / 1000);
    const sha = (v: string) => createHash('sha1').update(`${ts} ${v} https://mail.google.com`).digest('hex');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`SAPISIDHASH ${ts}_${sha('sap/123')} SAPISID3PHASH ${ts}_${sha('three')}`);
    expect(headers['X-Goog-AuthUser']).toBe('1');
    expect(calls[0]!.url).toMatch(/PeopleStackAutocompleteService\/Autocomplete$/);
    expect(calls[0]!.body).toEqual([134, 'gra', [1, 2], 15]);
    expect(contacts).toEqual([
      { email: 'grace@example.org', name: 'Grace Hopper', photoUrl: 'https://lh3.googleusercontent.com/a/photo1' },
      { email: 'linus@example.net', name: 'Linus' },
      { email: 'evil@example.com', name: 'Evil' },
    ]);
  });

  const COOKIES = 'SAPISID=sap/123';
  const keyOf = (call: Call) => (call.init.headers as Record<string, string>)['X-Goog-Api-Key'];

  it("tries the next API key when Google refuses one, and starts with the one that worked next time", async () => {
    const tokens = new FakeTokens({ ...SESSION, peopleApiKey: 'AIzaPeople', apiKey: 'AIzaOther' });
    const { fetch, calls } = fakeFetch(status(403), json(fixture('autocomplete.json')), json(fixture('autocomplete.json')));
    const diagnostics: string[] = [];
    const b = backend(fetch, { tokens, document: doc(COOKIES), diagnostic: (line) => diagnostics.push(line) });
    expect((await b.searchContacts('gra')).map((c) => c.email)).toContain('grace@example.org');
    await b.searchContacts('lin');
    expect(calls.map(keyOf)).toEqual(['AIzaPeople', FALLBACK_API_KEY, FALLBACK_API_KEY]);
    expect(diagnostics).toEqual(["contacts: autocomplete answered HTTP 403 with Gmail's People Stack key"]);
  });

  it('after every key is refused, rests for ten minutes instead of asking on each keystroke', async () => {
    let now = NOW;
    const tokens = new FakeTokens({ ...SESSION, peopleApiKey: 'AIzaPeople' });
    const { fetch, calls } = fakeFetch(status(403), status(400), json(fixture('autocomplete.json')));
    const b = backend(fetch, { tokens, document: doc(COOKIES), now: () => now });
    expect((await rejection(b.searchContacts('gra'))).code).toBe('unsupported');
    expect((await rejection(b.searchContacts('grac'))).code).toBe('unsupported');
    expect(calls).toHaveLength(2);
    now += 10 * 60_000;
    expect(await b.searchContacts('grace')).toHaveLength(3);
  });

  it('a server error is retryable and does not stop suggestions', async () => {
    const { fetch, calls } = fakeFetch(status(503), json(fixture('autocomplete.json')));
    const b = backend(fetch, { document: doc(COOKIES) });
    expect(await rejection(b.searchContacts('gra'))).toMatchObject({ code: 'network', retryable: true });
    expect(await b.searchContacts('gra')).toHaveLength(3);
    expect(calls).toHaveLength(2);
  });

  it('looks photos up with one Lookup per batch and remembers who has none', async () => {
    const match = (email: string, photo: string | null) => [[email], [[[[[[photo, 3], ['Name']], [email]]]]]];
    const { fetch, calls } = fakeFetch(
      json([[match('grace@example.org', 'https://lh3.googleusercontent.com/a/photo1'), match('linus@example.net', null)]]),
    );
    const b = backend(fetch, { document: doc(COOKIES) });
    expect(photosOnly(await b.lookupPhotos(['Grace@example.org', 'linus@example.net', 'grace@example.org']))).toEqual({
      'grace@example.org': 'https://lh3.googleusercontent.com/a/photo1',
    });
    expect(calls[0]!.url).toMatch(/PeopleStackAutocompleteService\/Lookup$/);
    expect(calls[0]!.body).toEqual([134, [1, 2], [['grace@example.org'], ['linus@example.net']]]);
    // Both answers are remembered, the "no photo" one too.
    expect(photosOnly(await b.lookupPhotos(['linus@example.net', 'grace@example.org']))).toEqual({ 'grace@example.org': 'https://lh3.googleusercontent.com/a/photo1' });
    expect(calls).toHaveLength(1);
  });

  it("says how each address was answered, and copies the shape of Gmail's own Lookup once the page has sent one", async () => {
    const match = (email: string, photo: string | null) => [[email], [[[[[[photo, 3], ['Name']], [email]]]]]];
    const tokens = new FakeTokens({ ...SESSION, peopleStack: JSON.stringify({ Lookup: { client: 140, flags: [1, 2, 3] } }) });
    const { fetch, calls } = fakeFetch(json([[match('grace@example.org', 'https://lh3.googleusercontent.com/a/photo1')]]));
    const found = await backend(fetch, { tokens, document: doc(COOKIES) }).lookupPhotos(['grace@example.org', 'zed@example.net']);
    expect(calls[0]!.body).toEqual([140, [1, 2, 3], [['grace@example.org'], ['zed@example.net']]]);
    const how = JSON.parse(found['#how']!);
    expect(how).toMatchObject({
      steps: { 'grace@example.org': ['Lookup HTTP 200: photo <url:lh3.googleusercontent.com/a>'], 'zed@example.net': ['Lookup HTTP 200: not in the answer'] },
      template: "Lookup [140, [1,2,3]] seen in Gmail's own requests",
    });
    // Someone came back without a photo, so the answer's redacted shape comes along.
    expect(how.dumps).toEqual([
      { source: 'Lookup answer with someone left without a photo', shape: '[[[["<email:example.org>"],[[[[[["<url:lh3.googleusercontent.com/a>",3],["<str:4>"]],["<email:example.org>"]]]]]]]]' },
    ]);
  });

  it("uses the picture Gmail sends beside a sender in its own mail data, without asking anyone", async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const page = fixture<Json>('bv-current.json');
    // Put an inline logo beside the first sender entry ([1, address, name]) in the list.
    let sender: string | undefined;
    const walk = (node: Json): void => {
      if (sender || !Array.isArray(node)) return;
      if (node[0] === 1 && typeof node[1] === 'string' && node[1].includes('@') && node.length <= 10) {
        sender = node[1].toLowerCase();
        node.push(png);
        return;
      }
      node.forEach(walk);
    };
    walk(page);
    const { fetch, calls } = fakeFetch(json(page));
    const b = backend(fetch, { document: doc(COOKIES) });
    await b.listThreads({ q: 'in:inbox' });
    const found = await b.lookupPhotos([sender!]);
    expect(found[sender!]).toBe(png);
    expect(JSON.parse(found['#how']!).steps[sender!]).toEqual(["Gmail's message data: inline image"]);
    expect(calls).toHaveLength(1);
  });

  it('when Lookup is refused, asks autocomplete per address, three at a time, and keeps suggestions working', async () => {
    const answer = (email: string): unknown => {
      if (email === 'grace@example.org') return fixture('autocomplete.json');
      if (email === 'linus@example.net') return [[[[[[null], ['Linus']], ['linus@example.net']]]]];
      // A prefix match on someone else is not this person's photo.
      return [[[[[['https://lh3.googleusercontent.com/a/other'], ['Other']], [`${email.split('@')[0]}.other@example.com`]]]]];
    };
    let active = 0;
    let peak = 0;
    const queries: string[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      if (url.endsWith('/Lookup')) return new Response('', { status: 400 });
      const [, query] = JSON.parse(init.body as string) as [number, string];
      queries.push(query);
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return new Response(JSON.stringify(answer(query)));
    }) as unknown as typeof fetch;
    const b = backend(impl, { document: doc(COOKIES) });
    const emails = ['Grace@example.org', 'linus@example.net', 'a@example.com', 'b@example.com', 'c@example.com', 'grace@example.org'];
    expect(photosOnly(await b.lookupPhotos(emails))).toEqual({ 'grace@example.org': 'https://lh3.googleusercontent.com/a/photo1' });
    expect(queries.sort()).toEqual(['a@example.com', 'b@example.com', 'c@example.com', 'grace@example.org', 'linus@example.net']);
    expect(peak).toBe(3);
    expect(photosOnly(await b.lookupPhotos(['linus@example.net', 'grace@example.org']))).toEqual({ 'grace@example.org': 'https://lh3.googleusercontent.com/a/photo1' });
    expect(queries).toHaveLength(5);
    // A refused Lookup doesn't rest autocomplete.
    expect((await b.searchContacts('grace@example.org')).map((c) => c.email)).toContain('grace@example.org');
  });

  it('stops looking photos up at the first rate limit and rests a minute before asking again', async () => {
    let now = NOW;
    const asked: string[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      asked.push(url.endsWith('/Lookup') ? 'Lookup' : (JSON.parse(init.body as string) as [number, string])[1]);
      if (url.endsWith('/Lookup')) return new Response('', { status: 400 });
      return new Response('', { status: 429 });
    }) as unknown as typeof fetch;
    const b = backend(impl, { document: doc(COOKIES), now: () => now });
    const emails = Array.from({ length: 20 }, (_, i) => `p${i}@example.com`);
    expect(photosOnly(await b.lookupPhotos(emails))).toEqual({});
    // Lookup, then the three addresses already on their way when Google said slow down.
    expect(asked).toHaveLength(4);
    expect((await rejection(b.searchContacts('gra'))).code).toBe('rate-limited');
    expect(asked).toHaveLength(4);
    now += 60_000;
    await rejection(b.searchContacts('gra'));
    expect(asked).toHaveLength(5);
  });

  it('skips the request for an empty prefix and reports signed-out without cookies', async () => {
    const { fetch, calls } = fakeFetch();
    expect(await backend(fetch, { document: doc('') }).searchContacts('   ')).toEqual([]);
    expect((await rejection(backend(fetch, { document: doc('NID=1') }).searchContacts('a'))).code).toBe('unauthenticated');
    expect(calls).toHaveLength(0);
  });
});

describe('pollChanges', () => {
  it('sets a baseline, then reports thread and label changes from Gmail\'s poll', async () => {
    const sleeps: number[] = [];
    let now = NOW;
    const { fetch, calls } = fakeFetch(
      json(fixture('bv-current.json')),
      json(fixture('s-poll-changed.json')),
      json(fixture('s-poll-advanced.json')),
      json(fixture('s-poll-quiet.json')),
    );
    const b = backend(fetch, {
      now: () => now,
      pollIntervalMs: 10_000,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
    });

    expect(await b.pollChanges()).toEqual([]);
    expect(await b.pollChanges()).toEqual([
      { type: 'threads', threadIds: ['thread-f:1846473264892611537', 'thread-f:1846500000000000007'] },
    ]);
    expect((calls[1]!.body as Json)[2][1]).toBe(4100321);
    expect(await b.pollChanges()).toEqual([{ type: 'labels' }]);
    expect((calls[2]!.body as Json)[2][1]).toBe(4100600);
    expect(await b.pollChanges()).toEqual([]);
    expect(sleeps).toEqual([10_000, 10_000, 10_000]);
  });

  it("reports this tab's own writes on the next poll, though the write already moved Gmail's history id past them", async () => {
    const { fetch } = fakeFetch(
      json(fixture('bv-current.json')),
      json(fixture('s-ack-ok.json')),
      json(cafeAfter((l) => l.filter((x) => x !== '^i').concat('^k'))),
      json(fixture('s-poll-quiet.json')),
      json(fixture('s-poll-quiet.json')),
    );
    const b = backend(fetch);
    await b.listThreads({ q: 'in:inbox' });
    await b.trashThreads([CAFE]);
    expect(await b.pollChanges()).toEqual([{ type: 'threads', threadIds: [CAFE] }]);
    expect(await b.pollChanges()).toEqual([]);
  });

  it('reports a bare history bump as "all"', async () => {
    const { fetch } = fakeFetch(json(fixture('bv-current.json')), json(fixture('s-poll-advanced.json')));
    const b = backend(fetch);
    await b.pollChanges();
    expect(await b.pollChanges()).toEqual([{ type: 'all' }]);
  });

  it('falls back to interval refreshes when Gmail stops understanding the poll', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('bv-current.json')), () => new Response('not json'));
    const b = backend(fetch);
    await b.pollChanges();
    expect(await b.pollChanges()).toEqual([{ type: 'all' }]);
    expect(await b.pollChanges()).toEqual([{ type: 'all' }]);
    expect(calls).toHaveLength(2);
  });

  it('still surfaces sign-out instead of hiding it behind the fallback', async () => {
    const { fetch } = fakeFetch(json(fixture('bv-current.json')), status(401));
    const b = backend(fetch);
    await b.pollChanges();
    expect((await rejection(b.pollChanges())).code).toBe('unauthenticated');
  });
});

describe('account and labels', () => {
  it('reads the signed-in account from GLOBALS and Gmail\'s account button', async () => {
    const doc = document.implementation.createHTMLDocument('Gmail');
    const link = doc.createElement('a');
    link.setAttribute('href', 'https://accounts.google.com/SignOutOptions?hl=en&continue=https://mail.google.com/mail&service=mail');
    link.setAttribute('aria-label', 'Google Account: Ada Lovelace  \n(ada@example.com)');
    const img = doc.createElement('img');
    img.setAttribute('src', 'https://lh3.googleusercontent.com/a/ada=s64');
    link.append(img);
    doc.body.append(link);
    const account = await backend(fakeFetch().fetch, { document: doc }).getAccount();
    // Gmail's header asks for a 32-64px photo; the app asks Google for a sharper one.
    expect(account).toEqual({ email: 'ada@example.com', name: 'Ada Lovelace', index: 1, photoUrl: 'https://lh3.googleusercontent.com/a/ada=s128' });
  });

  it('tells the UI to read the account again once Gmail draws the photo it lacked', async () => {
    const doc = document.implementation.createHTMLDocument('Gmail');
    const b = backend(fakeFetch().fetch, { document: doc });
    const events: unknown[] = [];
    b.subscribe((e) => events.push(e));
    expect((await b.getAccount()).photoUrl).toBeUndefined();

    const link = doc.createElement('a');
    link.setAttribute('href', 'https://accounts.google.com/SignOutOptions?hl=en');
    link.setAttribute('aria-label', 'Google Account: Ada Lovelace (ada@example.com)');
    doc.body.append(link);
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([]);
    const img = doc.createElement('img');
    img.setAttribute('src', 'https://lh3.googleusercontent.com/a/ada=s32-c');
    link.append(img);
    await vi.waitFor(() => expect(events).toEqual([{ type: 'account' }]));
    expect((await b.getAccount()).photoUrl).toBe('https://lh3.googleusercontent.com/a/ada=s128-c');
  });

  it('finds the photo when Google moves it out of the account button or paints a placeholder first', async () => {
    const doc = document.implementation.createHTMLDocument('Gmail');
    const link = doc.createElement('a');
    link.setAttribute('href', 'https://accounts.google.com/SignOutOptions?hl=en');
    link.setAttribute('aria-label', 'Google Account: Ada Lovelace (ada@example.com)');
    const img = doc.createElement('img');
    img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    img.setAttribute('srcset', 'https://lh3.googleusercontent.com/a/ada=s32-c 1x, https://lh3.googleusercontent.com/a/ada=s64-c 2x');
    link.append(img);
    doc.body.append(link);
    expect((await backend(fakeFetch().fetch, { document: doc }).getAccount()).photoUrl).toBe('https://lh3.googleusercontent.com/a/ada=s128-c');

    const moved = document.implementation.createHTMLDocument('Gmail');
    const button = moved.createElement('div');
    button.setAttribute('aria-label', 'Account settings for ada@example.com');
    button.setAttribute('style', 'background-image: url("https://lh3.googleusercontent.com/a/ada=s40")');
    moved.body.append(button);
    expect((await backend(fakeFetch().fetch, { document: moved }).getAccount()).photoUrl).toBe('https://lh3.googleusercontent.com/a/ada=s128');

    // Protocol-relative addresses, and avatars drawn as an SVG <image>.
    const relative = document.implementation.createHTMLDocument('Gmail');
    const button2 = relative.createElement('a');
    button2.setAttribute('href', 'https://accounts.google.com/SignOutOptions?hl=en');
    button2.setAttribute('aria-label', 'Google Account: Ada Lovelace (ada@example.com)');
    button2.innerHTML = '<img src="//lh3.googleusercontent.com/ogw/ada=s32-c-mo">';
    relative.body.append(button2);
    expect((await backend(fakeFetch().fetch, { document: relative }).getAccount()).photoUrl).toBe('https://lh3.googleusercontent.com/ogw/ada=s128-c-mo');
    button2.innerHTML = '<svg><image href="https://lh3.googleusercontent.com/a/ada-svg=s40"></image></svg>';
    expect((await backend(fakeFetch().fetch, { document: relative }).getAccount()).photoUrl).toBe('https://lh3.googleusercontent.com/a/ada-svg=s128');
  });

  it("hands the app a signed-in-only account photo as the image itself, and the public copy only when that can't be read", async () => {
    const doc = document.implementation.createHTMLDocument('Gmail');
    doc.body.innerHTML =
      '<a href="https://accounts.google.com/SignOutOptions" aria-label="Google Account: Ada Lovelace (ada@example.com)"><img src="https://lh3.google.com/u/2/ogw/AF2bZy=s32-c-mo"></a>';
    const seen: string[] = [];
    const stub = (signedInOk: boolean) =>
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        seen.push(`${init?.credentials} ${url}`);
        // Work accounts: the public host answers with Google's generic photo, so it must not win.
        const ok = url.includes('googleusercontent') || (signedInOk && init?.credentials === 'include');
        return new Response(ok ? new Uint8Array([137, 80, 78, 71]) : 'no', {
          status: ok ? 200 : 403,
          headers: { 'content-type': ok ? 'image/png' : 'text/plain' },
        });
      });
    try {
      stub(true);
      expect((await backend(fakeFetch().fetch, { document: doc }).getAccount()).photoUrl).toBe('data:image/png;base64,iVBORw==');
      expect(seen).toEqual(['include https://lh3.google.com/u/2/ogw/AF2bZy=s128-c-mo']);
      stub(false);
      seen.length = 0;
      const viaExtension = backend(fakeFetch().fetch, { document: doc, fetchPhoto: async () => 'data:image/png;base64,QUJD' });
      expect((await viaExtension.getAccount()).photoUrl).toBe('data:image/png;base64,QUJD');
      expect((await backend(fakeFetch().fetch, { document: doc }).getAccount()).photoUrl).toBe('https://lh3.googleusercontent.com/ogw/AF2bZy=s128-c-mo');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('knows the signed-in address from GLOBALS before Gmail has made a sync call', async () => {
    const doc = document.implementation.createHTMLDocument('Gmail');
    const script = doc.createElement('script');
    script.textContent = `var GLOBALS=[null,null,1,"x",[1,2],null,null,null,null,"ik-1","ada@example.com",[3]];`;
    doc.head.append(script);
    const noTokens = new FakeTokens(null);
    expect(await backend(fakeFetch().fetch, { tokens: noTokens, document: doc }).accountHint(0)).toBe('ada@example.com');
    const blank = document.implementation.createHTMLDocument('Gmail');
    expect(await backend(fakeFetch().fetch, { tokens: noTokens, document: blank }).accountHint(0)).toBeUndefined();
  });

  it('lists labels with the inbox view request Gmail itself sends', async () => {
    const { fetch, calls } = fakeFetch(json(fixture('bv-current.json')));
    const labels = await backend(fetch).listLabels();
    const frame = (calls[0]!.body as Json)[0];
    expect(frame[3]).toBe('in:inbox');
    expect(frame[5]).toBe('itemlist-ViewType(49)-1');
    expect(labels.find((l) => l.id === '^x_17')?.name).toBe('Work/Projects');
  });
});
