import { describe, expect, it } from 'vitest';
import { BackendError } from '../../src/app/data/backend';
import { GmailApiBackend, wakeSnoozed, UPLOAD_THRESHOLD_BYTES } from '../../src/app/data/api/gmail-backend';
import { memoryStore, MUTED_STORAGE_KEY, SNOOZE_STORAGE_KEY, HELPER_LABELS_STORAGE_KEY } from '../../src/app/data/api/storage';
import { batchResponse, b64url, fullThread, metadataThread, NOT_FOUND, RATE_LIMITED, SCOPE_INSUFFICIENT } from './fixtures';
import { batchRequestLines, boundaryOf, fakeFetch, json, type Call } from './fake-fetch';

function setup(storage = memoryStore()) {
  const net = fakeFetch();
  const sleeps: number[] = [];
  const tokens: (boolean | undefined)[] = [];
  const backend = new GmailApiBackend(
    async (opts) => {
      tokens.push(opts?.forceRefresh);
      return opts?.forceRefresh ? 'fresh-token' : 'token-1';
    },
    {
      fetchImpl: net.fetchImpl,
      storage,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
      now: () => 1_000_000,
    },
  );
  return { net, backend, sleeps, tokens, storage };
}

/** Answers a batch call by mapping each inner request line to [status, body]. */
function batchHandler(answer: (line: string, i: number) => [string, unknown]) {
  return (call: Call) => {
    const lines = batchRequestLines(call.body);
    const boundary = 'batch_resp_' + boundaryOf(call);
    const body = batchResponse(
      boundary,
      lines.map((line, i) => {
        const [status, payload] = answer(line, i);
        return { contentId: `response-item${i}`, status, body: payload };
      }),
    );
    return new Response(body, { status: 200, headers: { 'Content-Type': `multipart/mixed; boundary=${boundary}` } });
  };
}

describe('listThreads', () => {
  it('lists, then fetches metadata for all threads in one batch, skipping a thread that vanished', async () => {
    const { net, backend } = setup();
    const meta = metadataThread();
    net
      .on('GET', /\/threads\?/, () =>
        json({
          threads: [
            { id: meta.id, snippet: 'x', historyId: '1' },
            { id: 'gone000000000001', snippet: 'y', historyId: '2' },
          ],
          nextPageToken: '0987654321',
          resultSizeEstimate: 201,
        }),
      )
      .on('POST', /\/batch\/gmail\/v1$/, batchHandler((line) => (line.includes('gone') ? ['404 Not Found', NOT_FOUND] : ['200 OK', meta])));

    const page = await backend.listThreads({ q: 'in:inbox category:primary', pageSize: 500 });

    const listUrl = new URL(net.calls[0].url);
    expect(listUrl.searchParams.get('q')).toBe('in:inbox category:primary');
    expect(listUrl.searchParams.get('maxResults')).toBe('50');
    expect(net.calls.filter((c) => c.url.endsWith('/batch/gmail/v1'))).toHaveLength(1);
    const inner = batchRequestLines(net.calls[1].body);
    expect(inner[0]).toBe(
      `GET /gmail/v1/users/me/threads/${meta.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`,
    );
    expect(net.calls[1].headers.Authorization).toBe('Bearer token-1');

    expect(page.nextPageToken).toBe('0987654321');
    expect(page.resultSizeEstimate).toBe(201);
    expect(page.threads.map((t) => t.id)).toEqual([meta.id]);
    expect(page.threads[0].participants.map((p) => p.email)).toEqual(['jane@example.com', 'sam@example.org']);
  });

  it('does not call the batch endpoint for an empty result', async () => {
    const { net, backend } = setup();
    net.on('GET', /\/threads\?/, () => json({ resultSizeEstimate: 0 }));
    expect(await backend.listThreads({ q: 'from:nobody' })).toEqual({ threads: [], resultSizeEstimate: 0 });
    expect(net.calls).toHaveLength(1);
  });

  it('turns in:snoozed into the helper label id and drops the operator from q', async () => {
    const storage = memoryStore({ [HELPER_LABELS_STORAGE_KEY]: { snoozed: 'Label_77' } });
    const { net, backend } = setup(storage);
    net.on('GET', /\/threads\?/, () => json({ resultSizeEstimate: 0 }));
    await backend.listThreads({ q: 'in:snoozed from:jane' });
    const url = new URL(net.calls[0].url);
    expect(url.searchParams.get('q')).toBe('from:jane');
    expect(url.searchParams.getAll('labelIds')).toEqual(['Label_77']);
  });
});

