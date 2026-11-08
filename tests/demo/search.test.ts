import { parseQuery, type QueryNode } from '../../src/app/data/demo';
import { DEMO_LABEL_IDS as L } from '../../src/app/data/demo';
import { count, demo, ids, sorted } from './helpers';

/** Compact AST printer so expectations read like Gmail queries. */
function show(n: QueryNode | null): string {
  if (!n) return '∅';
  switch (n.type) {
    case 'term':
      return `${n.op ? `${n.op}:` : ''}${n.phrase ? `"${n.value}"` : n.value}`;
    case 'not':
      return `-${show(n.child)}`;
    case 'and':
      return `(${n.children.map(show).join(' & ')})`;
    case 'or':
      return `(${n.children.map(show).join(' | ')})`;
  }
}

describe('query parser', () => {
  it.each([
    // Gmail binds OR tighter than the implicit AND.
    ['a b OR c', '(a & (b | c))'],
    ['a OR b c', '((a | b) & c)'],
    ['(a b) OR c', '((a & b) | c)'],
    ['-(a OR b) c', '(-(a | b) & c)'],
    ['{a b} c', '((a | b) & c)'],
    ['from:(alice OR bob) -subject:"weekly update"', '((from:alice | from:bob) & -subject:"weekly update")'],
    ['subject:(dark mode)', '(subject:dark & subject:mode)'],
    ['label:"Work/Design reviews" is:unread', '(label:"Work/Design reviews" & is:unread)'],
    ['larger:5M older_than:2y', '(larger:5M & older_than:2y)'],
    ['"exact phrase" -"not this"', '("exact phrase" & -"not this")'],
    ['re: lunch', '(re: & lunch)'],
    ['+word AND other', '(word & other)'],
  ])('%s', (q, expected) => {
    expect(show(parseQuery(q))).toBe(expected);
  });

  it.each(['', '   ', '(', ')', 'OR', '-', '((a', 'a)) b', '""', 'from:'])('survives malformed input %j', (q) => {
    expect(() => parseQuery(q)).not.toThrow();
  });

  it('keeps going past stray closers', () => {
    expect(show(parseQuery('a) b'))).toBe('(a & b)');
    expect(show(parseQuery('(from:priya'))).toBe('from:priya');
  });
});

