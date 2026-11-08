import { cap } from '../../src/shared/bounded';
import { LOCAL_LIMITS, prune, type LocalData } from '../../src/app/state/local';
import { PHOTO_LIMITS, PhotoCache } from '../../src/app/data/photos';

const NOW = new Date(2026, 9, 14, 9, 0).getTime();
const DAY = 24 * 60 * 60_000;

describe('a tab left open, and years of use', () => {
  it('cap keeps the newest entries of a map or set', () => {
    const m = new Map(Array.from({ length: 10 }, (_, i) => [i, i]));
    expect([...cap(m, 3).keys()]).toEqual([7, 8, 9]);
    const s = new Set(['a', 'b']);
    expect(cap(s, 5)).toBe(s);
    expect(s.size).toBe(2);
  });

  it('local data drops long-past reminders and the oldest of what grows by itself, keeping what is still useful', () => {
    const rsvps = Object.fromEntries(Array.from({ length: LOCAL_LIMITS.rsvps + 50 }, (_, i) => [`uid-${i}`, 'ACCEPTED' as const]));
    const d: LocalData = {
      pinned: ['t1'],
      notes: { t1: { text: 'keep', updatedAt: NOW } },
      reminders: [
        { threadId: 'old', subject: '', due: NOW - 90 * DAY, messageCount: 1, createdAt: NOW - 100 * DAY },
        { threadId: 'soon', subject: '', due: NOW + DAY, messageCount: 1, createdAt: NOW },
      ],
      trustedImageSenders: Array.from({ length: LOCAL_LIMITS.trustedImageSenders + 10 }, (_, i) => `s${i}@example.com`),
      recentSearches: [],
      rsvps,
      blocked: [],
      dismissedNudges: [],
      safeMessages: [],
      doneTodos: [],
    };
    const out = prune(d, NOW);
    expect(out.reminders.map((r) => r.threadId)).toEqual(['soon']);
    expect(Object.keys(out.rsvps)).toHaveLength(LOCAL_LIMITS.rsvps);
    expect(out.rsvps['uid-549']).toBe('ACCEPTED');
    expect(out.rsvps['uid-0']).toBeUndefined();
    expect(out.trustedImageSenders.at(-1)).toBe(`s${LOCAL_LIMITS.trustedImageSenders + 9}@example.com`);
    expect(out.notes.t1?.text).toBe('keep');
  });

  it("the photo cache holds a bounded number of senders in memory, however many it's shown", async () => {
    const cache = new PhotoCache({
      lookup: () => async (emails) => Object.fromEntries(emails.map((e) => [e, `https://lh3.googleusercontent.com/a/${e}`])),
      read: async () => ({}),
      write: async () => undefined,
      imageWidth: async () => 0,
      now: () => NOW,
      batchDelayMs: 0,
      saveDelayMs: 1_000_000,
    });
    cache.setScope('session:me@gmail.com');
    for (let i = 0; i < PHOTO_LIMITS.inMemory * 2.5; i++) {
      cache.request(`person${i}@corp${i}.io`, `Person ${i}`);
      cache.peek(`person${i}@corp${i}.io`);
      if (i % 25 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    const sizes = Object.values(cache as unknown as Record<string, unknown>)
      .filter((v): v is Map<unknown, unknown> | Set<unknown> => v instanceof Map || v instanceof Set)
      .map((m) => m.size);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(PHOTO_LIMITS.inMemory + 256);
  });
});
