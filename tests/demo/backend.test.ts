import { BackendError, type MailBackend } from '../../src/app/data/backend';
import type { Label, OutgoingMessage } from '../../src/app/data/types';
import { createDemoBackend, DEMO_LABEL_IDS as L, DEMO_NOTICE, draftIdFor, LIVE_MAIL_INTERVAL_MS } from '../../src/app/data/demo';
import { clock, count, DAY, demo, HOUR, ids, MIN, NOW, sorted } from './helpers';

const ME = 'alex.rivera@example.com';

function outgoing(over: Partial<OutgoingMessage> = {}): OutgoingMessage {
  return {
    to: [{ name: 'Jordan Lee', email: 'jordan.lee@example.net' }],
    cc: [],
    bcc: [],
    subject: 'dinner friday?',
    html: '<div>thinking that new dumpling place, 7pm?</div>',
    attachments: [],
    ...over,
  };
}

/** The query that lists exactly what a label's counts describe. */
function queryFor(l: Label): string {
  const system: Record<string, string> = {
    INBOX: 'in:inbox',
    STARRED: 'is:starred',
    SNOOZED: 'in:snoozed',
    IMPORTANT: 'is:important',
    SENT: 'in:sent',
    SCHEDULED: 'in:scheduled',
    SPAM: 'in:spam',
    TRASH: 'in:trash',
    UNREAD: 'is:unread',
    CATEGORY_PERSONAL: 'label:CATEGORY_PERSONAL',
    CATEGORY_SOCIAL: 'category:social',
    CATEGORY_PROMOTIONS: 'category:promotions',
    CATEGORY_UPDATES: 'category:updates',
    CATEGORY_FORUMS: 'category:forums',
  };
  return system[l.id] ?? `label:"${l.name}"`;
}

/** Every label count must agree with what search returns for that label. */
async function expectCountsMatchSearch(b: MailBackend) {
  const labels = await b.listLabels();
  for (const l of labels) {
    if (l.id === 'DRAFT' || l.id === 'CHAT') continue;
    const q = queryFor(l);
    expect({ label: l.name, total: l.totalCount }).toEqual({ label: l.name, total: await count(b, q) });
    expect({ label: l.name, unread: l.unreadCount }).toEqual({ label: l.name, unread: await count(b, `${q} is:unread`) });
  }
}

function label(labels: Label[], id: string): Label {
  const l = labels.find((x) => x.id === id);
  if (!l) throw new Error(`no label ${id}`);
  return l;
}

describe('snooze', () => {
  it('hides a thread until the clock passes the wake time, then brings it back unread at the top', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now, liveMail: false });
    const id = 't-mira-letter'; // read, starred, three days old
    await b.snoozeThreads([id], NOW + 3 * HOUR);
    await b.pollChanges();

    expect(await ids(b, 'in:inbox')).not.toContain(id);
    expect(await ids(b, 'in:snoozed')).toContain(id);
    expect((await b.getThread(id)).snoozedUntil).toBe(NOW + 3 * HOUR);

    c.advance(3 * HOUR - 1000);
    expect(await ids(b, 'in:inbox')).not.toContain(id);
    expect(await b.pollChanges()).toEqual([]);

    c.advance(2000);
    const inbox = await ids(b, 'in:inbox');
    expect(inbox[0]).toBe(id); // sorts by wake time, not by its old date
    const t = await b.getThread(id);
    expect(t.labelIds).toContain('UNREAD');
    expect(t.labelIds).not.toContain('SNOOZED');
    expect(t.snoozedUntil).toBeUndefined();
    expect(t.lastDate).toBeLessThan(NOW - DAY); // the message itself keeps its date
    expect(await b.pollChanges()).toEqual([{ type: 'threads', threadIds: [id] }, { type: 'labels' }]);
    expect(await ids(b, 'in:snoozed')).not.toContain(id);
  });

  it('wakes the fixture snoozes on their own schedule', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now, liveMail: false });
    expect(sorted(await ids(b, 'in:snoozed'))).toEqual(['x-snoozed-dentist', 'x-snoozed-housewarming']);
    c.set(new Date(2026, 9, 9, 8, 0, 1).getTime()); // dentist wakes tomorrow at 8:00
    expect(await ids(b, 'in:snoozed')).toEqual(['x-snoozed-housewarming']);
    expect((await ids(b, 'in:inbox is:unread'))[0]).toBe('x-snoozed-dentist');
    c.advance(3 * DAY);
    expect(await ids(b, 'in:snoozed')).toEqual([]);
  });

  it('unsnooze returns to the inbox without marking unread, and rejects past times', async () => {
    const b = demo();
    await b.snoozeThreads(['t-greta'], NOW + DAY);
    await b.unsnoozeThreads(['t-greta']);
    const t = await b.getThread('t-greta');
    expect(t.labelIds).toContain('INBOX');
    expect(t.labelIds).not.toContain('UNREAD');
    await expect(b.snoozeThreads(['t-greta'], NOW - MIN)).rejects.toBeInstanceOf(BackendError);
  });
});

