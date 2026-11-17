import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB_ICON, initialOf, needsDrawing, tabIconFor, type TabIcon } from '../../src/app/features/tabicon/choice';
import { SIZE, tabIconLayout, type TabIconColors } from '../../src/app/features/tabicon/render';
import { fromStorage } from '../../src/app/state/settings';

const colors: TabIconColors = { tile: '#0b57d0', onTile: '#ffffff', badge: '#b3261e', onBadge: '#ffffff' };
// Roughly Google Sans Flex bold at 25px: 15px a digit, 12 for the plus.
const measure = (text: string) => [...text].reduce((w, c) => w + (c === '+' ? 12 : 15), 0);

describe('which icon a tab shows', () => {
  const star: TabIcon = { look: 'star', color: '#ffad47', count: false };

  it("uses an account's own icon, matched whatever the address's case, and every other account falls back to the default", () => {
    const settings = fromStorage({ accountPrefs: { 'studio@example.net': { nickname: 'Studio', tabIcon: star } } });
    expect(tabIconFor(settings, 'Studio@Example.NET')).toEqual(star);
    expect(tabIconFor(settings, 'alex@example.com')).toEqual(DEFAULT_TAB_ICON);
    // All inboxes and circles aren't one account.
    expect(tabIconFor(settings, null)).toEqual(DEFAULT_TAB_ICON);
  });

  it('drops a stored icon it no longer understands without losing the rest of the account', () => {
    const settings = fromStorage({
      tabIcon: { look: 'rocket', color: 'theme', count: true },
      accountPrefs: {
        'studio@example.net': { nickname: 'Studio', tabIcon: { look: 'star', color: 'red', count: true } },
        'alex@example.com': { tabIcon: { look: 'gmail', color: 'theme' } },
      },
    });
    expect(settings.tabIcon).toEqual(DEFAULT_TAB_ICON);
    expect(settings.accountPrefs['studio@example.net']).toEqual({ nickname: 'Studio' });
    expect(tabIconFor(settings, 'alex@example.com')).toEqual(DEFAULT_TAB_ICON);
  });

  it("hands the tab back to Gmail's own icon unless a count has to go on it", () => {
    const gmail = (count: boolean): TabIcon => ({ look: 'gmail', color: 'theme', count });
    expect(needsDrawing(gmail(false), 12)).toBe(false);
    expect(needsDrawing(gmail(true), 0)).toBe(false);
    expect(needsDrawing(gmail(true), 12)).toBe(true);
    expect(needsDrawing({ ...DEFAULT_TAB_ICON, count: false }, 0)).toBe(true);
  });
});

describe('the drawing', () => {
  const badge = (unread: number | null) => tabIconLayout({ look: 'mail', colors, unread }, measure).badge;

  it('shows the count up to 99, then 99+, always inside the icon', () => {
    expect(badge(7)).toMatchObject({ text: '7' });
    expect(badge(99)).toMatchObject({ text: '99' });
    const big = badge(12_345)!;
    expect(big.text).toBe('99+');
    expect(big.x).toBeGreaterThanOrEqual(0);
    expect(big.x + big.width).toBe(SIZE);
    // One digit is a circle, not a sliver.
    expect(badge(3)!.width).toBe(badge(3)!.height);
  });

  it('has no badge with nothing unread or with the count turned off', () => {
    expect(badge(0)).toBeNull();
    expect(badge(-4)).toBeNull();
    expect(badge(Number.NaN)).toBeNull();
    expect(badge(null)).toBeNull();
  });

  it("puts each design's own glyph on its own shape, and a letter on a circle", () => {
    expect(tabIconLayout({ look: 'home', colors, unread: null }, measure).mark).toMatchObject({ kind: 'shape', shape: 'Cookie9Sided', glyph: 'home' });
    expect(tabIconLayout({ look: 'letter', colors, unread: null, initial: 'S' }, measure).mark).toEqual({ kind: 'letter', text: 'S' });
  });

  it('takes the first letter a person reads, accents and emoji whole', () => {
    expect(initialOf('  élodie')).toBe('É');
    expect(initialOf('👩‍💻 Dev')).toBe('👩‍💻');
    expect(initialOf('')).toBe('');
  });
});