describe('retries and errors', () => {
  it('backs off after a 429 and succeeds on the second try', async () => {
    const { net, backend, sleeps } = setup();
    net.on('GET', /\/threads\?/, (_c, n) => (n === 0 ? json(RATE_LIMITED, 429) : json({ resultSizeEstimate: 0 })));
    await backend.listThreads({ q: '' });
    expect(net.calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(0);
  });

  it('gives up after three tries with a retryable rate-limited error, using growing delays', async () => {
    const { net, backend, sleeps } = setup();
    net.on('GET', /\/threads\?/, () => json({ error: { ...RATE_LIMITED.error, code: 403 } }, 403));
    const err = await backend.listThreads({ q: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ code: 'rate-limited', retryable: true });
    expect(net.calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0]);
  });

  it('honors Retry-After', async () => {
    const { net, backend, sleeps } = setup();
    net.on('GET', /\/threads\?/, (_c, n) => (n === 0 ? json(RATE_LIMITED, 429, { 'Retry-After': '7' }) : json({})));
    await backend.listThreads({ q: '' });
    expect(sleeps).toEqual([7000]);
  });

  it('maps network failures to a retryable network error', async () => {
    const { net, backend } = setup();
    net.on('GET', /\/profile$/, () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(backend.getAccount()).rejects.toMatchObject({ code: 'network', retryable: true });
    expect(net.calls).toHaveLength(3);
  });

  it('asks for a fresh token once after a 401, then fails as unauthenticated', async () => {
    const { net, backend, tokens } = setup();
    net.on('GET', /\/profile$/, (c) => (c.headers.Authorization === 'Bearer fresh-token' ? json({ error: { code: 401, message: 'Invalid Credentials' } }, 401) : json({ error: { code: 401, message: 'Invalid Credentials' } }, 401)));
    await expect(backend.getAccount()).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(tokens).toEqual([undefined, true]);
    expect(net.calls.map((c) => c.headers.Authorization)).toEqual(['Bearer token-1', 'Bearer fresh-token']);
  });

  it('re-sends only the batch parts that were rate limited', async () => {
    const { net, backend } = setup();
    net
      .on('GET', /\/threads\?/, () => json({ threads: [{ id: 'a1' }, { id: 'b2' }, { id: 'c3' }] }))
      .on(
        'POST',
        /\/batch\/gmail\/v1$/,
        batchHandler((line) => {
          const id = /threads\/(\w+)\?/.exec(line)![1];
          const firstRound = net.calls.filter((c) => c.url.endsWith('/batch/gmail/v1')).length === 1;
          if (id === 'b2' && firstRound) return ['429 Too Many Requests', RATE_LIMITED];
          return ['200 OK', { ...metadataThread(), id }];
        }),
      );
    const page = await backend.listThreads({ q: '' });
    const batches = net.calls.filter((c) => c.url.endsWith('/batch/gmail/v1'));
    expect(batches).toHaveLength(2);
    expect(batchRequestLines(batches[1].body)).toHaveLength(1);
    expect(batchRequestLines(batches[1].body)[0]).toContain('/threads/b2?');
    expect(page.threads.map((t) => t.id)).toEqual(['a1', 'b2', 'c3']);
  });

  it('explains that delete forever needs a scope the extension does not request', async () => {
    const { net, backend } = setup();
    net.on('DELETE', /\/threads\/t1$/, () => json(SCOPE_INSUFFICIENT, 403));
    await expect(backend.deleteThreadsForever(['t1'])).rejects.toMatchObject({
      code: 'unsupported',
      message: expect.stringContaining('mail.google.com'),
    });
  });
});

describe('getThread and attachments', () => {
  it('parses a full thread, fetches an oversized body, and serves attachments as standard base64', async () => {
    const { net, backend } = setup();
    const thread = fullThread();
    // Make the html body arrive by attachment id, as Gmail does for very large bodies.
    const html = thread.messages![0].payload!.parts![0].parts![0].parts![1];
    html.body = { attachmentId: 'BIGHTML', size: 6_000_000 };
    const bigHtml = '<p>' + '世界 '.repeat(10) + '</p>';
    net
      .on('GET', /\/threads\/18f2b000000000aa\?format=full$/, () => json(thread))
      .on('GET', /\/attachments\/BIGHTML$/, () => json({ size: 50, data: b64url(bigHtml) }))
      .on('GET', /\/attachments\/ANGjdJ_pdf$/, () => json({ size: 3, data: '-_-_' }));

    const t = await backend.getThread('18f2b000000000aa');
    expect(t.messages[0].bodyHtml).toBe(bigHtml);
    expect(t.hasAttachments).toBe(true);
    expect(t.attachments.map((a) => a.filename)).toEqual(['Q4 report.pdf', 'notes.txt', 'message.eml']);

    const att = await backend.getAttachment('18f2b000000000aa', 'ANGjdJ_pdf');
    expect(att).toEqual({ data: '+/+/', mimeType: 'application/pdf' });
  });
});

describe('modify, labels', () => {
  it('uses a direct call for one thread and a batch for many', async () => {
    const { net, backend } = setup();
    net
      .on('POST', /\/threads\/one\/modify$/, () => json({ id: 'one' }))
      .on('POST', /\/batch\/gmail\/v1$/, batchHandler(() => ['200 OK', {}]));
    await backend.modifyThreads(['one'], { add: ['STARRED'] });
    expect(JSON.parse(net.calls[0].body)).toEqual({ addLabelIds: ['STARRED'], removeLabelIds: [] });
    await backend.modifyThreads(['a', 'b'], { remove: ['UNREAD'] });
    expect(batchRequestLines(net.calls[1].body)).toEqual([
      'POST /gmail/v1/users/me/threads/a/modify',
      'POST /gmail/v1/users/me/threads/b/modify',
    ]);
    expect(net.calls[1].body).toContain('{"addLabelIds":[],"removeLabelIds":["UNREAD"]}');
  });

  it('surfaces a failed part of a batch modify', async () => {
    const { net, backend } = setup();
    net.on('POST', /\/batch\/gmail\/v1$/, batchHandler((_l, i) => (i === 1 ? ['404 Not Found', NOT_FOUND] : ['200 OK', {}])));
    await expect(backend.trashThreads(['a', 'b'])).rejects.toMatchObject({ code: 'not-found' });
  });

  it('reads counts with labels.get in a batch, names system labels, and hides the helper labels', async () => {
    const { net, backend } = setup();
    net
      .on('GET', /\/labels$/, () =>
        json({
          labels: [
            { id: 'INBOX', name: 'INBOX', type: 'system' },
            { id: 'Label_1', name: 'Work/Projects', type: 'user', color: { backgroundColor: '#16a766', textColor: '#ffffff' } },
            { id: 'Label_9', name: 'Snoozed (Better Gmail)', type: 'user' },
          ],
        }),
      )
      .on(
        'POST',
        /\/batch\/gmail\/v1$/,
        batchHandler((line) =>
          line.includes('INBOX')
            ? ['200 OK', { id: 'INBOX', name: 'INBOX', type: 'system', threadsTotal: 120, threadsUnread: 4 }]
            : line.includes('Label_1')
              ? ['500 Internal Server Error', { error: { code: 500, message: 'Backend Error' } }]
              : ['200 OK', { id: 'Label_9', name: 'Snoozed (Better Gmail)', type: 'user', threadsTotal: 2 }],
        ),
      );
    const labels = await backend.listLabels();
    expect(labels[0]).toEqual({ id: 'INBOX', name: 'Inbox', type: 'system', unreadCount: 4, totalCount: 120 });
    // The count lookup failed (even after retries): the list entry is still returned.
    expect(labels[1]).toEqual({ id: 'Label_1', name: 'Work/Projects', type: 'user', color: { background: '#16a766', text: '#ffffff' } });
    expect(labels[2]).toMatchObject({ id: 'Label_9', hidden: true });
  });

  it('snaps label colors to Gmail palette values', async () => {
    const { net, backend } = setup();
    net.on('POST', /\/labels$/, (c) => json({ id: 'Label_5', type: 'user', ...JSON.parse(c.body) }));
    await backend.createLabel({ name: 'Bills', color: { background: '#4a86e9', text: '#fffffe' } });
    expect(JSON.parse(net.calls[0].body).color).toEqual({ backgroundColor: '#4a86e8', textColor: '#ffffff' });
  });
});

describe('emulated snooze and mute', () => {
  it('creates the helper label on first use, archives, and records the wake time', async () => {
    const { net, backend, storage } = setup();
    net
      .on('GET', /\/labels$/, () => json({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] }))
      .on('POST', /\/labels$/, (c) => json({ id: 'Label_snz', name: JSON.parse(c.body).name, type: 'user' }))
      .on('POST', /\/threads\/t1\/modify$/, () => json({}));
    await backend.snoozeThreads(['t1'], 5_000_000);
    expect(JSON.parse(net.calls[1].body)).toMatchObject({ name: 'Snoozed (Better Gmail)', labelListVisibility: 'labelHide' });
    expect(JSON.parse(net.calls[2].body)).toEqual({ addLabelIds: ['Label_snz'], removeLabelIds: ['INBOX'] });
    expect(storage.data[SNOOZE_STORAGE_KEY]).toEqual({ t1: 5_000_000 });
  });

  it('wakeSnoozed brings back only due threads as unread and forgets them', async () => {
    const storage = memoryStore({
      [SNOOZE_STORAGE_KEY]: { due1: 900_000, due2: 1_000_000, later: 2_000_000, deleted: 10 },
      [HELPER_LABELS_STORAGE_KEY]: { snoozed: 'Label_snz' },
    });
    const net = fakeFetch();
    net.on('POST', /\/batch\/gmail\/v1$/, batchHandler((line) => (line.includes('deleted') ? ['404 Not Found', NOT_FOUND] : ['200 OK', {}])));
    const woken = await wakeSnoozed(async () => 'tok', { fetchImpl: net.fetchImpl, storage, now: () => 1_000_000, sleep: async () => {} });
    expect(woken.sort()).toEqual(['due1', 'due2']);
    expect(batchRequestLines(net.calls[0].body)).toHaveLength(3);
    expect(net.calls[0].body).toContain('{"addLabelIds":["INBOX","UNREAD"],"removeLabelIds":["Label_snz"]}');
    expect(storage.data[SNOOZE_STORAGE_KEY]).toEqual({ later: 2_000_000 });
  });

  it('wakeSnoozed keeps a snooze set in a tab while its wake-up call was out', async () => {
    const storage = memoryStore({
      [SNOOZE_STORAGE_KEY]: { due1: 900_000 },
      [HELPER_LABELS_STORAGE_KEY]: { snoozed: 'Label_snz' },
    });
    const net = fakeFetch();
    const ok = batchHandler(() => ['200 OK', {}]);
    net.on('POST', /\/batch\/gmail\/v1$/, async (call) => {
      await storage.set(SNOOZE_STORAGE_KEY, { ...(await storage.get<Record<string, number>>(SNOOZE_STORAGE_KEY)), fresh: 5_000_000 });
      return ok(call);
    });
    await wakeSnoozed(async () => 'tok', { fetchImpl: net.fetchImpl, storage, now: () => 1_000_000, sleep: async () => {} });
    expect(storage.data[SNOOZE_STORAGE_KEY]).toEqual({ fresh: 5_000_000 });
  });

  it('wakeSnoozed does not ask for a token when nothing is due', async () => {
    const storage = memoryStore({ [SNOOZE_STORAGE_KEY]: { later: 2_000_000 } });
    let asked = false;
    const result = await wakeSnoozed(
      async () => {
        asked = true;
        return 'tok';
      },
      { storage, now: () => 1_000_000 },
    );
    expect(result).toEqual([]);
    expect(asked).toBe(false);
  });

  it('pollChanges re-archives a muted thread that got a new inbox reply', async () => {
    const storage = memoryStore({ [MUTED_STORAGE_KEY]: ['muted1'] });
    const { net, backend } = setup(storage);
    net
      .on('GET', /\/profile$/, () => json({ emailAddress: 'sam@example.org', historyId: '100' }))
      .on('GET', /\/history\?/, () =>
        json({
          history: [
            { id: '101', messagesAdded: [{ message: { id: 'm1', threadId: 'muted1', labelIds: ['INBOX', 'UNREAD'] } }] },
            { id: '102', messagesAdded: [{ message: { id: 'm2', threadId: 'other', labelIds: ['INBOX'] } }] },
          ],
          historyId: '102',
        }),
      )
      .on('POST', /\/threads\/muted1\/modify$/, () => json({}));
    await backend.pollChanges();
    const changes = await backend.pollChanges();
    expect(changes).toEqual([{ type: 'threads', threadIds: ['muted1', 'other'] }, { type: 'labels' }]);
    const modify = net.calls.find((c) => c.url.endsWith('/threads/muted1/modify'))!;
    expect(JSON.parse(modify.body)).toEqual({ addLabelIds: [], removeLabelIds: ['INBOX'] });
  });
});