describe('scheduled send', () => {
  it('sits in Scheduled until sendAt, then moves to Sent with the scheduled date', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now, liveMail: false });
    const sendAt = NOW + 30 * MIN;
    const sent = await b.send(outgoing({ sendAt }));
    const before = await b.getThread(sent.threadId);
    expect(before.scheduledFor).toBe(sendAt);
    expect(await ids(b, 'in:scheduled')).toContain(sent.threadId);
    expect(await ids(b, 'in:sent')).not.toContain(sent.threadId);

    c.advance(29 * MIN);
    expect(await ids(b, 'in:sent')).not.toContain(sent.threadId);

    c.advance(2 * MIN);
    expect(await ids(b, 'in:scheduled')).not.toContain(sent.threadId);
    expect(await ids(b, 'in:sent')).toContain(sent.threadId);
    const after = await b.getThread(sent.threadId);
    expect(after.scheduledFor).toBeUndefined();
    expect(after.messages[0]!.date).toBe(sendAt);
  });

  it('the fixture scheduled update fires tomorrow morning', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now, liveMail: false });
    const { scheduledFor } = await b.getThread('x-scheduled-weekly');
    expect(scheduledFor).toBe(new Date(2026, 9, 9, 8, 30).getTime());
    c.set(scheduledFor!);
    expect(await count(b, 'in:scheduled')).toBe(0);
    expect((await ids(b, 'in:sent'))[0]).toBe('x-scheduled-weekly');
  });

  it('cancelScheduled turns it back into a draft that can be sent later', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now, liveMail: false });
    const { id, threadId } = await b.send(outgoing({ sendAt: NOW + DAY }));
    await b.cancelScheduled!(threadId);
    c.advance(2 * DAY);
    expect(await ids(b, 'in:sent')).not.toContain(threadId);
    expect(await ids(b, 'in:drafts')).toContain(threadId);
    const t = await b.getThread(threadId);
    expect(t.draftCount).toBe(1);
    await b.send(outgoing({ draftId: draftIdFor(id) }));
    expect(await ids(b, 'in:drafts')).not.toContain(threadId);
    expect(await ids(b, 'in:sent')).toContain(threadId);
    await expect(b.cancelScheduled!(threadId)).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('mutations keep counts and search consistent', () => {
  it('after a realistic burst of triage', async () => {
    const b = demo();
    await expectCountsMatchSearch(b);
    const before = await b.listLabels();
    const unreadInbox = (await ids(b, 'in:inbox is:unread')).slice(0, 4);

    // Archive two unread threads, read one, trash one.
    await b.modifyThreads(unreadInbox.slice(0, 2), { remove: ['INBOX'] });
    await b.modifyThreads([unreadInbox[2]!], { remove: ['UNREAD'] });
    await b.trashThreads([unreadInbox[3]!]);
    const after = await b.listLabels();
    expect(label(after, 'INBOX').unreadCount).toBe(label(before, 'INBOX').unreadCount! - 4);
    expect(label(after, 'INBOX').totalCount).toBe(label(before, 'INBOX').totalCount! - 3);
    expect(label(after, 'TRASH').totalCount).toBe(label(before, 'TRASH').totalCount! + 1);
    expect(label(after, 'UNREAD').unreadCount).toBe(label(before, 'UNREAD').unreadCount! - 2);
    await expectCountsMatchSearch(b);

    // Untrash restores it to the inbox, unread.
    await b.untrashThreads([unreadInbox[3]!]);
    expect(await ids(b, 'in:inbox is:unread')).toContain(unreadInbox[3]);

    // Star, label, mark spam, mute.
    await b.modifyThreads(['t-greta', 'f-bike-lane'], { add: ['STARRED', L.travel] });
    await b.modifyThreads(['p-stride-1'], { add: ['SPAM'], remove: ['INBOX'] });
    await b.muteThreads(['t-book-club'], true);
    expect(await ids(b, 'is:muted')).toEqual(['t-book-club']);
    expect(await ids(b, 'in:inbox')).not.toContain('t-book-club');
    expect((await b.getThread('t-book-club')).labelIds).toContain('MUTED');
    await expectCountsMatchSearch(b);
    expect(label(await b.listLabels(), L.travel).totalCount).toBe(label(before, L.travel).totalCount! + 2);
  });

  it('rejects unknown threads and labels before changing anything', async () => {
    const b = demo();
    const inbox = await count(b, 'in:inbox');
    await expect(b.modifyThreads(['t-greta', 'nope'], { remove: ['INBOX'] })).rejects.toMatchObject({ code: 'not-found' });
    await expect(b.modifyThreads(['t-greta'], { add: ['Label_404'] })).rejects.toMatchObject({ code: 'not-found' });
    await expect(b.modifyThreads(['t-greta'], { add: ['SENT'] })).rejects.toMatchObject({ code: 'unsupported' });
    expect(await count(b, 'in:inbox')).toBe(inbox);
  });

  it('deleteThreadsForever removes the thread and its attachments', async () => {
    const b = demo();
    const t = await b.getThread('t-lease-renewal');
    const att = t.messages[0]!.attachments[0]!;
    await b.deleteThreadsForever(['t-lease-renewal']);
    await expect(b.getThread('t-lease-renewal')).rejects.toMatchObject({ code: 'not-found' });
    await expect(b.getAttachment(att.messageId, att.id)).rejects.toMatchObject({ code: 'not-found' });
    expect(await ids(b, 'in:anywhere lease')).not.toContain('t-lease-renewal');
  });
});

