import { filteredQuery } from '../../src/app/features/list/filters';
import { tokenize } from '../../src/app/features/search/query';

describe('filteredQuery (quick filters as Gmail operators)', () => {
  it.each([
    [['unread'], 'is:unread'],
    [['starred'], 'is:starred'],
    [['attachment'], 'has:attachment'],
    [['important'], 'is:important'],
  ] as const)('%j adds %s', (filters, token) => {
    expect(tokenize(filteredQuery('label:work', [...filters]))).toEqual(['label:work', token]);
  });

  it('combines several filters with the view query (implicit AND)', () => {
    const toks = tokenize(filteredQuery('from:(ana@example.com) "q3 report"', ['unread', 'attachment']));
    expect(toks).toEqual(expect.arrayContaining(['from:(ana@example.com)', '"q3 report"', 'is:unread', 'has:attachment']));
    expect(toks).toHaveLength(4);
  });

  it('works on an empty query, like the inbox with no search', () => {
    expect(filteredQuery('', ['starred']).trim()).toBe('is:starred');
  });

  it('keeps an OR search from swallowing the filter', () => {
    // "a OR b is:unread" is (a OR b) AND is:unread in Gmail, so either form is fine,
    // but the OR pair itself must survive intact.
    const q = filteredQuery('from:ana OR from:bo', ['unread']);
    expect(q).toMatch(/from:ana OR from:bo/);
    expect(tokenize(q)).toContain('is:unread');
  });
});
