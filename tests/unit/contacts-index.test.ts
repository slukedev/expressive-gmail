import { QueryClient } from '@tanstack/react-query';
import { BackendError } from '../../src/app/data/backend';
import { setBackend } from '../../src/app/data/client';
import {
  CONTACT_LIMITS,
  ContactIndex,
  RemoteContacts,
  WEIGHT,
  contactIndex,
  knownName,
  rankSuggestions,
  selfContacts,
  startContactIndex,
  summaryEntries,
} from '../../src/app/data/contacts';
import { createDemoBackend } from '../../src/app/data/demo';
import type { Address, ThreadPage, ThreadSummary } from '../../src/app/data/types';

const DAY = 24 * 60 * 60_000;
const NOW = new Date(2026, 9, 8, 9, 0).getTime();
const a = (email: string, name?: string): Address => ({ email, ...(name ? { name } : {}) });
const emails = (list: { email: string }[]) => list.map((c) => c.email);

describe('ContactIndex', () => {
  it('ranks by how often and how recently you mailed someone', () => {
    const index = new ContactIndex(() => NOW);
    // Written to twice, three months ago: two half-lives of decay.
    index.observe('m1', [[a('ana.lima@example.com', 'Ana Lima'), WEIGHT.wroteTo]], NOW - 90 * DAY);
    index.observe('m2', [[a('ana.lima@example.com', 'Ana Lima'), WEIGHT.wroteTo]], NOW - 90 * DAY);
    // Heard from once, yesterday.
    index.observe('m3', [[a('ana.beck@example.com', 'Ana Beck'), WEIGHT.heardFrom]], NOW - DAY);
    // Written to once, today.
    index.observe('m4', [[a('anabel@example.org', 'Anabel Ruiz'), WEIGHT.wroteTo]], NOW);
    expect(emails(index.search('ana'))).toEqual(['anabel@example.org', 'ana.lima@example.com', 'ana.beck@example.com']);
  });

  it('counts mail once however often the same thread is fetched again', () => {
    const index = new ContactIndex(() => NOW);
    const row = (id: string, from: Address): ThreadSummary => ({
      id, subject: '', snippet: '', labelIds: ['INBOX'], participants: [from], messageCount: 1, draftCount: 0, lastDate: NOW, hasAttachments: false, attachments: [],
    });
    for (let i = 0; i < 5; i++) index.observe('t:1:same', summaryEntries(row('1', a('lee@example.com', 'Lee'))), NOW);
    index.observe('t:2:a', summaryEntries(row('2', a('lou@example.com', 'Lou'))), NOW);
    index.observe('t:3:b', summaryEntries(row('3', a('lou@example.com', 'Lou'))), NOW);
    expect(emails(index.search('l'))).toEqual(['lou@example.com', 'lee@example.com']);
  });

  it('matches word starts in names and addresses, ignores accents, and never suggests you or no-reply senders', () => {
    const index = new ContactIndex(() => NOW);
    index.setSelf(['me@example.com', 'alias@example.com']);
    index.observe('m1', [
      [a('greta.mueller@example.org', 'Greta Müller'), 1],
      [a('jane.smith@example.net'), 1],
      [a('me@example.com', 'Me'), 3],
      [a('alias@example.com'), 3],
      [a('no-reply@shop.example.com', 'Shop'), 1],
    ], NOW);
    expect(emails(index.search('mül'))).toEqual(['greta.mueller@example.org']);
    expect(emails(index.search('smith'))).toEqual(['jane.smith@example.net']);
    expect(index.search('me')).toEqual([]);
    expect(index.search('shop')).toEqual([]);
  });

  it(`keeps at most ${CONTACT_LIMITS.people} people, dropping the least relevant`, () => {
    const index = new ContactIndex(() => NOW);
    index.observe('keep', [[a('zz-keep@example.com'), WEIGHT.wroteTo * 10]], NOW);
    for (let i = 0; i < CONTACT_LIMITS.people + 50; i++) index.observe(`m${i}`, [[a(`p${i}@example.com`), 1]], NOW - DAY * (i % 200));
    expect(index.size).toBeLessThanOrEqual(CONTACT_LIMITS.people);
    expect(emails(index.search('zz-keep'))).toEqual(['zz-keep@example.com']);
  });
});