describe('search against the demo mailbox', () => {
  const b = demo();

  it('quoted label names, dashed names and slashes all resolve to the nested label', async () => {
    const quoted = await ids(b, 'label:"Work/Design reviews"');
    expect(quoted.length).toBeGreaterThan(3);
    expect(await ids(b, 'label:work-design-reviews')).toEqual(quoted);
    expect(await ids(b, 'label:Work/Design-Reviews')).toEqual(quoted);
    expect(await ids(b, 'label:"work design reviews"')).toEqual(quoted);
    expect(quoted).toContain('t-settings-ia');
    expect(await ids(b, 'label:"side project"')).toEqual(await ids(b, 'label:side-project'));
  });

  it('a parent label does not include its children', async () => {
    const b2 = demo();
    await b2.modifyThreads(['u-sk-3'], { remove: [L.work] });
    expect(await ids(b2, 'label:work')).not.toContain('u-sk-3');
    expect(await ids(b2, 'label:work-design-reviews')).toContain('u-sk-3');
  });

  it('OR binds tighter than AND', async () => {
    expect(sorted(await ids(b, 'subject:lease OR subject:lisbon is:starred'))).toEqual(['t-lease-renewal', 'u-albatross']);
    expect(sorted(await ids(b, '{subject:lease subject:lisbon} is:starred'))).toEqual(['t-lease-renewal', 'u-albatross']);
    expect(sorted(await ids(b, '(subject:lease OR subject:lisbon) -is:starred'))).toEqual(['p-farewise-1', 't-offsite']);
  });

  it('operator groups with OR, across Latin and Japanese senders', async () => {
    expect(sorted(await ids(b, 'from:(sofia OR kenji)'))).toEqual(
      sorted(['t-abuela-90', 't-sofia-portfolio', 'x-arch-newyear', 'x-sofia-internship', 't-kenji-tokyo', 'x-arch-tokyo-kenji']),
    );
    expect(sorted(await ids(b, 'from:(sofia OR kenji) -label:family'))).toEqual(['t-kenji-tokyo', 'x-arch-tokyo-kenji']);
  });

  it('negation composes with categories: primary is the inbox minus every other tab', async () => {
    const primary = await ids(b, 'in:inbox category:primary');
    const viaNegation = await ids(b, 'in:inbox -category:promotions -category:social -category:updates -category:forums');
    expect(viaNegation).toEqual(primary);
    expect(primary).toContain('t-onboarding-v4');
    expect(primary).not.toContain('p-margin-142');
  });

  it('spam and trash only show up when asked for', async () => {
    expect(await ids(b, '"$1,000 reward"')).toEqual([]);
    expect(await ids(b, 'in:spam "$1,000 reward"')).toEqual(['x-spam-prize']);
    expect(await ids(b, 'in:anywhere "$1,000 reward"')).toEqual(['x-spam-prize']);
    const anywhere = await count(b, 'in:anywhere');
    expect(await count(b, 'in:all')).toBe(anywhere - (await count(b, 'in:spam')) - (await count(b, 'in:trash')));
    expect(await count(b, '')).toBe(await count(b, 'in:all'));
    // Trash still excludes spam and vice versa.
    expect(await ids(b, 'in:trash from:"Rewards Department"')).toEqual([]);
  });

  it('quoted phrases match words in order, not scattered words', async () => {
    expect(await ids(b, '"protein bars that taste like drywall"')).toEqual(['t-climbing']);
    expect(await ids(b, '"drywall protein"')).toEqual([]);
    expect(await ids(b, 'drywall protein')).toEqual(['t-climbing']);
  });

  it('matches whole words, folds accents, and handles CJK and Arabic', async () => {
    expect(await ids(b, 'from:muller')).toEqual(['t-greta']);
    expect(await ids(b, '東京')).toContain('t-kenji-tokyo');
    expect(await ids(b, 'مبروك')).toEqual(['t-omar']);
    // Words match from their start: "ink" finds Inkwell but not "think".
    const ink = await ids(b, 'ink');
    expect(ink).toContain('u-inkwell-reset');
    expect(ink).not.toContain('t-onboarding-v4');
  });

  it('subject:(a b) requires both words in the subject', async () => {
    expect(await ids(b, 'subject:(dark mode)')).toEqual(['x-dark-toggle']);
    expect(await ids(b, 'subject:(mode dark)')).toEqual(['x-dark-toggle']);
    expect(await ids(b, 'subject:"mode dark"')).toEqual([]);
  });

  it('cc: only looks at cc, to: includes cc', async () => {
    expect(sorted(await ids(b, 'cc:yuki'))).toEqual(['t-onboarding-v4', 't-research-readout']);
    const to = await ids(b, 'to:yuki');
    expect(to).toEqual(expect.arrayContaining(['t-onboarding-v4', 't-research-readout', 'x-readout-update', 'x-sent-pricing-notes']));
  });

  it('size operators understand k and M units and bytes', async () => {
    expect(await ids(b, 'larger:9M')).toEqual(['t-trail-photos', 'x-dad-slides']);
    expect(sorted(await ids(b, 'larger:7M'))).toEqual(['t-sofia-portfolio', 't-trail-photos', 'x-dad-slides']);
    expect(await ids(b, `larger:${7 * 1024 * 1024}`)).toEqual(await ids(b, 'larger:7M'));
    expect(await ids(b, 'larger:7.6M')).toEqual(['t-trail-photos', 'x-dad-slides']);
    expect(await ids(b, 'larger:10M')).toEqual(['x-dad-slides']);
    expect(await ids(b, 'larger:20M')).toEqual([]);
    expect(sorted(await ids(b, 'has:attachment smaller:10k -filename:png'))).toEqual(['t-design-crit-invite', 't-error-copy', 'x-arch-movein', 'x-readout-update']);
    // Flat chart PNGs compress to a few KB, like real ones; photos are megabytes.
    for (const id of await ids(b, 'filename:png smaller:10k')) {
      const t = await b.getThread(id);
      expect(t.messages.some((m) => m.attachments.some((a) => a.mimeType === 'image/png' && a.size < 10 * 1024))).toBe(true);
    }
    expect(await ids(b, 'filename:png smaller:10k')).not.toContain('t-trail-photos');
    expect(await ids(b, 'size:9M')).toEqual(await ids(b, 'larger:9M'));
  });

  it('after:/before: use local calendar days, before: is exclusive', async () => {
    // NOW is Oct 8. Oct 1 is 7 days ago, Oct 2 is 6 days ago.
    const range = await ids(b, 'after:2026/10/01 before:2026/10/03');
    expect(range).toEqual(expect.arrayContaining(['u-bank-statement', 'x-sent-last-weekly', 't-error-copy']));
    expect(range).not.toContain('t-onboarding-v4');
    expect(range).not.toContain('t-one-on-one'); // Sept 30
    for (const id of range) {
      const t = await b.getThread(id);
      expect(t.messages.some((m) => m.date >= new Date(2026, 9, 1).getTime() && m.date < new Date(2026, 9, 3).getTime())).toBe(true);
    }
    expect(await ids(b, 'after:2026-10-01 before:2026-10-03')).toEqual(range);
    expect(await ids(b, 'after:10/01/2026 before:10/03/2026')).toEqual(range);
    expect(await ids(b, 'after:2026/10/03 before:2026/10/03')).toEqual([]);
  });

  it('older_than / newer_than count back from the fixed clock', async () => {
    expect(sorted(await ids(b, 'older_than:1y'))).toEqual(['x-arch-movein', 'x-arch-offer', 'x-arch-promo-lowtide', 'x-arch-promo-oakline', 'x-arch-promo-stride', 'x-arch-tokyo', 'x-arch-tokyo-kenji']);
    expect(sorted(await ids(b, 'older_than:12m'))).toEqual(sorted(await ids(b, 'older_than:1y')));
    // Strictly newer than 60 minutes: the thread updated exactly an hour ago is out.
    expect(sorted(await ids(b, 'newer_than:1h'))).toEqual(
      // The scheduled send is dated in the future, so it counts as newer too.
      sorted(['u-ledgerly-2fa', 'x-sofia-internship', 't-onboarding-v4', 'x-readout-update', 't-research-readout', 't-climbing', 'x-scheduled-weekly']),
    );
    expect(await ids(b, 'newer_than:1h')).not.toContain('t-abuela-90');
    // Terms apply per message: a thread straddling the line matches both ways.
    const newer = await ids(b, 'newer_than:7d');
    const notNewer = await ids(b, '-newer_than:7d');
    expect(newer.length).toBeGreaterThan(40);
    expect(sorted([...new Set([...newer, ...notNewer])])).toEqual(sorted(await ids(b, '')));
    const cutoff = new Date(2026, 9, 1, 10, 0).getTime();
    for (const id of newer.filter((x) => notNewer.includes(x))) {
      const dates = (await b.getThread(id)).messages.map((m) => m.date);
      expect(Math.min(...dates)).toBeLessThanOrEqual(cutoff);
      expect(Math.max(...dates)).toBeGreaterThan(cutoff);
    }
  });

  it('filename:, from:me and has:attachment combine', async () => {
    expect(sorted(await ids(b, 'filename:pdf from:me'))).toEqual(['t-plantwise-beta', 'x-arch-taxes']);
    expect(sorted(await ids(b, 'filename:ics'))).toEqual(['t-design-crit-invite', 'x-readout-update']);
    expect(await ids(b, 'filename:"error-strings-rewrite.csv"')).toEqual(['t-error-copy']);
    expect(await ids(b, 'has:attachment -filename:png -filename:pdf -filename:ics -filename:csv')).toEqual(
      await ids(b, 'filename:docx'),
    );
  });

  it('system views have the expected sizes', async () => {
    expect(await count(b, 'in:snoozed')).toBe(2);
    expect(await count(b, 'in:scheduled')).toBe(1);
    expect(await count(b, 'in:spam')).toBe(3);
    expect(await count(b, 'in:trash')).toBe(4);
    expect(await count(b, 'is:starred')).toBe(10);
    expect(await count(b, 'in:drafts')).toBe(4);
    expect(await ids(b, 'label:taxes')).toEqual(['x-arch-taxes']);
    expect(await ids(b, 'list:typography-discuss')).toEqual(['f-type-variable']);
    expect(await ids(b, 'is:muted')).toEqual([]);
  });

  it('unknown operators are plain words, and unknown labels match nothing', async () => {
    expect(await ids(b, 'foo:bar')).toEqual([]);
    expect(await ids(b, 'label:does-not-exist')).toEqual([]);
    expect(await count(b, '-label:does-not-exist')).toBe(await count(b, ''));
  });

  it('roughly 30% of the inbox is unread, skewed to recent mail', async () => {
    const inbox = await b.listThreads({ q: 'in:inbox', pageSize: 500 });
    const unread = inbox.threads.filter((t) => t.labelIds.includes('UNREAD'));
    const ratio = unread.length / inbox.threads.length;
    expect(ratio).toBeGreaterThan(0.22);
    expect(ratio).toBeLessThan(0.4);
    const top = inbox.threads.slice(0, 15).filter((t) => t.labelIds.includes('UNREAD')).length;
    expect(top).toBeGreaterThan(8);
  });
});