describe('paging', () => {
  it('walks every result exactly once, in order, with an opaque token', async () => {
    const b = demo();
    const all = await ids(b, 'in:anywhere');
    expect(all.length).toBeGreaterThan(130);
    const seen: string[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const page = await b.listThreads({ q: 'in:anywhere', pageSize: 7, ...(token ? { pageToken: token } : {}) });
      expect(page.resultSizeEstimate).toBe(all.length);
      expect(page.threads.length).toBeLessThanOrEqual(7);
      seen.push(...page.threads.map((t) => t.id));
      token = page.nextPageToken;
      if (token) expect(token).not.toMatch(/\d{13}/); // no raw timestamps leaking out
      pages++;
    } while (token && pages < 100);
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('defaults to 50 per page and stays stable when earlier items change', async () => {
    const b = demo();
    const first = await b.listThreads({ q: 'in:inbox' });
    expect(first.threads).toHaveLength(50);
    // Archive something from page one, then ask for page two.
    await b.modifyThreads([first.threads[3]!.id], { remove: ['INBOX'] });
    const second = await b.listThreads({ q: 'in:inbox', pageToken: first.nextPageToken! });
    const after = await ids(b, 'in:inbox');
    const firstIds = first.threads.map((t) => t.id).filter((id) => id !== first.threads[3]!.id);
    expect([...firstIds, ...second.threads.map((t) => t.id)]).toEqual(after.slice(0, firstIds.length + second.threads.length));
  });

  it('newest first, with lastDate of the newest delivered message', async () => {
    const b = demo();
    const page = await b.listThreads({ q: 'in:inbox', pageSize: 500 });
    for (let i = 1; i < page.threads.length; i++) {
      expect(page.threads[i - 1]!.lastDate).toBeGreaterThanOrEqual(page.threads[i]!.lastDate);
    }
    expect(page.threads[0]!.lastDate).toBe(NOW - 12 * MIN);
  });

  it('rejects a garbage token', async () => {
    await expect(demo().listThreads({ q: '', pageToken: 'not-a-token' })).rejects.toBeInstanceOf(BackendError);
  });
});

describe('sending and drafts', () => {
  it('a reply joins the thread with threading headers and does not pull it into the inbox', async () => {
    const b = demo();
    const before = await b.getThread('t-dad-insurance');
    await b.modifyThreads([before.id], { remove: ['INBOX'] }); // archived before replying
    const last = before.messages[before.messages.length - 1]!;
    const res = await b.send(
      outgoing({ threadId: before.id, to: [last.from], subject: `Re: ${before.subject}`, html: '<div>Done, sent you the quotes.</div>' }),
    );
    const t = await b.getThread(before.id);
    expect(res.threadId).toBe(before.id);
    expect(t.messageCount).toBe(before.messageCount + 1);
    const mine = t.messages[t.messages.length - 1]!;
    expect(mine.headers.inReplyTo).toBe(last.headers.messageId);
    expect(mine.headers.references).toContain(last.headers.messageId!);
    expect(mine.labelIds).toEqual(['SENT']);
    expect(t.snippet).toBe('Done, sent you the quotes.');
    expect(await ids(b, 'in:inbox')).not.toContain(before.id);
    expect((await ids(b, 'in:sent'))[0]).toBe(before.id);
  });

  it('mail to yourself lands in the inbox and attachments round-trip', async () => {
    const b = demo();
    const data = btoa('hello from the test');
    const { id, threadId } = await b.send(
      outgoing({ to: [{ email: ME }], attachments: [{ id: 'up1', filename: 'note.txt', mimeType: 'text/plain', size: 19, data }] }),
    );
    expect((await ids(b, 'in:inbox'))[0]).toBe(threadId);
    const t = await b.getThread(threadId);
    const att = t.messages[0]!.attachments[0]!;
    expect(att.size).toBe(19);
    expect(await b.getAttachment(id, att.id)).toEqual({ data, mimeType: 'text/plain' });
    expect(await ids(b, 'filename:note.txt')).toEqual([threadId]);
  });

  it('drafts are created, updated in place, and deleted', async () => {
    const b = demo();
    const drafts = await count(b, 'in:drafts');
    const d = await b.saveDraft(outgoing({ subject: 'half an idea' }));
    expect(d.id).toBe(draftIdFor(d.message.id));
    expect(await count(b, 'in:drafts')).toBe(drafts + 1);
    const d2 = await b.saveDraft(outgoing({ draftId: d.id, subject: 'a whole idea', html: '<div>here it is</div>' }));
    expect(d2.id).toBe(d.id);
    expect(await count(b, 'in:drafts')).toBe(drafts + 1);
    expect(await ids(b, 'in:drafts subject:"whole idea"')).toEqual([d.message.threadId]);
    expect(label(await b.listLabels(), 'DRAFT').totalCount).toBe(drafts + 1);
    await b.deleteDraft(d.id);
    expect(await count(b, 'in:drafts')).toBe(drafts);
    await expect(b.getThread(d.message.threadId)).rejects.toMatchObject({ code: 'not-found' });
    await expect(b.deleteDraft(d.id)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('the fixture reply draft is addressable and sendable by its derived id', async () => {
    const b = demo();
    const t = await b.getThread('t-research-readout');
    expect(t.draftCount).toBe(1);
    expect(t.messageCount).toBe(1);
    const draft = t.messages.find((m) => m.isDraft)!;
    await b.send(outgoing({ draftId: draftIdFor(draft.id), threadId: t.id, to: [t.messages[0]!.from], subject: `Re: ${t.subject}` }));
    const after = await b.getThread(t.id);
    expect(after.draftCount).toBe(0);
    expect(after.messageCount).toBe(2);
  });

  it('a draft is also addressable by the message id a thread shows it under', async () => {
    const b = demo();
    const t = await b.getThread('t-research-readout');
    const draft = t.messages.find((m) => m.isDraft)!;
    const saved = await b.saveDraft(outgoing({ draftId: draft.id, threadId: t.id, to: [t.messages[0]!.from], subject: `Re: ${t.subject}`, html: '<div>edited</div>' }));
    expect(saved.id).toBe(draftIdFor(draft.id));
    await b.send(outgoing({ draftId: draft.id, threadId: t.id, to: [t.messages[0]!.from], subject: `Re: ${t.subject}` }));
    expect((await b.getThread(t.id)).draftCount).toBe(0);
  });

  it('gives a message source with its headers and body', async () => {
    const b = demo();
    const t = await b.getThread('t-research-readout');
    const m = t.messages.find((x) => !x.isDraft)!;
    const raw = await b.getRawMessage!(m.id);
    expect(raw).toContain(`From: "${m.from.name}" <${m.from.email}>`);
    expect(raw).toContain(`Subject: ${m.subject}`);
    expect(raw).toMatch(/\r\n\r\n/);
  });

  it('refuses to send without recipients', async () => {
    await expect(demo().send(outgoing({ to: [] }))).rejects.toBeInstanceOf(BackendError);
  });
});

describe('labels and filters', () => {
  it('renaming a parent renames its children, and search follows', async () => {
    const b = demo();
    const reviews = await ids(b, 'label:"Work/Design reviews"');
    await b.updateLabel(L.work, { name: 'Job' });
    const names = (await b.listLabels()).filter((l) => l.type === 'user').map((l) => l.name);
    expect(names).toContain('Job/Design reviews');
    expect(names).not.toContain('Work');
    expect(await ids(b, 'label:job-design-reviews')).toEqual(reviews);
    expect(await ids(b, 'label:work')).toEqual([]);
    expect(await b.pollChanges()).toContainEqual({ type: 'labels' });
  });

  it('create, color, hide, delete; duplicates and system labels are refused', async () => {
    const b = demo();
    const created = await b.createLabel({ name: 'Work / Hiring', color: { background: '#fad165', text: '#000000' } });
    expect(created.name).toBe('Work/Hiring');
    await expect(b.createLabel({ name: 'work/hiring' })).rejects.toBeInstanceOf(BackendError);
    await expect(b.createLabel({ name: 'Inbox' })).rejects.toBeInstanceOf(BackendError);
    await b.modifyThreads(['t-intern-mentor'], { add: [created.id] });
    expect(await ids(b, 'label:work-hiring')).toEqual(['t-intern-mentor']);
    const hidden = await b.updateLabel(created.id, { hidden: true });
    expect(hidden.hidden).toBe(true);
    await b.deleteLabel(created.id);
    expect((await b.getThread('t-intern-mentor')).labelIds).not.toContain(created.id);
    await expect(b.updateLabel('INBOX', { name: 'Box' })).rejects.toMatchObject({ code: 'unsupported' });
    await expect(b.deleteLabel('Label_404')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('the hidden label is listed as hidden', async () => {
    const taxes = label(await demo().listLabels(), L.taxes);
    expect(taxes.hidden).toBe(true);
    expect(taxes.totalCount).toBe(1);
  });

  it('filters are stored, validated, and applied to new incoming mail', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now, seed: 1 });
    expect(await b.listFilters!()).toHaveLength(2);
    await expect(b.createFilter!({ criteria: {}, action: { addLabelIds: [L.work] } })).rejects.toBeInstanceOf(BackendError);
    const f = await b.createFilter!({ criteria: { from: 'hannah.k@example.com' }, action: { addLabelIds: ['STARRED', L.sideProject] } });
    // Let the whole rotating set arrive once.
    for (let i = 0; i < 10; i++) {
      c.advance(LIVE_MAIL_INTERVAL_MS);
      await b.pollChanges();
    }
    const fromHannah = await ids(b, 'subject:"quick sync tomorrow"');
    expect(fromHannah).toHaveLength(1);
    const t = await b.getThread(fromHannah[0]!);
    expect(t.labelIds).toEqual(expect.arrayContaining(['STARRED', L.sideProject, 'INBOX', 'UNREAD']));
    await b.deleteFilter!(f.id);
    expect(await b.listFilters!()).toHaveLength(2);
  });
});

describe('live mail and the change feed', () => {
  it('delivers one message per interval and reports it once', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now });
    expect(await b.pollChanges()).toEqual([]);
    const inboxUnread = label(await b.listLabels(), 'INBOX').unreadCount!;
    c.advance(LIVE_MAIL_INTERVAL_MS - 1);
    expect(await b.pollChanges()).toEqual([]);
    c.advance(1);
    const changes = await b.pollChanges();
    expect(changes).toHaveLength(2);
    const changed = changes[0]!.type === 'threads' ? changes[0]!.threadIds : [];
    expect(changed).toHaveLength(1);
    expect(await b.pollChanges()).toEqual([]);
    const t = await b.getThread(changed[0]!);
    expect(t.labelIds).toEqual(expect.arrayContaining(['UNREAD']));
    expect(t.lastDate).toBe(NOW + LIVE_MAIL_INTERVAL_MS);
    expect(label(await b.listLabels(), 'INBOX').unreadCount).toBeGreaterThanOrEqual(inboxUnread);
  });

  it('a big clock jump delivers a few, not a flood', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now });
    const before = await count(b, 'in:anywhere');
    c.advance(7 * DAY);
    await b.pollChanges();
    // Snoozes and the scheduled send also fire on a week jump; live mail adds at most three items.
    expect((await count(b, 'in:anywhere')) - before).toBeLessThanOrEqual(3);
  });

  it('replies into muted threads stay out of the inbox', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now });
    const targets = ['t-onboarding-v4', 't-no-subject', 'f-a11y-dialogs', 't-climbing'];
    const counts = await Promise.all(targets.map(async (id) => (await b.getThread(id)).messageCount));
    await b.muteThreads(targets, true);
    for (let i = 0; i < 10; i++) {
      c.advance(LIVE_MAIL_INTERVAL_MS);
      await b.pollChanges();
    }
    for (const [k, id] of targets.entries()) {
      const t = await b.getThread(id);
      expect(t.messageCount).toBe(counts[k]! + 1);
      const reply = t.messages[t.messages.length - 1]!;
      expect(reply.labelIds).toContain('UNREAD');
      expect(reply.labelIds).not.toContain('INBOX');
      expect(reply.headers.inReplyTo).toBe(t.messages[t.messages.length - 2]!.headers.messageId);
    }
    const inbox = await ids(b, 'in:inbox');
    for (const id of targets) expect(inbox).not.toContain(id);
  });

  it('can be turned off', async () => {
    const c = clock();
    const b = createDemoBackend({ now: c.now, liveMail: false });
    c.advance(10 * LIVE_MAIL_INTERVAL_MS);
    expect(await b.pollChanges()).toEqual([]);
  });
});