describe('pollChanges', () => {
  it('starts from the profile historyId, follows pages, and resyncs with type all on 404', async () => {
    const { net, backend } = setup();
    let profileHistory = '500';
    net
      .on('GET', /\/profile$/, () => json({ emailAddress: 'sam@example.org', historyId: profileHistory }))
      .on('GET', /\/history\?/, (c) => {
        const url = new URL(c.url);
        const start = url.searchParams.get('startHistoryId');
        if (start === '500' && !url.searchParams.get('pageToken')) {
          return json({ history: [{ id: '501', labelsAdded: [{ message: { id: 'm', threadId: 'tA' }, labelIds: ['STARRED'] }] }], nextPageToken: 'p2', historyId: '510' });
        }
        if (start === '500') {
          return json({ history: [{ id: '505', messagesDeleted: [{ message: { id: 'n', threadId: 'tB' } }] }], historyId: '510' });
        }
        if (start === '510') return json({ historyId: '510' });
        return json(NOT_FOUND, 404);
      });

    expect(await backend.pollChanges()).toEqual([]);
    expect(await backend.pollChanges()).toEqual([{ type: 'threads', threadIds: ['tA', 'tB'] }, { type: 'labels' }]);
    expect(await backend.pollChanges()).toEqual([]);

    // Pretend the stored id expired: the next history call 404s.
    (backend as unknown as { historyId: string }).historyId = '1';
    profileHistory = '900';
    expect(await backend.pollChanges()).toEqual([{ type: 'all' }]);
    expect((backend as unknown as { historyId: string }).historyId).toBe('900');
  });
});