describe('rankSuggestions', () => {
  const scored = (contact: Address, score: number) => ({ contact, score });

  it("follows Google's order, lifts people you mail too, fills names and photos, one entry per address", () => {
    const local = [scored(a('pat@example.com', 'Pat'), 0.5), scored(a('priya@example.com'), 6)];
    const remote = [
      { email: 'pablo@example.org', name: 'Pablo' },
      { email: 'PRIYA@example.com', name: 'Priya Natarajan', photoUrl: 'https://lh3.googleusercontent.com/a/p' },
    ];
    expect(rankSuggestions('p', { local, remote })).toEqual([
      { email: 'priya@example.com', name: 'Priya Natarajan', photoUrl: 'https://lh3.googleusercontent.com/a/p' },
      { email: 'pablo@example.org', name: 'Pablo' },
      { email: 'pat@example.com', name: 'Pat' },
    ]);
  });

  it('ranks a match at the start of the name above one inside it, and keeps Google matches we cannot explain last', () => {
    const remote = [
      // Google matched a nickname or company.
      { email: 'li.wei@example.com', name: 'Li Wei' },
      { email: 'jo.smith@example.com', name: 'Jo Smith' },
      { email: 'smithers@example.net', name: 'Waylon Smithers' },
    ];
    expect(rankSuggestions('smith', { local: [], remote }).map((c) => c.email)).toEqual(['smithers@example.net', 'jo.smith@example.com', 'li.wei@example.com']);
  });

  it('includes you when you type yourself, under the people you write to', () => {
    const self = [{ email: 'luke@example.com', name: 'Luke Ray' }, { email: 'hi@luke.example.org', name: 'Luke Ray' }];
    const local = [scored(a('lucia@example.com', 'Lucia'), 9)];
    expect(rankSuggestions('lu', { local, remote: [], self }).map((c) => c.email)).toEqual(['lucia@example.com', 'luke@example.com', 'hi@luke.example.org']);
    expect(rankSuggestions('zed', { local: [], remote: [], self })).toEqual([]);
  });
});

describe('knownName', () => {
  it('names a typed address from the suggestions on screen, then from the people you mail', () => {
    contactIndex.reset();
    contactIndex.observe('n1', [[a('priya.natarajan@example.com', 'Priya Natarajan'), WEIGHT.wroteTo]], NOW);
    expect(knownName('Priya.Natarajan@example.com')).toBe('Priya Natarajan');
    expect(knownName('me@example.com', [{ email: 'ME@example.com', name: 'Alex Rivera' }])).toBe('Alex Rivera');
    expect(knownName('stranger@example.com')).toBeUndefined();
    contactIndex.reset();
  });
});

describe('selfContacts', () => {
  it('lists the account, its send-as aliases and every merged member, only addresses that are yours', () => {
    const account = {
      email: 'ada@example.com', name: 'Ada', index: 0, photoUrl: 'https://lh3.googleusercontent.com/a/ada',
      sendAs: [{ email: 'ada@example.com' }, { email: 'hello@ada.example.org', name: 'Ada Studio' }],
      members: [{ email: 'ada.work@example.net', name: 'Ada W', index: 1 }],
    };
    expect(selfContacts(account as never, ['ada@example.com', 'hello@ada.example.org', 'ada.work@example.net'])).toEqual([
      { email: 'ada@example.com', name: 'Ada', photoUrl: 'https://lh3.googleusercontent.com/a/ada' },
      { email: 'hello@ada.example.org', name: 'Ada Studio' },
      { email: 'ada.work@example.net', name: 'Ada W' },
    ]);
  });
});

