window.matchMedia ??= ((media: string) => ({ matches: false, media, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const { typedItems } = await import('../../src/app/features/palette/commands');

type Args = Parameters<typeof typedItems>;
const hint = (query: string, now: Date) => {
  const ctx = { now, route: { view: { kind: 'folder', folder: 'inbox' } }, target: null, caps: {}, labels: [], me: [], listIds: [] } as unknown as Args[2];
  const env = { dark: false, pick: () => {}, whenOptions: {} } as unknown as Args[3];
  return typedItems({ id: 'pause', title: 'Pause' } as Args[0], { query, contacts: [] } as unknown as Args[1], ctx, env)[0]?.meta;
};

describe('the time hint under a typed time', () => {
  it('calls a time tomorrow "Tomorrow", even more than a day and a half away', () => {
    expect(hint('tomorrow 6pm', new Date(2026, 10, 16, 0, 30))).toBe('Tomorrow');
  });

  it('never says "In 0 minutes"', () => {
    expect(hint('in 1 min', new Date(2026, 10, 16, 10, 0, 45))).toBe('In under a minute');
  });

  it('counts days by the calendar', () => {
    expect(hint('friday 9am', new Date(2026, 10, 16, 10, 0))).toBe('In 4 days');
  });
});