describe('contacts', () => {
  it('warms up People search, then falls back to recent correspondents when the scope is missing', async () => {
    const { net, backend } = setup();
    const sentThread = {
      id: 's1',
      messages: [
        {
          id: 's1',
          threadId: 's1',
          labelIds: ['SENT'],
          payload: { headers: [{ name: 'To', value: '"Smith, Anna" <anna.smith@corp.com>, bob@corp.com' }, { name: 'Cc', value: 'Anna S <anna.smith@corp.com>' }] },
        },
        { id: 's2', threadId: 's1', labelIds: ['INBOX'], payload: { headers: [{ name: 'To', value: 'stranger@x.com' }] } },
      ],
    };
    net
      .on('GET', /people\.googleapis\.com/, () => json(SCOPE_INSUFFICIENT, 403))
      .on('GET', /\/threads\?/, () => json({ threads: [{ id: 's1' }] }))
      .on('POST', /\/batch\/gmail\/v1$/, batchHandler(() => ['200 OK', sentThread]));

    expect(await backend.searchContacts('smi')).toEqual([{ name: 'Smith, Anna', email: 'anna.smith@corp.com' }]);
    const peopleCalls = net.calls.filter((c) => c.url.includes('people.googleapis.com'));
    // Each endpoint got one warmup (empty query) and was then disabled.
    expect(peopleCalls.map((c) => new URL(c.url).searchParams.get('query'))).toEqual(['', '']);
    expect(new URL(net.calls.find((c) => c.url.includes('/threads?'))!.url).searchParams.get('q')).toBe('in:sent');

    // Second search: cached correspondents, no new network calls.
    const before = net.calls.length;
    expect((await backend.searchContacts('bo')).map((c) => c.email)).toEqual(['bob@corp.com']);
    expect(net.calls.length).toBe(before);
  });

  it('merges searchContacts and otherContacts results, deduped by email', async () => {
    const { net, backend } = setup();
    net
      .on('GET', /people:searchContacts/, () =>
        json({ results: [{ person: { names: [{ displayName: 'Ann Lee' }], emailAddresses: [{ value: 'ann@x.com' }], photos: [{ url: 'https://p/1', default: false }] } }] }),
      )
      .on('GET', /otherContacts:search/, () =>
        json({ results: [{ person: { emailAddresses: [{ value: 'ANN@x.com' }, { value: 'ann.lee@y.com' }] } }] }),
      )
      .on('GET', /\/threads\?/, () => json({}));
    expect(await backend.searchContacts('ann')).toEqual([
      { name: 'Ann Lee', email: 'ann@x.com', photoUrl: 'https://p/1' },
      { email: 'ann.lee@y.com' },
    ]);
    // Other contacts can't return photos; asking for them would make Google refuse the search.
    const other = net.calls.find((c) => c.url.includes('otherContacts:search'))!;
    expect(new URL(other.url).searchParams.get('readMask')).toBe('names,emailAddresses');
  });

  it('keeps saved-contact suggestions when other contacts fail', async () => {
    const { net, backend } = setup();
    net
      .on('GET', /people:searchContacts/, () => json({ results: [{ person: { names: [{ displayName: 'Ann Lee' }], emailAddresses: [{ value: 'ann@x.com' }] } }] }))
      .on('GET', /otherContacts:search/, () => json({ error: { code: 400, message: 'Invalid readMask' } }, 400))
      .on('GET', /\/threads\?/, () => json({}));
    expect((await backend.searchContacts('ann')).map((c) => c.email)).toEqual(['ann@x.com']);
  });

  it('finds photos in one listing of saved and other contacts instead of a search per address', async () => {
    const { net, backend } = setup();
    const person = (email: string, url?: string) => ({ emailAddresses: [{ value: email }], ...(url ? { photos: [{ url }] } : {}) });
    net
      .on('GET', /\/people\/me\/connections/, (_c, n) =>
        n === 0
          ? json({ connections: [person('Ann@x.com', 'https://p/ann'), person('bo@x.com')], nextPageToken: 'two' })
          : json({ connections: [person('cy@x.com', 'https://p/cy')] }),
      )
      .on('GET', /\/otherContacts\?/, () => json({ otherContacts: [person('dee@y.com', 'https://p/dee')] }));
    expect(await backend.lookupPhotos!(['ann@x.com', 'bo@x.com', 'cy@x.com', 'dee@y.com', 'zed@z.com'])).toEqual({
      'ann@x.com': 'https://p/ann',
      'cy@x.com': 'https://p/cy',
      'dee@y.com': 'https://p/dee',
    });
    const before = net.calls.length;
    expect(before).toBe(3);
    await backend.lookupPhotos!(['ann@x.com']);
    expect(net.calls.length).toBe(before);
  });
});