describe('RemoteContacts', () => {
  /** A fake backend search that counts calls and answers `size` people per prefix. */
  function counting(size = 3) {
    const asked: string[] = [];
    const search = async (prefix: string) => {
      asked.push(prefix);
      return Array.from({ length: size }, (_, i) => ({ email: `${prefix}${i}@example.com`, name: `${prefix} ${i}` }));
    };
    return { asked, search };
  }

  afterEach(() => vi.useRealTimers());

  it('sends one request once typing pauses; earlier keystrokes are cancelled before they go out', async () => {
    vi.useFakeTimers();
    const { asked, search } = counting();
    const remote = new RemoteContacts(search, () => NOW, { debounceMs: 120 });
    const settled: string[] = [];
    for (const prefix of ['p', 'pr', 'pri']) {
      const typing = new AbortController();
      const answer = remote.query(prefix, typing.signal).then(
        () => settled.push(`${prefix}: answered`),
        (err: Error) => settled.push(`${prefix}: ${err.name}`),
      );
      await vi.advanceTimersByTimeAsync(50);
      if (prefix !== 'pri') typing.abort();
      await vi.advanceTimersByTimeAsync(0);
      void answer;
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(asked).toEqual(['pri']);
    expect(settled).toEqual(['p: AbortError', 'pr: AbortError', 'pri: answered']);
  });

  it('reuses answers per prefix, and answers a longer prefix from a shorter one the source called complete', async () => {
    let now = NOW;
    const asked: string[] = [];
    const search = async (prefix: string) => {
      asked.push(prefix);
      return { contacts: [0, 1].map((i) => ({ email: `${prefix}${i}@example.com`, name: `${prefix} ${i}` })), complete: true };
    };
    const remote = new RemoteContacts(search, () => now, { ttlMs: 60_000 });
    expect(await remote.query('ma')).toHaveLength(2);
    expect(await remote.query('MA ')).toHaveLength(2);
    expect(await remote.query('ma 1')).toEqual([{ email: 'ma1@example.com', name: 'ma 1' }]);
    expect(asked).toEqual(['ma']);
    now += 60_000;
    await remote.query('ma');
    expect(asked).toEqual(['ma', 'ma']);
  });

  it('asks again for a longer prefix after a short answer the source did not call complete', async () => {
    // A merged inbox where one account failed answers with fewer people than there are.
    const { asked, search } = counting(1);
    const remote = new RemoteContacts(search, () => NOW);
    await remote.query('j');
    await remote.query('jo');
    expect(asked).toEqual(['j', 'jo']);
  });

  it('shares one request between callers asking the same thing at once', async () => {
    const { asked, search } = counting();
    const remote = new RemoteContacts(search, () => NOW);
    await Promise.all([remote.query('ana'), remote.query('ana')]);
    expect(asked).toEqual(['ana']);
  });

  it('answers [] instead of throwing, and rests before asking the remote again', async () => {
    let now = NOW;
    const search = vi.fn(async (prefix: string) => {
      if (search.mock.calls.length === 1) throw new BackendError('refused', 'unsupported');
      return [{ email: `${prefix}@example.com` }];
    });
    const remote = new RemoteContacts(search, () => now, 60_000);
    expect(await remote.query('pri')).toEqual([]);
    expect(await remote.query('priy')).toEqual([]);
    expect(search).toHaveBeenCalledTimes(1);
    now += 60_000;
    expect(await remote.query('priya')).toEqual([{ email: 'priya@example.com' }]);
  });
});

describe('startContactIndex', () => {
  const inbox: ThreadPage = {
    threads: [
      {
        id: 't1', subject: 'Hi', snippet: '', labelIds: ['INBOX'], participants: [a('quinn@example.com', 'Quinn Ortiz')],
        messageCount: 1, draftCount: 0, lastDate: NOW, hasAttachments: false, attachments: [],
      },
    ],
  };

  it('learns from loaded mail, saves per account, and never shows one account the other\'s people', async () => {
    setBackend(createDemoBackend({ now: () => NOW, liveMail: false }));
    let saved: Record<string, unknown> = {};
    const io = { read: async () => saved, write: async (v: unknown) => void (saved = v as Record<string, unknown>), sentDelayMs: 60_000 };
    const client = new QueryClient();

    const stopA = startContactIndex(client, 'session:ada@example.com', ['ada@example.com'], io);
    await client.fetchInfiniteQuery({ queryKey: ['threads', { q: 'in:inbox' }], queryFn: async () => inbox, initialPageParam: undefined });
    expect(emails(contactIndex.search('quinn'))).toEqual(['quinn@example.com']);
    await vi.waitFor(() => expect(Object.keys(saved)).toEqual(['session:ada@example.com']), { timeout: 3_000 });
    stopA();

    const stopB = startContactIndex(client, 'session:bob@example.com', ['bob@example.com'], io);
    client.clear();
    await new Promise((r) => setTimeout(r, 0));
    expect(contactIndex.search('quinn')).toEqual([]);
    stopB();

    const again = startContactIndex(client, 'session:ada@example.com', ['ada@example.com'], io);
    await vi.waitFor(() => expect(emails(contactIndex.search('quinn'))).toEqual(['quinn@example.com']));
    again();
  });
});
