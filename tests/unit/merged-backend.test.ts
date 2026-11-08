// @vitest-environment node
import type { MailBackend } from '../../src/app/data/backend';
import type { Label, LabelId, OutgoingMessage, ThreadSummary } from '../../src/app/data/types';
import { createDemoBackend, type DemoBackendOptions } from '../../src/app/data/demo';
import { createMergedBackend } from '../../src/app/data/accounts/merged';
import { accountKey, mergedLabelId, qualify, splitId } from '../../src/app/data/accounts/ids';
import { NOW } from '../demo/helpers';

type PersonaId = 'main' | 'studio' | 'makes';

const EMAIL: Record<PersonaId, string> = {
  main: 'alex.rivera@example.com',
  studio: 'alex@riverastudio.example.net',
  makes: 'alexr.makes@example.org',
};
const KEY: Record<PersonaId, string> = {
  main: accountKey(EMAIL.main),
  studio: accountKey(EMAIL.studio),
  makes: accountKey(EMAIL.makes),
};

const make = (persona: PersonaId, extra: DemoBackendOptions = {}) =>
  createDemoBackend({ now: () => NOW, liveMail: false, persona, ...extra });

type Members = Record<PersonaId, MailBackend>;

function setup(
  order: PersonaId[] = ['main', 'studio', 'makes'],
  opts: { extra?: Partial<Record<PersonaId, DemoBackendOptions>>; aliases?: Record<string, string[]> } = {},
) {
  const m = {} as Members;
  for (const p of order) m[p] = make(p, opts.extra?.[p]);
  const merged = createMergedBackend(
    order.map((p) => ({ key: KEY[p], email: EMAIL[p], backend: m[p] })),
    opts.aliases ? { aliases: () => opts.aliases! } : undefined,
  );
  return { m, merged };
}

/** Every thread a backend returns for a query, following every page. */
async function all(b: MailBackend, q: string, pageSize = 500): Promise<{ threads: ThreadSummary[]; pages: ThreadSummary[][]; firstEstimate?: number }> {
  const pages: ThreadSummary[][] = [];
  let pageToken: string | undefined;
  let firstEstimate: number | undefined;
  for (let guard = 0; guard < 1000; guard++) {
    const page = await b.listThreads({ q, pageSize, ...(pageToken ? { pageToken } : {}) });
    if (guard === 0) firstEstimate = page.resultSizeEstimate;
    pages.push(page.threads);
    pageToken = page.nextPageToken;
    if (!pageToken) return { threads: pages.flat(), pages, firstEstimate };
  }
  throw new Error('paging never ended');
}

async function qualifiedIds(b: MailBackend, persona: PersonaId, q: string): Promise<string[]> {
  return (await all(b, q)).threads.map((t) => qualify(KEY[persona], t.id));
}

const sortedIds = (list: string[]) => [...list].sort();

/** What a member's label id should look like in the merged scope. */
function mergedIdFor(labels: Label[], id: LabelId): LabelId {
  const l = labels.find((x) => x.id === id);
  return l && l.type === 'user' ? mergedLabelId(l.name) : id;
}

async function drain(...backends: MailBackend[]) {
  for (const b of backends) await b.pollChanges();
}

