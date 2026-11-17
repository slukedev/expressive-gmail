import { describe, expect, it } from 'vitest';
import { highlight, matches, searchWords } from '../../src/app/features/settings/search';

const find = (query: string, ...texts: string[]) => matches(searchWords(query), ...texts);

describe('settings search', () => {
  it('matches the start of a word, not the middle of one', () => {
    expect(find('tab', 'Promotions tab')).toBe(true);
    expect(find('tab', 'Density', 'compact comfortable spacing')).toBe(false);
    expect(find('mail', 'Block email trackers')).toBe(false);
    expect(find('mail', 'New mail notifications')).toBe(true);
  });

  it('needs every word, in any order and case, and reads punctuation as a space', () => {
    expect(find('UNDO sen', 'Undo send')).toBe(true);
    expect(find('send undo', 'Undo send')).toBe(true);
    expect(find('undo dark', 'Undo send')).toBe(false);
    expect(find('auto-advance', 'Skip to unread', 'auto advance next unread')).toBe(true);
    expect(find('“dark”', 'Dark emails')).toBe(true);
  });

  it('treats a query of only spaces or symbols as no search', () => {
    expect(searchWords('  ')).toEqual([]);
    expect(searchWords('/ -')).toEqual([]);
  });

  it('highlights only the word starts it matched', () => {
    const parts = highlight('Comfortable tabs, Promotions tab', searchWords('tab'));
    expect(parts.filter((_, i) => i % 2)).toEqual(['tab', 'tab']);
    expect(parts.join('')).toBe('Comfortable tabs, Promotions tab');
  });
});
