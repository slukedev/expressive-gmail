import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The browser tab's icon (Settings > Appearance > Tab icon). On Gmail the content script owns the
 * tab's icon; preview/frame.html does the same, with its own icon standing in for Gmail's.
 * The plain preview keeps its own tab's icon.
 */

test.use({ viewport: { width: 1366, height: 768 } });

const iconHref = (page: Page) => page.evaluate(() => document.querySelector<HTMLLinkElement>('link[rel~="icon" i]')?.getAttribute('href') ?? null);

/** Whether the icon carries the red unread badge in its top right corner. */
const hasBadge = (page: Page) =>
  page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel~="icon" i]')?.href;
    if (!href) return false;
    const img = new Image();
    img.src = href;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    g.drawImage(img, 0, 0, 64, 64);
    const [r, gr, b, a] = g.getImageData(57, 14, 1, 1).data;
    // Google's error role: #b3261e.
    return a > 200 && r > 150 && gr < 80 && b < 80;
  });

test('a tab icon is picked in Settings, its unread count turned off, and Gmail’s own icon brought back', async ({ mail, page }) => {
  void mail;
  await page.goto('/preview/frame.html?latency=0#inbox');
  const app = page.frameLocator('iframe');
  await expect(app.locator('.thread-list').getByRole('listitem').first()).toBeVisible();
  // The demo inbox has unread mail, so the default icon counts it.
  await expect.poll(() => iconHref(page)).toMatch(/^data:image\/png;base64,/);
  await expect.poll(() => hasBadge(page)).toBe(true);
  const drawn = await iconHref(page);

  await page.evaluate(() => (location.hash = '#inbox'));
  await app.locator('.account-btn').click();
  await app.getByRole('menu').getByRole('menuitem', { name: 'All settings' }).click();
  const dialog = app.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
  const block = dialog.getByRole('region', { name: 'Tab icon' });

  await block.getByRole('radio', { name: 'Star' }).click();
  await expect(block.getByRole('radio', { name: 'Star' })).toBeChecked();
  await expect.poll(() => iconHref(page)).not.toBe(drawn);
  await expect.poll(() => hasBadge(page)).toBe(true);

  await block.getByRole('switch', { name: 'Unread count' }).click();
  await expect.poll(() => hasBadge(page)).toBe(false);
  // Only ever one icon on the page.
  await expect(page.locator('link[rel~="icon" i]')).toHaveCount(1);

  // Gmail's own icon, with nothing to add to it, is Gmail's own link again.
  await block.getByRole('radio', { name: 'Gmail' }).click();
  await expect.poll(() => iconHref(page)).toBe('/icon/32.png');
  await expect(block.getByRole('radiogroup', { name: 'Color' })).toHaveCount(0);

  // Kept across a reload.
  await page.reload();
  await expect(app.locator('.thread-list').getByRole('listitem').first()).toBeVisible();
  await expect.poll(() => iconHref(page)).toBe('/icon/32.png');
});

test('an account with its own icon shows it while that account is on screen', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.list).toBeVisible();
  await expect.poll(() => iconHref(page)).toMatch(/^data:image\/png;base64,/);
  const home = await iconHref(page);

  await page.locator('.account-btn').click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'All settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Appearance', exact: true }).click();
  const block = dialog.getByRole('region', { name: 'Tab icon' });
  // Opens on every account, since no account has its own yet.
  const account = block.getByRole('combobox', { name: 'Account' });
  await expect(account).toContainText('All accounts');
  await account.click();
  await page.getByRole('option', { name: 'alex@riverastudio.example.net' }).click();
  await expect(block.getByRole('radio', { name: 'Leaf' })).toHaveCount(0);
  await block.getByRole('switch', { name: 'Own icon' }).click();
  await block.getByRole('radio', { name: 'Leaf' }).click();
  await block.getByRole('radio', { name: 'Green' }).click();
  // This tab still shows the other account.
  expect(await iconHref(page)).toBe(home);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.locator('.account-btn').click();
  await page.getByRole('menu').getByRole('menuitem', { name: /alex@riverastudio\.example\.net/ }).click();
  await expect(mail.row('Harbor Bikes website')).toBeVisible();
  await expect.poll(() => iconHref(page)).not.toBe(home);
  const studio = await iconHref(page);

  await page.keyboard.press('g');
  await page.keyboard.press('1');
  await expect(mail.row('I GOT IT')).toBeVisible();
  await expect.poll(() => iconHref(page)).toBe(home);
  expect(studio).not.toBe(home);
});
