import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError, type MailBackend } from '../../src/app/data/backend';
import { keys, queryClient } from '../../src/app/data/client';
import { onMailArrived, startSync, type SyncEnv } from '../../src/app/data/sync';
import type { MailChange, Thread, ThreadSummary } from '../../src/app/data/types';
import { hiddenDelay, startMailWatcher, type WatcherEnv } from '../../src/app/smart/mailWatcher';
import {
  clearTracking,
  recordForThread,
  restoreRecord,
  setPackageStatus,
  startTracking,
  trackedByHand,
  trackOrder,
  untrackEmail,
  useTracking,
} from '../../src/app/smart/trackingStore';

const MINUTE = 60_000;

const summary = (id: string, from = 'ana@example.com'): ThreadSummary => ({
  id,
  subject: `Subject ${id}`,
  snippet: '',
  labelIds: ['INBOX', 'UNREAD'],
  participants: [{ email: from }],
  messageCount: 1,
  draftCount: 0,
  lastDate: Date.now(),
  hasAttachments: false,
  attachments: [],
});

/** One tab: its visibility, its sync arrivals, whether it holds the notifier lock, and a shared channel. */
function tab(opts: { visible: boolean; locks?: boolean; inbox?: () => ThreadSummary[]; fail?: () => unknown }) {
  let visible = opts.visible;
  const arrived = new Set<() => void>();
  const shown = new Set<() => void>();
  const heard = new Set<() => void>();
  let grant: ((l: boolean) => void) | undefined;
  const calls: string[] = [];
  const notified: string[] = [];
  const env: WatcherEnv = {
    now: () => Date.now(),
    visible: () => visible,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    onVisibility: (fn) => (shown.add(fn), () => shown.delete(fn)),
    onMailArrived: (fn) => (arrived.add(fn), () => arrived.delete(fn)),
    channel: { post: () => undefined, listen: (fn) => (heard.add(fn), () => heard.delete(fn)) },
    lead: opts.locks === false ? null : (fn) => ((grant = fn), () => (grant = undefined)),
    list: async (q) => {
      calls.push(q);
      const err = opts.fail?.();
      if (err) throw err;
      return q.includes('is:unread') ? (opts.inbox?.() ?? []) : [];
    },
    spam: async () => undefined,
    notify: async (t) => void notified.push(t.id),
    paused: () => false,
  };
  return {
    env,
    calls,
    notified,
    lead: () => grant?.(true),
    arrive: () => arrived.forEach((f) => f()),
    hearOtherTab: () => heard.forEach((f) => f()),
    setVisible(v: boolean) {
      visible = v;
      shown.forEach((f) => f());
    },
  };
}

describe('mail watcher', () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 14, 9) }));
  afterEach(() => vi.useRealTimers());

  it('asks for nothing from a hidden tab that is not the notifier, however long it sits', async () => {
    const t = tab({ visible: false });
    startMailWatcher(t.env, { notifications: true, blocked: ['spam@example.com'] });
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(t.calls).toEqual([]);
  });

  it('never polls a visible tab on a timer; it acts when the sync loop reports new mail', async () => {
    const t = tab({ visible: true, locks: false });
    startMailWatcher(t.env, { notifications: true, blocked: ['spam@example.com'] });
    await vi.advanceTimersByTimeAsync(2_000);
    const atStart = t.calls.length;
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    expect(t.calls.length).toBe(atStart);
    t.arrive();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls.slice(atStart)).toEqual(['in:inbox from:(spam@example.com)', 'in:inbox is:unread newer_than:1d']);
  });

  it('lets the hidden leader keep notifying, never twice for one email and never for a blocked sender', async () => {
    let inbox = [summary('old')];
    const t = tab({ visible: false, inbox: () => inbox });
    startMailWatcher(t.env, { notifications: true, blocked: ['spam@example.com'] });
    t.lead();
    await vi.advanceTimersByTimeAsync(0);
    // The first look only learns what's there.
    expect(t.notified).toEqual([]);
    inbox = [summary('new'), summary('junk', 'SPAM@example.com'), summary('old')];
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(t.notified).toEqual(['new']);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(t.notified).toEqual(['new']);
  });

  it('leaves the checking to a visible tab that is syncing', async () => {
    const t = tab({ visible: false });
    startMailWatcher(t.env, { notifications: true, blocked: [] });
    t.lead();
    await vi.advanceTimersByTimeAsync(0);
    const seeded = t.calls.length;
    // Another tab reports mail every half minute; the leader checks because of those, not its own timer.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      t.hearOtherTab();
    }
    await vi.advanceTimersByTimeAsync(0);
    // Six reports in three minutes, one check per 15 s gap at most, and no timer polls on top.
    expect(t.calls.length - seeded).toBe(6);
  });

  it('backs off the hidden leader when Google rate-limits it', async () => {
    const t = tab({ visible: false, fail: () => new BackendError('slow down', 'rate-limited', true) });
    startMailWatcher(t.env, { notifications: true, blocked: [] });
    t.lead();
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    // Once a minute would be 31; from the five minute floor it's the first look and six more.
    expect(t.calls.length).toBeLessThanOrEqual(7);
    expect(hiddenDelay(0, true)).toBe(5 * MINUTE);
    expect(hiddenDelay(9, false)).toBe(10 * MINUTE);
  });

  it('stops asking once stopped', async () => {
    const t = tab({ visible: false });
    const w = startMailWatcher(t.env, { notifications: true, blocked: [] });
    t.lead();
    await vi.advanceTimersByTimeAsync(0);
    w.stop();
    const n = t.calls.length;
    await vi.advanceTimersByTimeAsync(30 * MINUTE);
    t.arrive();
    expect(t.calls.length).toBe(n);
  });
});