const outgoing = (over: Partial<OutgoingMessage>): OutgoingMessage => ({
  to: [{ email: 'pat@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Kiln schedule',
  html: '<p>Does Thursday work?</p>',
  attachments: [],
  ...over,
});

describe('createMergedBackend listThreads', () => {
  it('pages every thread from three accounts exactly once, newest first, with a small page size', async () => {
    const { m, merged } = setup();
    const q = '';
    const perMember = await Promise.all(
      (['main', 'studio', 'makes'] as const).map(async (p) => ({ p, page: await all(m[p], q) })),
    );
    const expected = perMember.flatMap(({ p, page }) => page.threads.map((t) => ({ id: qualify(KEY[p], t.id), lastDate: t.lastDate })));
    const counts = perMember.map(({ page }) => page.threads.length);
    // The fixture accounts differ a lot in size; that's what makes interleaving hard.
    expect(Math.max(...counts)).toBeGreaterThan(2 * Math.min(...counts));

    const got = await all(merged, q, 5);
    const ids = got.threads.map((t) => t.id);

    expect(got.pages.every((p) => p.length <= 5)).toBe(true);
    expect(got.pages.slice(0, -1).every((p) => p.length === 5)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sortedIds(ids)).toEqual(sortedIds(expected.map((e) => e.id)));
    expect(got.threads.map((t) => t.lastDate)).toEqual(expected.map((e) => e.lastDate).sort((a, b) => b - a));
    expect(got.firstEstimate).toBe(perMember.reduce((s, { page }) => s + (page.firstEstimate ?? 0), 0));
  });

  it('pages a narrow query where one account has most of the matches', async () => {
    const { m, merged } = setup();
    const q = 'in:inbox is:unread';
    const expected = [
      ...(await qualifiedIds(m.main, 'main', q)),
      ...(await qualifiedIds(m.studio, 'studio', q)),
      ...(await qualifiedIds(m.makes, 'makes', q)),
    ];
    const got = await all(merged, q, 3);
    const ids = got.threads.map((t) => t.id);
    expect(ids).toHaveLength(expected.length);
    expect(sortedIds(ids)).toEqual(sortedIds(expected));
    const dates = got.threads.map((t) => t.lastDate);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('qualifies ids and rewrites user label ids to merged names on every thread', async () => {
    const { m, merged } = setup();
    const memberLabels = {
      main: await m.main.listLabels(),
      studio: await m.studio.listLabels(),
      makes: await m.makes.listLabels(),
    };
    const byId = new Map<string, { p: PersonaId; t: ThreadSummary }>();
    for (const p of ['main', 'studio', 'makes'] as const) {
      for (const t of (await all(m[p], '')).threads) byId.set(qualify(KEY[p], t.id), { p, t });
    }

    const got = (await all(merged, '')).threads;
    let userLabelled = 0;
    for (const t of got) {
      const { key, raw } = splitId(t.id);
      const src = byId.get(t.id);
      expect(src, t.id).toBeDefined();
      expect(key).toBe(KEY[src!.p]);
      expect(raw).toBe(src!.t.id);
      expect(sortedIds(t.labelIds)).toEqual(sortedIds(src!.t.labelIds.map((l) => mergedIdFor(memberLabels[src!.p], l))));
      for (const a of t.attachments) expect(splitId(a.messageId).key).toBe(key);
      if (t.labelIds.some((l) => l.startsWith('L~'))) userLabelled++;
    }
    // Studio's "Clients" and Makes' "Ceramics" share the raw id Label_1; both must be told apart.
    expect(got.some((t) => splitId(t.id).key === KEY.studio && t.labelIds.includes(mergedLabelId('Clients')))).toBe(true);
    expect(got.some((t) => splitId(t.id).key === KEY.makes && t.labelIds.includes(mergedLabelId('Ceramics')))).toBe(true);
    expect(got.some((t) => t.labelIds.includes('Label_1'))).toBe(false);
    expect(userLabelled).toBeGreaterThan(5);
  });
});

describe('createMergedBackend account: filter', () => {
  it('restricts members by email prefix and strips the term before it reaches them', async () => {
    const { m, merged } = setup();
    const makesCeramics = await qualifiedIds(m.makes, 'makes', 'label:Ceramics');
    expect(makesCeramics.length).toBeGreaterThan(0);
    expect(sortedIds((await all(merged, 'account:alexr label:Ceramics')).threads.map((t) => t.id))).toEqual(sortedIds(makesCeramics));

    const mainInbox = await qualifiedIds(m.main, 'main', 'in:inbox');
    expect(sortedIds((await all(merged, 'account:alex.rivera in:inbox')).threads.map((t) => t.id))).toEqual(sortedIds(mainInbox));

    // The full address and the account key both name one member.
    expect(sortedIds((await all(merged, `in:inbox account:${EMAIL.studio}`)).threads.map((t) => t.id))).toEqual(
      sortedIds(await qualifiedIds(m.studio, 'studio', 'in:inbox')),
    );
    expect(sortedIds((await all(merged, `account:${KEY.makes} in:inbox`)).threads.map((t) => t.id))).toEqual(
      sortedIds(await qualifiedIds(m.makes, 'makes', 'in:inbox')),
    );
  });

  it('matches aliases by prefix and by whole word, and gives an empty page when nothing matches', async () => {
    const aliases = { [KEY.studio]: ['side studio'], [KEY.makes]: ['pottery shop'] };
    const { m, merged } = setup(['main', 'studio', 'makes'], { aliases });
    const studioInbox = sortedIds(await qualifiedIds(m.studio, 'studio', 'in:inbox'));
    const makesInbox = sortedIds(await qualifiedIds(m.makes, 'makes', 'in:inbox'));

    expect(sortedIds((await all(merged, 'account:studio in:inbox')).threads.map((t) => t.id))).toEqual(studioInbox);
    expect(sortedIds((await all(merged, 'account:pott in:inbox')).threads.map((t) => t.id))).toEqual(makesInbox);
    // "stud" is neither a prefix of the alias nor a whole word in it, nor an address prefix.
    const partial = await merged.listThreads({ q: 'account:stud in:inbox', pageSize: 10 });
    expect(partial.threads).toEqual([]);
    expect(partial.nextPageToken).toBeUndefined();

    // Without aliases the same word matches nobody, so the alias is what selected studio above.
    const plain = setup().merged;
    const none = await plain.listThreads({ q: 'account:studio in:inbox', pageSize: 10 });
    expect(none.threads).toEqual([]);
    expect(none.nextPageToken).toBeUndefined();
  });
});

describe('createMergedBackend failures', () => {
  it('returns the answering accounts and names the ones that failed', async () => {
    const { m, merged } = setup(['main', 'studio', 'makes'], { extra: { studio: { failRate: 1 } } });
    const expected = [...(await qualifiedIds(m.main, 'main', 'in:inbox')), ...(await qualifiedIds(m.makes, 'makes', 'in:inbox'))];
    const page = await merged.listThreads({ q: 'in:inbox', pageSize: 500 });
    expect(sortedIds(page.threads.map((t) => t.id))).toEqual(sortedIds(expected));
    expect(page.unavailable).toEqual([{ email: EMAIL.studio, message: expect.any(String) }]);
    expect(page.unavailable![0]!.message.length).toBeGreaterThan(0);
  });

  it('rejects when every account fails', async () => {
    const { merged } = setup(['main', 'makes'], { extra: { main: { failRate: 1 }, makes: { failRate: 1 } } });
    await expect(merged.listThreads({ q: 'in:inbox', pageSize: 10 })).rejects.toThrow();
  });
});

describe('createMergedBackend labels', () => {
  it('merges user labels by name and sums counts across accounts', async () => {
    const { m, merged } = setup();
    const lists = { main: await m.main.listLabels(), studio: await m.studio.listLabels(), makes: await m.makes.listLabels() };
    const labels = await merged.listLabels();
    const find = (id: string) => labels.filter((l) => l.id === id);
    const sum = (pick: (l: Label) => boolean, field: 'unreadCount' | 'totalCount') =>
      Object.values(lists).reduce((s, list) => s + (list.find(pick)?.[field] ?? 0), 0);

    for (const sys of ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS', 'SENT']) {
      expect(find(sys)).toHaveLength(1);
      expect(find(sys)[0]).toMatchObject({
        type: 'system',
        unreadCount: sum((l) => l.id === sys, 'unreadCount'),
        totalCount: sum((l) => l.id === sys, 'totalCount'),
      });
    }

    const receipts = find(mergedLabelId('Receipts'));
    expect(receipts).toHaveLength(1);
    const isReceipts = (l: Label) => l.type === 'user' && l.name === 'Receipts';
    expect(lists.main.some(isReceipts) && lists.makes.some(isReceipts) && !lists.studio.some(isReceipts)).toBe(true);
    expect(receipts[0]).toMatchObject({
      name: 'Receipts',
      type: 'user',
      unreadCount: sum(isReceipts, 'unreadCount'),
      totalCount: sum(isReceipts, 'totalCount'),
    });
    expect(receipts[0]!.totalCount).toBeGreaterThan(lists.main.find(isReceipts)!.totalCount!);

    const userNames = new Set(Object.values(lists).flatMap((list) => list.filter((l) => l.type === 'user').map((l) => l.name)));
    const mergedUser = labels.filter((l) => l.type === 'user');
    expect(sortedIds(mergedUser.map((l) => l.id))).toEqual(sortedIds([...userNames].map(mergedLabelId)));
  });
});

describe('createMergedBackend writes', () => {
  it('routes each change to the owning account with raw ids, even across label id collisions', async () => {
    const { m, merged } = setup();
    const [mainT] = (await all(m.main, 'in:inbox')).threads;
    const [makesT] = (await all(m.makes, 'in:inbox')).threads;
    const [studioT] = (await all(m.studio, 'in:inbox')).threads;
    await drain(m.main, m.studio, m.makes, merged);

    const ids = [qualify(KEY.main, mainT!.id), qualify(KEY.makes, makesT!.id)];
    await merged.modifyThreads(ids, { add: ['STARRED', mergedLabelId('Receipts')] });

    const mainLabels = await m.main.listLabels();
    const makesLabels = await m.makes.listLabels();
    const rawReceipts = (list: Label[]) => list.find((l) => l.type === 'user' && l.name === 'Receipts')!.id;
    expect((await m.main.getThread(mainT!.id)).labelIds).toEqual(expect.arrayContaining(['STARRED', rawReceipts(mainLabels)]));
    expect((await m.makes.getThread(makesT!.id)).labelIds).toEqual(expect.arrayContaining(['STARRED', rawReceipts(makesLabels)]));

    // Only the owners saw a change; studio's mailbox is untouched.
    expect(await m.studio.pollChanges()).toEqual([]);
    expect((await m.studio.getThread(studioT!.id)).labelIds).toEqual(studioT!.labelIds);
    const changes = await merged.pollChanges();
    const changed = changes.flatMap((c) => (c.type === 'threads' ? c.threadIds : []));
    expect(sortedIds(changed)).toEqual(sortedIds(ids));

    // The merged view shows the merged label on both threads.
    for (const id of ids) expect((await merged.getThread(id)).labelIds).toContain(mergedLabelId('Receipts'));

    await merged.trashThreads([qualify(KEY.studio, studioT!.id), ids[0]!]);
    expect((await m.studio.getThread(studioT!.id)).labelIds).toContain('TRASH');
    expect((await m.main.getThread(mainT!.id)).labelIds).toContain('TRASH');
    expect((await m.makes.getThread(makesT!.id)).labelIds).not.toContain('TRASH');
  });

  it('creates a missing merged label in the owning account before applying it', async () => {
    const { m, merged } = setup();
    const [studioT] = (await all(m.studio, 'in:inbox')).threads;
    const before = (await merged.listLabels()).find((l) => l.id === mergedLabelId('Receipts'))!;
    const mainBefore = (await m.main.listLabels()).filter((l) => l.type === 'user');

    await merged.modifyThreads([qualify(KEY.studio, studioT!.id)], { add: [mergedLabelId('Receipts')] });

    const created = (await m.studio.listLabels()).filter((l) => l.type === 'user' && l.name === 'Receipts');
    expect(created).toHaveLength(1);
    expect((await m.studio.getThread(studioT!.id)).labelIds).toContain(created[0]!.id);
    expect((await m.main.listLabels()).filter((l) => l.type === 'user')).toEqual(mainBefore);

    const after = (await merged.listLabels()).filter((l) => l.id === mergedLabelId('Receipts'));
    expect(after).toHaveLength(1);
    expect(after[0]!.totalCount).toBe(before.totalCount! + 1);
  });

  it('snoozes and mutes only in the owning account', async () => {
    const { m, merged } = setup();
    const [mainT] = (await all(m.main, 'in:inbox')).threads;
    const [makesT] = (await all(m.makes, 'in:inbox')).threads;
    const until = NOW + 3 * 24 * 60 * 60_000;

    await merged.snoozeThreads([qualify(KEY.makes, makesT!.id)], until);
    await merged.muteThreads([qualify(KEY.main, mainT!.id)], true);

    expect((await m.makes.getThread(makesT!.id)).snoozedUntil).toBe(until);
    expect((await m.main.getThread(mainT!.id)).snoozedUntil).toBeUndefined();
    expect((await all(m.main, 'in:inbox')).threads.map((t) => t.id)).not.toContain(mainT!.id);
    expect((await all(m.makes, 'in:inbox')).threads.map((t) => t.id)).not.toContain(makesT!.id);

    await merged.unsnoozeThreads([qualify(KEY.makes, makesT!.id)]);
    expect((await all(m.makes, 'in:inbox')).threads.map((t) => t.id)).toContain(makesT!.id);
  });
});

describe('createMergedBackend getThread', () => {
  it('finds the owner of an unqualified id and qualifies everything it returns', async () => {
    const { m, merged } = setup();
    const others = new Set([...(await all(m.main, '')).threads, ...(await all(m.makes, '')).threads].map((t) => t.id));
    const studioThreads = (await all(m.studio, 'has:attachment')).threads;
    const raw = studioThreads.find((t) => !others.has(t.id))?.id;
    expect(raw).toBeDefined();
    const direct = await m.studio.getThread(raw!);

    for (const id of [raw!, qualify(KEY.studio, raw!)]) {
      const t = await merged.getThread(id);
      expect(t.id).toBe(qualify(KEY.studio, raw!));
      expect(t.subject).toBe(direct.subject);
      expect(t.messages.map((x) => x.id)).toEqual(direct.messages.map((x) => qualify(KEY.studio, x.id)));
      expect(t.messages.every((x) => x.threadId === t.id)).toBe(true);
      const atts = t.messages.flatMap((x) => x.attachments);
      expect(atts.length).toBeGreaterThan(0);
      expect(atts.every((a) => splitId(a.messageId).key === KEY.studio)).toBe(true);
    }
  });
});

describe('createMergedBackend send', () => {
  it('sends a reply through the account that owns the thread', async () => {
    const { m, merged } = setup();
    const [studioT] = (await all(m.studio, 'in:inbox')).threads;
    const before = (await m.studio.getThread(studioT!.id)).messages.length;
    const mainSent = await qualifiedIds(m.main, 'main', 'in:sent');
    const makesSent = await qualifiedIds(m.makes, 'makes', 'in:sent');

    const res = await merged.send(outgoing({ threadId: qualify(KEY.studio, studioT!.id), subject: `Re: ${studioT!.subject}` }));

    expect(res.threadId).toBe(qualify(KEY.studio, studioT!.id));
    expect(splitId(res.id).key).toBe(KEY.studio);
    const after = await m.studio.getThread(studioT!.id);
    expect(after.messages).toHaveLength(before + 1);
    expect(after.messages.map((x) => x.id)).toContain(splitId(res.id).raw);
    expect(await qualifiedIds(m.main, 'main', 'in:sent')).toEqual(mainSent);
    expect(await qualifiedIds(m.makes, 'makes', 'in:sent')).toEqual(makesSent);
  });

  it('routes a new message by from address, send-as alias, or to the first member', async () => {
    const { m, merged } = setup(['studio', 'main', 'makes']);
    const sentBefore = {
      main: await qualifiedIds(m.main, 'main', 'in:sent'),
      studio: await qualifiedIds(m.studio, 'studio', 'in:sent'),
      makes: await qualifiedIds(m.makes, 'makes', 'in:sent'),
    };
    const newlySent = async (p: PersonaId) => (await qualifiedIds(m[p], p, 'in:sent')).filter((id) => !sentBefore[p].includes(id));

    const toMakes = await merged.send(outgoing({ from: { email: EMAIL.makes } }));
    const toMainAlias = await merged.send(outgoing({ from: { email: 'hello@alexrivera.example.net' } }));
    const toFirst = await merged.send(outgoing({}));

    expect(await newlySent('makes')).toEqual([toMakes.threadId]);
    expect(await newlySent('main')).toEqual([toMainAlias.threadId]);
    expect(await newlySent('studio')).toEqual([toFirst.threadId]);
    expect(splitId(toMakes.id).key).toBe(KEY.makes);
  });
});

describe('createMergedBackend drafts', () => {
  it('keeps a draft in the account it was written from, through save, update and send', async () => {
    const { m, merged } = setup(['main', 'studio', 'makes']);
    const [makesT] = (await all(m.makes, 'in:inbox')).threads;
    const threadId = qualify(KEY.makes, makesT!.id);

    const draft = await merged.saveDraft(outgoing({ threadId, subject: `Re: ${makesT!.subject}` }));
    expect(splitId(draft.id).key).toBe(KEY.makes);
    expect(draft.message.threadId).toBe(threadId);
    expect((await m.makes.getThread(makesT!.id)).draftCount).toBe(makesT!.draftCount + 1);

    const updated = await merged.saveDraft(outgoing({ draftId: draft.id, threadId, html: '<p>Friday instead</p>' }));
    expect(updated.id).toBe(draft.id);
    const inMakes = (await m.makes.getThread(makesT!.id)).messages.find((x) => x.isDraft && x.id === splitId(updated.message.id).raw);
    expect(inMakes?.bodyHtml).toBe('<p>Friday instead</p>');

    const sent = await merged.send(outgoing({ draftId: draft.id, threadId }));
    expect(sent.threadId).toBe(threadId);
    const after = await m.makes.getThread(makesT!.id);
    expect(after.draftCount).toBe(makesT!.draftCount);
    expect(after.messages.some((x) => x.id === splitId(sent.id).raw && x.labelIds.includes('SENT'))).toBe(true);
  });

  it('deletes a draft by its qualified id in the owning account only', async () => {
    const { m, merged } = setup(['main', 'makes']);
    const draft = await merged.saveDraft(outgoing({ from: { email: EMAIL.makes } }));
    expect(splitId(draft.id).key).toBe(KEY.makes);
    const drafts = async (b: MailBackend) => (await all(b, 'in:drafts')).threads.length;
    const before = { main: await drafts(m.main), makes: await drafts(m.makes) };
    await merged.deleteDraft(draft.id);
    expect(await drafts(m.makes)).toBe(before.makes - 1);
    expect(await drafts(m.main)).toBe(before.main);
  });
});

describe('createMergedBackend account and capabilities', () => {
  it('describes the first member, lists every member and every send-as address', async () => {
    const { merged } = setup(['makes', 'main', 'studio']);
    const acct = await merged.getAccount();
    expect(acct.email).toBe(EMAIL.makes);
    expect(acct.members?.map((x) => [x.key, x.email, x.index])).toEqual([
      [KEY.makes, EMAIL.makes, 2],
      [KEY.main, EMAIL.main, 0],
      [KEY.studio, EMAIL.studio, 1],
    ]);
    expect(acct.sendAs?.map((a) => a.email)).toEqual(
      expect.arrayContaining([EMAIL.main, EMAIL.studio, EMAIL.makes, 'hello@alexrivera.example.net']),
    );
  });

  it('turns filters off and keeps a capability only when every member has it', () => {
    const main = make('main');
    const noMute = Object.assign(Object.create(make('studio')) as MailBackend, {
      capabilities: { ...main.capabilities, mute: false },
    });
    const merged = createMergedBackend([
      { key: KEY.main, email: EMAIL.main, backend: main },
      { key: KEY.studio, email: EMAIL.studio, backend: noMute },
    ]);
    expect(main.capabilities.filters && main.capabilities.mute && main.capabilities.send).toBe(true);
    expect(merged.capabilities).toMatchObject({ filters: false, mute: false, send: true, snooze: true });
  });

  it('empties every account\'s Trash, not only the loaded rows, and counts them all', async () => {
    const { m, merged } = setup(['main', 'studio']);
    const before = (await all(m.main, 'in:trash')).threads.length + (await all(m.studio, 'in:trash')).threads.length;
    expect(before).toBeGreaterThan(0);
    expect(await merged.emptyFolder!('trash')).toBe(before);
    expect((await all(merged, 'in:trash')).threads).toEqual([]);
  });
});