describe('send and drafts', () => {
  it.each([
    ['a dropped connection', () => {
      throw new TypeError('Failed to fetch');
    }],
    ['a server error', () => json({ error: { code: 503, message: 'Backend Error' } }, 503)],
  ])('does not send again after %s, which may have gone out', async (_name, fail) => {
    const { net, backend } = setup();
    net.on('POST', /\/messages\/send$/, fail);
    await expect(backend.send({ to: [{ email: 'a@b.com' }], cc: [], bcc: [], subject: 'Hi', html: '<p>x</p>', attachments: [] })).rejects.toBeInstanceOf(BackendError);
    expect(net.calls).toHaveLength(1);
  });

  it('does send again after a rate limit, which refused the message', async () => {
    const { net, backend } = setup();
    net.on('POST', /\/messages\/send$/, (_c, n) => (n === 0 ? json(RATE_LIMITED, 429) : json({ id: 's1', threadId: 't1' })));
    await backend.send({ to: [{ email: 'a@b.com' }], cc: [], bcc: [], subject: 'Hi', html: '<p>x</p>', attachments: [] });
    expect(net.calls).toHaveLength(2);
  });

  it('sends small mail as JSON raw with the thread id', async () => {
    const { net, backend } = setup();
    net.on('POST', /\/messages\/send$/, () => json({ id: 'sent1', threadId: 't9', labelIds: ['SENT'] }));
    const res = await backend.send({ threadId: 't9', to: [{ email: 'a@b.com' }], cc: [], bcc: [], subject: 'Hi', html: '<p>x</p>', attachments: [] });
    expect(res).toEqual({ id: 'sent1', threadId: 't9' });
    const body = JSON.parse(net.calls[0].body);
    expect(body.threadId).toBe('t9');
    const raw = new TextDecoder().decode(Uint8Array.from(atob(body.raw.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
    expect(raw).toMatch(/^To: a@b\.com\r\n/);
  });

  it('switches to the multipart upload endpoint above 5 MB of attachments', async () => {
    const { net, backend } = setup();
    net.on('POST', /\/upload\/gmail\/v1\/users\/me\/messages\/send\?uploadType=multipart$/, () => json({ id: 'big', threadId: 'tb' }));
    const data = btoa('x'.repeat(3)).repeat(Math.ceil(UPLOAD_THRESHOLD_BYTES / 3) + 10);
    await backend.send({
      threadId: 'tb',
      to: [{ email: 'a@b.com' }],
      cc: [],
      bcc: [],
      subject: 'Big',
      html: '<p>big</p>',
      attachments: [{ id: '1', filename: 'big.bin', mimeType: 'application/octet-stream', size: 0, data }],
    });
    const call = net.calls[0];
    expect(call.headers['Content-Type']).toMatch(/^multipart\/related; boundary=/);
    expect(call.body).toContain('{"threadId":"tb"}');
    expect(call.body).toContain('Content-Type: message/rfc822');
  });

  it('refuses a future sendAt instead of sending now', async () => {
    const { backend, net } = setup();
    await expect(
      backend.send({ to: [{ email: 'a@b.com' }], cc: [], bcc: [], subject: 's', html: '', attachments: [], sendAt: 9_000_000 }),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(net.calls).toHaveLength(0);
  });

  it('updates an existing draft with PUT and returns the stored message', async () => {
    const { net, backend } = setup();
    net
      .on('PUT', /\/drafts\/r123$/, () => json({ id: 'r123', message: { id: 'dm1', threadId: 't1', labelIds: ['DRAFT'] } }))
      .on('GET', /\/messages\/dm1\?format=full$/, () =>
        json({ id: 'dm1', threadId: 't1', labelIds: ['DRAFT'], payload: { mimeType: 'text/html', headers: [{ name: 'Subject', value: 'Draft' }], body: { data: b64url('<p>d</p>') } } }),
      );
    const draft = await backend.saveDraft({ draftId: 'r123', threadId: 't1', to: [], cc: [], bcc: [], subject: 'Draft', html: '<p>d</p>', attachments: [] });
    expect(JSON.parse(net.calls[0].body)).toMatchObject({ id: 'r123', message: { threadId: 't1' } });
    expect(draft).toMatchObject({ id: 'r123', message: { id: 'dm1', isDraft: true, bodyHtml: '<p>d</p>', subject: 'Draft' } });
  });

  it('sends a draft a thread showed by its message id under the draft id', async () => {
    const { net, backend } = setup();
    net
      .on('GET', /\/drafts\?maxResults=500$/, () => json({ drafts: [{ id: 'r9', message: { id: '18f0a1b2c3d4e5f6' } }] }))
      .on('POST', /\/drafts\/send/, () => json({ id: 'sent1', threadId: 't1' }));
    await backend.send({ draftId: '18f0a1b2c3d4e5f6', threadId: 't1', to: [{ email: 'a@b.com' }], cc: [], bcc: [], subject: 's', html: '', attachments: [] });
    expect(JSON.parse(net.calls.at(-1)!.body)).toMatchObject({ id: 'r9' });
  });
});

describe('unsubscribe', () => {
  const headers = (list: string, post?: string) => ({
    id: 'm1',
    threadId: 't1',
    payload: { headers: [{ name: 'List-Unsubscribe', value: list }, ...(post ? [{ name: 'List-Unsubscribe-Post', value: post }] : [])] },
  });

  it('uses RFC 8058 one-click when List-Unsubscribe-Post is present, without the Google token', async () => {
    const posted: string[] = [];
    const net = fakeFetch();
    const backend = new GmailApiBackend(async () => 'tok', {
      fetchImpl: net.fetchImpl,
      storage: memoryStore(),
      postOneClick: async (url) => {
        posted.push(url);
      },
    });
    net.on('GET', /\/messages\/m1\?/, () => json(headers('<mailto:u@x.com>, <https://x.com/unsub?id=1>', 'List-Unsubscribe=One-Click')));
    expect(await backend.unsubscribe('m1')).toBe('one-click');
    expect(posted).toEqual(['https://x.com/unsub?id=1']);
    expect(new URL(net.calls[0].url).searchParams.getAll('metadataHeaders')).toEqual(['List-Unsubscribe', 'List-Unsubscribe-Post']);
  });

  it('default one-click POST is credential-less and carries the RFC 8058 body', async () => {
    const { net, backend } = setup();
    net
      .on('GET', /\/messages\/m1\?/, () => json(headers('<https://x.com/u>', 'List-Unsubscribe=One-Click')))
      .on('POST', /^https:\/\/x\.com\/u$/, () => new Response(null, { status: 200 }));
    expect(await backend.unsubscribe('m1')).toBe('one-click');
    const post = net.calls[1];
    expect(post.body).toBe('List-Unsubscribe=One-Click');
    expect(post.headers.Authorization).toBeUndefined();
  });

  it('sends the mailto request when there is no one-click, and returns link when only https exists', async () => {
    const { net, backend } = setup();
    net
      .on('GET', /\/messages\/m1\?/, () => json(headers('<mailto:leave%2Blist@x.com?subject=remove%20me>')))
      .on('GET', /\/messages\/m2\?/, () => json({ ...headers('<https://x.com/u>'), id: 'm2' }))
      .on('POST', /\/messages\/send$/, () => json({ id: 's', threadId: 's' }));
    expect(await backend.unsubscribe('m1')).toBe('mailto');
    const raw = atob(JSON.parse(net.calls[1].body).raw.replace(/-/g, '+').replace(/_/g, '/'));
    expect(raw).toContain('To: leave+list@x.com');
    expect(raw).toContain('Subject: remove me');
    expect(await backend.unsubscribe('m2')).toBe('link');
  });
});
