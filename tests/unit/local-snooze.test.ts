import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { MailBackend } from '../../src/app/data/backend';
import { createDemoBackend } from '../../src/app/data/demo';
import { withLocalSnooze } from '../../src/app/data/localSnooze';
import { BackendError } from '../../src/app/data/backend';
import { readKey, writeKey } from '../../src/app/state/storage';

/** Thursday, October 8 2026, 10:00 local. */
const NOW = new Date(2026, 9, 8, 10, 0).getTime();
const HOUR = 3_600_000;

/** The demo backend as a backend without native snooze; every call still runs against the real demo instance. */
function demoWithoutSnooze(): MailBackend {
  const demo = createDemoBackend({ now: () => Date.now(), liveMail: false });
  const capabilities = { ...demo.capabilities, snooze: false };
  return new Proxy(demo, {
    get(target, prop) {
      if (prop === 'capabilities') return capabilities;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function ids(b: MailBackend, q: string) {
  return (await b.listThreads({ q, pageSize: 500 })).threads.map((t) => t.id);
}

/** Lets the wake-up that runs on construction finish. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('withLocalSnooze', () => {
  let inner: MailBackend;
  let backend: MailBackend;
  let id: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    fakeBrowser.reset();
    localStorage.clear();
    inner = demoWithoutSnooze();
    backend = withLocalSnooze(inner);
    await settle();
    [id] = await ids(inner, 'in:inbox');
    expect(id).toBeDefined();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a backend with native snooze is used as is', () => {
    const native = createDemoBackend({ now: () => NOW, liveMail: false });
    expect(withLocalSnooze(native)).toBe(native);
  });

  it('snoozing archives the thread and lists it under in:snoozed with its wake time', async () => {
    const until = NOW + 5 * HOUR;
    await backend.snoozeThreads([id], until);

    expect(await ids(backend, 'in:inbox')).not.toContain(id);
    const snoozed = (await backend.listThreads({ q: 'in:snoozed' })).threads.find((t) => t.id === id);
    expect(snoozed?.snoozedUntil).toBe(until);
    expect(snoozed?.labelIds).toContain('SNOOZED');
    expect(snoozed?.labelIds).not.toContain('INBOX');

    const thread = await backend.getThread(id);
    expect(thread.snoozedUntil).toBe(until);
    expect(thread.messages.length).toBeGreaterThan(0);
  });

  it('in:snoozed lists local snoozes soonest first and reports the combined count', async () => {
    const [a, b] = (await ids(inner, 'in:inbox')).slice(1, 3);
    await backend.snoozeThreads([a], NOW + 9 * HOUR);
    await backend.snoozeThreads([id, b], NOW + 2 * HOUR);
    const page = await backend.listThreads({ q: 'in:snoozed' });
    const mine = page.threads.filter((t) => [id, a, b].includes(t.id)).map((t) => t.id);
    expect(mine.slice(-1)).toEqual([a]);
    expect(page.resultSizeEstimate).toBe(page.threads.length);
  });

  it('other queries mark stored threads as snoozed', async () => {
    const until = NOW + 3 * HOUR;
    await backend.snoozeThreads([id], until);
    const row = (await backend.listThreads({ q: 'in:all', pageSize: 500 })).threads.find((t) => t.id === id);
    expect(row?.snoozedUntil).toBe(until);
    expect(row?.labelIds).toContain('SNOOZED');

    const other = (await backend.listThreads({ q: 'in:all', pageSize: 500 })).threads.find((t) => t.id !== id);
    expect(other?.snoozedUntil).toBeUndefined();
  });

  it('unsnoozing puts the thread back in the inbox and out of in:snoozed', async () => {
    await backend.snoozeThreads([id], NOW + HOUR);
    await backend.unsnoozeThreads([id]);
    expect(await ids(backend, 'in:inbox')).toContain(id);
    expect(await ids(backend, 'in:snoozed')).not.toContain(id);
    expect((await backend.getThread(id)).snoozedUntil).toBeUndefined();
  });

  it('after the wake time, pollChanges returns the thread to the inbox unread and reports it once', async () => {
    await inner.modifyThreads([id], { remove: ['UNREAD'] });
    await backend.snoozeThreads([id], NOW + HOUR);
    await backend.pollChanges();

    vi.setSystemTime(NOW + HOUR - 1);
    const early = await backend.pollChanges();
    expect(early.flatMap((c) => (c.type === 'threads' ? c.threadIds : []))).not.toContain(id);
    expect(await ids(backend, 'in:inbox')).not.toContain(id);

    vi.setSystemTime(NOW + HOUR);
    const changes = await backend.pollChanges();
    expect(changes.flatMap((c) => (c.type === 'threads' ? c.threadIds : []))).toContain(id);
    expect(await ids(backend, 'in:inbox')).toContain(id);
    expect(await ids(backend, 'is:unread')).toContain(id);
    expect(await ids(backend, 'in:snoozed')).not.toContain(id);

    const again = await backend.pollChanges();
    expect(again.flatMap((c) => (c.type === 'threads' ? c.threadIds : []))).not.toContain(id);
  });

  it('the wake time survives a reload, and a reload after it wakes the thread without polling', async () => {
    await backend.snoozeThreads([id], NOW + HOUR);

    const reloaded = withLocalSnooze(inner);
    await settle();
    expect(await ids(reloaded, 'in:snoozed')).toContain(id);

    vi.setSystemTime(NOW + 2 * HOUR);
    withLocalSnooze(inner);
    await settle();
    expect(await ids(inner, 'in:inbox')).toContain(id);
  });

  it('trashing a snoozed thread takes it out of in:snoozed', async () => {
    await backend.snoozeThreads([id], NOW + HOUR);
    await backend.trashThreads([id]);
    expect(await ids(backend, 'in:snoozed')).not.toContain(id);
  });
});

describe('withLocalSnooze wake-ups', () => {
  /** A backend with no native snooze whose writes can be held, and whose missing threads fail like Gmail's. */
  function fake(email: string, missing: string[] = []) {
    const calls: { ids: string[]; change: unknown }[] = [];
    let hold: Promise<void> | undefined;
    const b = {
      kind: 'session',
      capabilities: { snooze: false },
      accountHint: async () => email,
      getAccount: async () => ({ email, name: email, index: 0 }),
      modifyThreads: vi.fn(async (ids: string[], change: unknown) => {
        if (ids.some((id) => missing.includes(id))) throw new BackendError('One of these conversations no longer exists.', 'not-found');
        calls.push({ ids, change });
        const held = hold;
        hold = undefined;
        if (held) await held;
      }),
      listThreads: async () => ({ threads: [] }),
      getThread: async (id: string) => {
        throw new BackendError(`${id} is gone`, 'not-found');
      },
      pollChanges: async () => [],
    } as unknown as MailBackend;
    return {
      b,
      calls,
      /** Holds the next write until released. */
      holdNextWrite() {
        let release!: () => void;
        hold = new Promise((r) => (release = r));
        return () => release();
      },
    };
  }

  const stored = (email: string) => readKey<Record<string, number>>(`bg.localSnooze.v1:${email}`);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    fakeBrowser.reset();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a snooze set while due threads are waking is kept', async () => {
    const f = fake('a@example.com');
    const backend = withLocalSnooze(f.b);
    await backend.snoozeThreads(['thread-f:1'], NOW + HOUR);
    vi.setSystemTime(NOW + 2 * HOUR);
    const release = f.holdNextWrite();
    const polling = backend.pollChanges();
    await settle();
    await backend.snoozeThreads(['thread-f:2'], NOW + 5 * HOUR);
    release();
    await polling;

    expect(Object.keys((await stored('a@example.com')) ?? {})).toEqual(['thread-f:2']);
  });

  it('two tabs on one account each keep the snoozes the other set', async () => {
    const tabA = withLocalSnooze(fake('a@example.com').b);
    const tabB = withLocalSnooze(fake('a@example.com').b);
    // Both tabs have read the list before either changes it.
    await tabA.listThreads({ q: 'in:inbox' });
    await tabB.listThreads({ q: 'in:inbox' });
    await tabA.snoozeThreads(['thread-f:1'], NOW + HOUR);
    await tabB.snoozeThreads(['thread-f:2'], NOW + 2 * HOUR);
    await tabA.unsnoozeThreads(['thread-f:3']);

    expect(await stored('a@example.com')).toEqual({ 'thread-f:1': NOW + HOUR, 'thread-f:2': NOW + 2 * HOUR });
    vi.setSystemTime(NOW + 3 * HOUR);
    const changes = await tabA.pollChanges();
    expect(changes.flatMap((c) => (c.type === 'threads' ? c.threadIds : []))).toEqual(['thread-f:1', 'thread-f:2']);
  });

  it('a deleted thread does not keep the others asleep', async () => {
    const f = fake('a@example.com', ['thread-f:gone']);
    const backend = withLocalSnooze(f.b);
    await backend.snoozeThreads(['thread-f:1'], NOW + HOUR);
    const store = { ...(await stored('a@example.com')), 'thread-f:gone': NOW + HOUR };
    await writeKey('bg.localSnooze.v1:a@example.com', store);
    const reloaded = withLocalSnooze(f.b);
    await settle();
    vi.setSystemTime(NOW + 2 * HOUR);
    const changes = await reloaded.pollChanges();

    expect(changes.flatMap((c) => (c.type === 'threads' ? c.threadIds : []))).toEqual(['thread-f:1']);
    expect(await stored('a@example.com')).toEqual({});
  });

  it('two accounts in this browser keep separate wake-up lists, whichever tab they are opened in', async () => {
    const a = fake('a@example.com');
    const b = fake('b@example.com');
    const homeA = withLocalSnooze(a.b);
    await homeA.snoozeThreads(['thread-f:1'], NOW + HOUR);

    vi.setSystemTime(NOW + 2 * HOUR);
    a.calls.length = 0;
    await withLocalSnooze(b.b).pollChanges();
    expect(b.calls.filter((c) => c.ids.includes('thread-f:1'))).toEqual([]);

    // The same account read from another account's tab finds the same list.
    await withLocalSnooze(fake('a@example.com').b, 'a@example.com').pollChanges();
    expect(await stored('a@example.com')).toEqual({});
  });
});
