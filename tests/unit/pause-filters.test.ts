import { describe, expect, it } from 'vitest';
import { pauseActive, pausePresets } from '../../src/app/features/pause/pause';
import { filteredQuery } from '../../src/app/features/list/filters';

describe('pause inbox', () => {
  it('offers "Until 5 PM" only while there is more than 90 minutes left before it', () => {
    const morning = pausePresets(new Date(2026, 9, 9, 10, 0));
    expect(morning.map((p) => p.id)).toEqual(['1h', 'evening', 'morning', 'manual']);
    const late = pausePresets(new Date(2026, 9, 9, 15, 45));
    expect(late.map((p) => p.id)).toEqual(['1h', 'morning', 'manual']);
  });

  it('rolls "tomorrow morning" over a month end', () => {
    const lastDay = pausePresets(new Date(2026, 9, 31, 22, 0));
    const morning = new Date(lastDay.find((p) => p.id === 'morning')!.until!);
    expect([morning.getMonth(), morning.getDate(), morning.getHours()]).toEqual([10, 1, 8]);
  });

  it('treats a pause as over once its end passes, and a manual pause as open-ended', () => {
    const now = Date.UTC(2026, 9, 9, 12);
    expect(pauseActive({ since: now - 1000, until: now - 1 }, now)).toBe(false);
    expect(pauseActive({ since: now - 1000, until: now + 1 }, now)).toBe(true);
    expect(pauseActive({ since: now - 1000, until: null }, now)).toBe(true);
    expect(pauseActive(null, now)).toBe(false);
  });
});

describe('quick filters', () => {
  it('adds operators once, in a stable order, without repeating ones already in the query', () => {
    expect(filteredQuery('in:inbox', [])).toBe('in:inbox');
    expect(filteredQuery('in:inbox -category:social', ['attachment', 'unread'])).toBe('in:inbox -category:social is:unread has:attachment');
    expect(filteredQuery('is:starred', ['starred', 'important'])).toBe('is:starred is:important');
  });
});