describe('account, contacts, unsubscribe, chaos', () => {
  it('account is the fictional demo user with an illustrated avatar', async () => {
    const a = await demo().getAccount();
    expect(a.email).toBe(ME);
    expect(a.name).toBe('Alex Rivera');
    expect(a.photoUrl).toMatch(/^data:image\/svg\+xml/);
    expect(a.index).toBe(0);
    expect(a.sendAs!.map((s) => s.email)).toContain(ME);
    expect(a.signature).toContain('Alex Rivera');
    expect(DEMO_NOTICE).toMatch(/fictional/i);
  });

  it('contacts match name words and email prefixes, most frequent first, never yourself', async () => {
    const b = demo();
    const pri = await b.searchContacts('pri');
    expect(pri[0]!.email).toBe('priya.natarajan@example.com');
    expect(pri[0]!.photoUrl).toMatch(/^data:image\/svg/);
    const na = (await b.searchContacts('na')).map((x) => x.email);
    expect(na).toEqual(expect.arrayContaining(['priya.natarajan@example.com', 'nadia.rahman@example.org']));
    expect(await b.searchContacts('alex.rivera')).toEqual([]);
    expect((await b.searchContacts('mül')).map((x) => x.email)).toEqual(['greta.mueller@example.org']);
    expect(await b.searchContacts('')).toHaveLength(8);
  });

  it('unsubscribe reports how each sender supports it', async () => {
    const b = demo();
    const first = async (id: string) => (await b.getThread(id)).messages[0]!.id;
    expect(await b.unsubscribe!(await first('p-margin-142'))).toBe('one-click');
    expect(await b.unsubscribe!(await first('p-patch-218'))).toBe('mailto');
    expect(await b.unsubscribe!(await first('p-farewise-1'))).toBe('link');
    await expect(b.unsubscribe!(await first('t-greta'))).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('failRate throws retryable network errors, deterministically per seed', async () => {
    const always = createDemoBackend({ now: () => NOW, failRate: 1, liveMail: false });
    await expect(always.listLabels()).rejects.toMatchObject({ code: 'network', retryable: true });
    const run = async (seed: number) => {
      const b = createDemoBackend({ now: () => NOW, failRate: 0.5, seed, liveMail: false });
      const out: boolean[] = [];
      for (let i = 0; i < 20; i++) out.push(await b.listLabels().then(() => true, () => false));
      return out;
    };
    const a = await run(3);
    expect(await run(3)).toEqual(a);
    expect(a.filter(Boolean).length).toBeGreaterThan(3);
    expect(a.filter((x) => !x).length).toBeGreaterThan(3);
  });

  it('latency is simulated', async () => {
    const b = createDemoBackend({ now: () => NOW, latencyMs: 40, liveMail: false });
    const t0 = performance.now();
    await b.listLabels();
    expect(performance.now() - t0).toBeGreaterThanOrEqual(20);
  });

  it('returned objects are copies', async () => {
    const b = demo();
    const t = await b.getThread('t-greta');
    t.messages[0]!.labelIds.push('STARRED');
    t.subject = 'changed';
    const again = await b.getThread('t-greta');
    expect(again.labelIds).not.toContain('STARRED');
    expect(again.subject).not.toBe('changed');
  });
});

describe('determinism and relative dates', () => {
  it('same seed and clock give identical mailboxes', async () => {
    const a = await demo().listThreads({ q: 'in:anywhere', pageSize: 500 });
    const b = await demo().listThreads({ q: 'in:anywhere', pageSize: 500 });
    expect(b).toEqual(a);
  });

  it('dates move with the clock, so the mailbox always looks current', async () => {
    const later = NOW + 200 * DAY;
    const b = createDemoBackend({ now: () => later, liveMail: false });
    const t = await b.getThread('t-onboarding-v4');
    expect(t.lastDate).toBe(later - 25 * MIN);
    expect(await ids(b, 'older_than:1y')).toEqual(await ids(demo(), 'older_than:1y'));
  });

  it('a different seed keeps the same threads', async () => {
    const a = await demo({ seed: 1 }).listThreads({ q: 'in:anywhere', pageSize: 500 });
    const b = await demo({ seed: 2 }).listThreads({ q: 'in:anywhere', pageSize: 500 });
    expect(sorted(b.threads.map((t) => t.id))).toEqual(sorted(a.threads.map((t) => t.id)));
  });
});

describe('empty account', () => {
  it('has only a welcome message and system labels', async () => {
    const b = createDemoBackend({ now: () => NOW, empty: true, liveMail: false });
    expect(await ids(b, 'in:anywhere')).toEqual(['t-welcome']);
    const labels = await b.listLabels();
    expect(labels.filter((l) => l.type === 'user')).toEqual([]);
    expect(label(labels, 'INBOX')).toMatchObject({ unreadCount: 1, totalCount: 1 });
    expect(await b.listFilters!()).toEqual([]);
    expect((await b.searchContacts('')).map((c) => c.email)).toEqual(['welcome@demo.example']);
    expect((await b.getAccount()).email).toBe(ME);
  });

  it('works like a real mailbox from there', async () => {
    const b = createDemoBackend({ now: () => NOW, empty: true, liveMail: false });
    const l = await b.createLabel({ name: 'Ideas' });
    const { threadId } = await b.send(outgoing({ to: [{ email: ME, name: 'Alex Rivera' }], subject: 'note to self' }));
    await b.modifyThreads([threadId], { add: [l.id] });
    expect(await ids(b, 'label:ideas')).toEqual([threadId]);
    expect(await ids(b, 'in:inbox')).toEqual([threadId, 't-welcome']);
    expect(await ids(b, 'in:sent')).toEqual([threadId]);
  });
});