describe('sync arrivals', () => {
  it('reports new mail only when a poll brings a thread no cached list knows', async () => {
    let changes: MailChange[] = [];
    const backend = { pollChanges: async () => changes } as unknown as MailBackend;
    const client = new QueryClient();
    client.setQueryData(keys.threads('in:inbox', { kind: 'folder', folder: 'inbox' }), { pages: [{ threads: [summary('known')] }], pageParams: [] });
    const env: SyncEnv = {
      now: () => Date.now(),
      visible: () => true,
      online: () => true,
      setTimer: () => 0,
      clearTimer: () => undefined,
      random: () => 0.5,
      onWake: () => () => undefined,
    };
    const loop = startSync(() => backend, client, 20_000, env);
    const heard = vi.fn();
    const off = onMailArrived(heard);
    changes = [{ type: 'threads', threadIds: ['known'] }];
    await loop.tick();
    expect(heard).not.toHaveBeenCalled();
    changes = [{ type: 'threads', threadIds: ['brand-new'] }];
    await loop.tick();
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    loop.stop();
  });
});

describe('package tracking switched off', () => {
  const shipping = (id: string): Thread => ({
    ...summary(id),
    labelIds: ['INBOX', 'CATEGORY_UPDATES'],
    messages: [
      {
        id: `${id}-m`,
        threadId: id,
        labelIds: ['INBOX'],
        from: { name: 'Swiftlane', email: 'updates@swiftlane.example' },
        to: [],
        cc: [],
        bcc: [],
        date: Date.now(),
        subject: 'Your package is on its way',
        snippet: 'Your package is on its way',
        bodyText: `Your package is on its way.\nTracking number: SL 7702 4418 90${id.length}`,
        attachments: [],
        headers: {},
      },
    ],
  });

  it('stops reading mail and forgets every record', async () => {
    startTracking();
    queryClient.setQueryData(keys.thread('a1'), shipping('a1'));
    expect(Object.keys(useTracking.getState().records)).toHaveLength(1);

    clearTracking();
    expect(useTracking.getState().records).toEqual({});
    queryClient.setQueryData(keys.thread('b22'), shipping('b22'));
    await new Promise((r) => setTimeout(r, 450));
    expect(useTracking.getState().records).toEqual({});
    expect(localStorage.getItem('bg.tracking.v1')).toBeNull();
  });
});

describe('tracking an email by hand', () => {
  beforeEach(() => {
    clearTracking();
    startTracking();
  });

  it('files it by tracking number, sets its status, undoes, and stops tracking', () => {
    const key = trackOrder({ id: 'r1', date: Date.now(), status: 'ordered' }, { merchant: 'Larkspur Market', orderNo: 'LM-4471902', tracking: 'SL 1234 5678 9', carrier: 'Swiftlane' });
    expect(key).toBe('T:SL123456789');
    const record = recordForThread('r1')!;
    expect(record).toMatchObject({ merchant: 'Larkspur Market', carrier: 'Swiftlane', userAdded: true });
    expect(trackedByHand(record, 'r1')).toBe(true);

    const { before } = setPackageStatus(key, 'delivered', { threadId: 'r1', info: { status: 'ordered' }, at: Date.now() });
    expect(useTracking.getState().records[key]!.manual?.status).toBe('delivered');
    restoreRecord(key, before);
    expect(useTracking.getState().records[key]!.manual).toBeUndefined();

    untrackEmail('r1');
    expect(recordForThread('r1')).toBeUndefined();
  });

  it('keys an email with no numbers by the email itself', () => {
    expect(trackOrder({ id: 'r2', date: Date.now(), status: 'ordered' }, { merchant: 'Hollowpine', orderNo: '', tracking: '', carrier: '' })).toBe('M:r2');
  });
});
