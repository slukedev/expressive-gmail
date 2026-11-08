import { BackendError, type BackendEvent, type MailBackend } from '../../src/app/data/backend';
import { createDemoBackend } from '../../src/app/data/demo';
import { connectRemoteBackend, emitEvent, exposeBackend } from '../../src/shared/rpc';

/** Thursday, October 8 2026, 10:00 local. */
const NOW = new Date(2026, 9, 8, 10, 0).getTime();

describe('rpc over a MessageChannel', () => {
  let channel: MessageChannel;
  let local: MailBackend;
  let stop: () => void;

  function connect(backend: MailBackend, onEvent?: (name: string, payload: unknown) => void) {
    local = backend;
    channel = new MessageChannel();
    const remote = connectRemoteBackend(channel.port2, onEvent);
    stop = exposeBackend(channel.port1, backend);
    return remote;
  }

  afterEach(() => {
    stop?.();
    channel?.port1.close();
    channel?.port2.close();
  });

  it('asks again when the first hello is lost, and gives up by its deadline when nobody serves', async () => {
    const backend = createDemoBackend({ now: () => NOW, liveMail: false });
    channel = new MessageChannel();
    // The serving side's hello goes out before anyone listens on the other end, and is dropped.
    const dropFirst = new MessageChannel();
    let dropped = false;
    dropFirst.port2.onmessage = (e) => {
      if (!dropped && e.data?.kind === 'rpc:event') {
        dropped = true;
        return;
      }
      channel.port1.postMessage(e.data);
    };
    channel.port1.onmessage = (e) => dropFirst.port2.postMessage(e.data);
    stop = exposeBackend(dropFirst.port1, backend);
    const remote = await connectRemoteBackend(channel.port2, undefined, { timeoutMs: 3_000 });
    expect(dropped).toBe(true);
    expect((await remote.listThreads({ q: 'in:inbox', pageSize: 1 })).threads).toHaveLength(1);
    dropFirst.port1.close();
    dropFirst.port2.close();

    const lonely = new MessageChannel();
    await expect(connectRemoteBackend(lonely.port2, undefined, { timeoutMs: 600 })).rejects.toThrow('never answered');
    lonely.port1.close();
    lonely.port2.close();
  });

  it('delivers kind and capabilities before the first call', async () => {
    const backend = createDemoBackend({ now: () => NOW, liveMail: false });
    const remote = await connect(backend);
    expect(remote.kind).toBe('demo');
    expect(remote.capabilities).toEqual(backend.capabilities);
  });

  it('round-trips calls with arguments, and writes made remotely are visible locally', async () => {
    const remote = await connect(createDemoBackend({ now: () => NOW, liveMail: false }));
    const [remotePage, localPage] = await Promise.all([remote.listThreads({ q: 'in:inbox', pageSize: 3 }), local.listThreads({ q: 'in:inbox', pageSize: 3 })]);
    expect(remotePage).toEqual(localPage);

    const id = remotePage.threads[0].id;
    await remote.modifyThreads([id], { add: ['STARRED'] });
    expect((await local.getThread(id)).labelIds).toContain('STARRED');
  });

  it('concurrent calls resolve to their own results', async () => {
    const remote = await connect(createDemoBackend({ now: () => NOW, liveMail: false }));
    const [inbox, sent, account] = await Promise.all([
      remote.listThreads({ q: 'in:inbox', pageSize: 2 }),
      remote.listThreads({ q: 'in:sent', pageSize: 2 }),
      remote.getAccount(),
    ]);
    expect(inbox.threads.every((t) => t.labelIds.includes('INBOX'))).toBe(true);
    expect(sent.threads.every((t) => t.labelIds.includes('SENT'))).toBe(true);
    expect(account.email).toBe((await local.getAccount()).email);
  });

  it('a thrown BackendError keeps its message, code and retryable flag', async () => {
    const remote = await connect(createDemoBackend({ now: () => NOW, liveMail: false, failRate: 1 }));
    const err = await remote.listLabels().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(err).toMatchObject({ code: 'network', retryable: true, message: 'The demo network dropped this request' });
  });

  it('a plain Error becomes an unknown BackendError', async () => {
    const demo = createDemoBackend({ now: () => NOW, liveMail: false });
    const broken = Object.assign(Object.create(demo), {
      getAccount: async () => {
        throw new TypeError('boom');
      },
    }) as MailBackend;
    const remote = await connect(broken);
    await expect(remote.getAccount()).rejects.toMatchObject({ name: 'BackendError', code: 'unknown', message: 'boom', retryable: false });
  });

  it('an optional method the backend does not have stays missing on the remote side', async () => {
    const demo = createDemoBackend({ now: () => NOW, liveMail: false });
    const partial = new Proxy(demo, {
      get: (target, prop) => (prop === 'listFilters' || prop === 'lookupPhotos' ? undefined : Reflect.get(target, prop, target)),
    });
    const remote = await connect(partial);
    expect(remote.listFilters).toBeUndefined();
    expect(remote.lookupPhotos).toBeUndefined();
    expect(await remote.accountHint!()).toBe(await demo.accountHint!());
  });

  it("the backend's own events reach remote subscribers, and stop when serving stops", async () => {
    const demo = createDemoBackend({ now: () => NOW, liveMail: false });
    let emit: ((e: BackendEvent) => void) | undefined;
    const withEvents = Object.assign(Object.create(demo), {
      subscribe: (fn: (e: BackendEvent) => void) => {
        emit = fn;
        return () => (emit = undefined);
      },
    }) as MailBackend;
    const remote = await connect(withEvents);
    const seen: BackendEvent[] = [];
    remote.subscribe!((e) => seen.push(e));
    emit!({ type: 'account' });
    await vi.waitFor(() => expect(seen).toEqual([{ type: 'account' }]));
    stop();
    expect(emit).toBeUndefined();
  });

  it('events other than hello reach the listener', async () => {
    const events: [string, unknown][] = [];
    await connect(createDemoBackend({ now: () => NOW, liveMail: false }), (name, payload) => events.push([name, payload]));
    emitEvent(channel.port1, 'changes', [{ type: 'labels' }]);
    await vi.waitFor(() => expect(events).toEqual([['changes', [{ type: 'labels' }]]]));
  });
});
