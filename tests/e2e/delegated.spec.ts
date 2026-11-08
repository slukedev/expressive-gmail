import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Mailboxes delegated to the demo's main account: Jordan Rivera's and the
 * studio's bookings inbox. Each opens in Gmail itself, in a new tab.
 */

const JORDAN_URL = 'https://mail.google.com/mail/u/0/d/AEoRXRTdemoJordan0001/';

/** Answers for Gmail so a new tab never leaves the machine. */
async function stubGmail(context: BrowserContext) {
  await context.route('https://mail.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Gmail</title>' }));
}

async function openAccountMenu(page: Page) {
  await page.locator('.account-btn').click();
  return page.getByRole('menu');
}

test('the account menu lists delegated mailboxes, and one opens in a new tab', async ({ mail, page, context }) => {
  await stubGmail(context);
  await mail.open('inbox');
  const menu = await openAccountMenu(page);
  const group = menu.getByRole('group', { name: 'Delegated' });
  await expect(group.getByRole('menuitem')).toHaveCount(2);
  const jordan = group.getByRole('menuitem', { name: 'Jordan Rivera, jordan.rivera@example.com, opens in a new tab' });
  await expect(jordan).toBeVisible();
  await expect(group.getByRole('menuitem', { name: /^Rivera Studio Bookings, bookings@riverastudio\.example\.net/ })).toBeVisible();

  // Keyboard: Enter on the focused row.
  await jordan.focus();
  const popup = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  const tab = await popup;
  expect(tab.url()).toBe(JORDAN_URL);
  await expect(menu).toBeHidden();
});

test('Settings > Accounts lists them with a way to open each', async ({ mail, page, context }) => {
  await stubGmail(context);
  await mail.open('inbox');
  const menu = await openAccountMenu(page);
  await menu.getByRole('menuitem', { name: 'Manage accounts and circles' }).click();
  const list = page.getByRole('list', { name: 'Delegated' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list).toContainText('jordan.rivera@example.com');
  const popup = page.waitForEvent('popup');
  await list.getByRole('button', { name: 'Open Rivera Studio Bookings in a new tab' }).click();
  expect((await popup).url()).toBe('https://mail.google.com/mail/u/0/d/AEoRXRTdemoBookings02/');
});

test('the command palette reaches them', async ({ mail, page, context }) => {
  await stubGmail(context);
  await mail.open('inbox');
  // Delegated mailboxes are read when the page is idle; wait until the menu has them.
  await expect((await openAccountMenu(page)).getByRole('group', { name: 'Delegated' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByRole('combobox')).toBeFocused();
  await page.keyboard.type('jordan');
  const popup = page.waitForEvent('popup');
  await page.getByRole('option', { name: /Open Jordan Rivera/ }).click();
  expect((await popup).url()).toBe(JORDAN_URL);
});

test.describe('one account signed in', () => {
  test.use({ query: 'latency=0&accounts=1' });

  test('still shows its delegated mailboxes, without the switching rows', async ({ mail, page }) => {
    await mail.open('inbox');
    const menu = await openAccountMenu(page);
    await expect(menu.getByRole('group', { name: 'Delegated' }).getByRole('menuitem')).toHaveCount(2);
    await expect(menu.getByRole('menuitem', { name: /All inboxes/ })).toHaveCount(0);
  });
});

test.describe('nothing delegated', () => {
  test.use({ query: 'latency=0&delegated=0' });

  test('shows no Delegated group or list', async ({ mail, page }) => {
    await mail.open('inbox');
    const menu = await openAccountMenu(page);
    await expect(menu.getByRole('menuitem', { name: /alexr\.makes/ })).toBeVisible();
    await expect(menu.getByRole('group', { name: 'Delegated' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Manage accounts and circles' }).click();
    await expect(page.getByRole('heading', { name: 'Circles' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Delegated' })).toHaveCount(0);
  });
});

test.describe('a brand-new account', () => {
  test.use({ query: 'latency=0&empty' });

  test('has none', async ({ mail, page }) => {
    await mail.open('inbox');
    const menu = await openAccountMenu(page);
    await expect(menu.getByRole('menuitem', { name: 'All settings' })).toBeVisible();
    await expect(menu.getByRole('group', { name: 'Delegated' })).toHaveCount(0);
  });
});
