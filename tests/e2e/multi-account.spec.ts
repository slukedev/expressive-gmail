import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * Several signed-in accounts: switching, All inboxes, narrowing to one account,
 * circles and where Gmail opens. The demo has three fictional accounts:
 * alex.rivera@example.com (this tab's), alex@riverastudio.example.net and
 * alexr.makes@example.org.
 */

const STUDIO = 'alex@riverastudio.example.net';
const STUDIO_THREAD = 'Thimble & Oak: logo round 2';
const MAIN_THREAD = 'I GOT IT';

async function openAccountMenu(page: Page) {
  await page.locator('.account-btn').click();
  return page.getByRole('menu');
}

async function pick(page: Page, item: string | RegExp) {
  const menu = await openAccountMenu(page);
  await menu.getByRole('menuitem', { name: item }).click();
}

test('All inboxes merges every account, says where each conversation is, and survives a reload', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.row(STUDIO_THREAD)).toHaveCount(0);

  await pick(page, /^All inboxes/);
  await expect(page.getByRole('heading', { level: 1, name: 'All inboxes' })).toBeVisible();
  await expect(mail.row(STUDIO_THREAD)).toBeVisible();
  await expect(mail.row(MAIN_THREAD)).toBeVisible();
  // Each row carries its account, in the row's accessible name and as a badge on the sender's photo.
  await expect(mail.rowBody(STUDIO_THREAD)).toHaveAccessibleName(/in riverastudio$/);
  await expect(mail.row(STUDIO_THREAD).locator('.account-badge')).toBeVisible();
  await expect(page).toHaveTitle(/All inboxes - Gmail$/);

  // The nav count adds every account's inbox.
  await expect.poll(() => mail.inboxUnread()).toBeGreaterThan(0);
  const merged = await mail.inboxUnread();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'All inboxes' })).toBeVisible();
  await expect.poll(() => mail.inboxUnread()).toBe(merged);

  // The account chips narrow everything, counts included, and widen again.
  const filter = page.getByRole('group', { name: 'Show mail from' });
  await filter.getByRole('button', { name: /^Only riverastudio/ }).click();
  await expect(mail.row(MAIN_THREAD)).toHaveCount(0);
  await expect(mail.row(STUDIO_THREAD)).toBeVisible();
  // The narrowed view says so, and rows drop the now-redundant badge.
  await expect(page.locator('.list-bar__meta')).toContainText('only riverastudio');
  await expect(filter.getByRole('button', { name: /^Only riverastudio/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(mail.row(STUDIO_THREAD).locator('.account-badge')).toHaveCount(0);
  const studioUnread = await mail.inboxUnread();
  expect(studioUnread).toBeGreaterThan(0);
  expect(studioUnread).toBeLessThan(merged);
  await filter.getByRole('button', { name: /^Only riverastudio/ }).click();
  await expect(mail.row(MAIN_THREAD)).toBeVisible();
});

test('an action in All inboxes lands in the account that owns the conversation', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.row(MAIN_THREAD)).toBeVisible();
  await expect.poll(() => mail.inboxUnread()).toBeGreaterThan(0);
  const mainUnread = await mail.inboxUnread();
  await pick(page, /^All inboxes/);
  await mail.hoverAction(STUDIO_THREAD, 'Archive');
  await expect(mail.snackbar).toContainText('Conversation archived');
  await expect(mail.row(STUDIO_THREAD)).toHaveCount(0);

  await pick(page, new RegExp(STUDIO.replace(/\./g, '\\.')));
  await expect(mail.list).toBeVisible();
  await expect(mail.row('Harbor Bikes website')).toBeVisible();
  await expect(mail.row(STUDIO_THREAD)).toHaveCount(0);

  await page.keyboard.press('g');
  await page.keyboard.press('1');
  await expect(mail.row(MAIN_THREAD)).toBeVisible();
  await expect.poll(() => mail.inboxUnread()).toBe(mainUnread);
});

test('a reply in All inboxes goes out from the account that received the mail', async ({ mail, page }) => {
  await mail.open('inbox');
  await pick(page, /^All inboxes/);
  await mail.rowBody(STUDIO_THREAD).click();
  await expect(page.locator('.thread__account')).toHaveText('riverastudio');
  await page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  // In the conversation: the dock's hidden warm-up window has a From line too.
  const from = mail.thread.locator('.compose-from');
  await expect(from).toContainText(STUDIO);
  await expect(from).not.toContainText('alex.rivera@example.com');
});

test('switching saves an unsent message to Drafts in its own account', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.list).toBeVisible();
  await page.keyboard.press('c');
  const window = page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
  await window.getByRole('textbox', { name: 'Subject' }).fill('Quarterly numbers, rough draft');
  await pick(page, new RegExp(STUDIO.replace(/\./g, '\\.')));
  await expect(mail.snackbar).toContainText('Your unsent message was saved to Drafts.');
  await expect(window).toHaveCount(0);
  await expect(mail.row('Harbor Bikes website')).toBeVisible();

  await page.keyboard.press('g');
  await page.keyboard.press('1');
  await mail.nav.getByRole('link', { name: /^Drafts/ }).click();
  await expect(mail.row('Quarterly numbers, rough draft')).toBeVisible();
});

test('a circle reads only its accounts and can be where Gmail opens', async ({ mail, page, context }) => {
  await mail.open('inbox');
  const menu = await openAccountMenu(page);
  await menu.getByRole('menuitem', { name: 'Group accounts into a circle' }).click();
  const dialog = page.getByRole('dialog', { name: 'New circle' });
  // Just the dialog, on its scrim, with nothing opened behind it.
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  await expect(page.locator('.m3-scrim')).toHaveCount(1);
  // Painted over the whole app, not just present.
  await expect.poll(() => page.evaluate(() => {
    const top = document.elementFromPoint(4, 4) as HTMLElement | null;
    return top?.classList.contains('m3-scrim') && getComputedStyle(top).opacity === '1' && getComputedStyle(top).backgroundColor !== 'rgba(0, 0, 0, 0)';
  })).toBe(true);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText('Give the circle a name.')).toBeVisible();
  await expect(dialog.getByText('Pick at least two accounts.')).toBeVisible();

  await dialog.getByRole('button', { name: 'Work', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'Include alex.rivera@example.com' }).click();
  await dialog.getByRole('checkbox', { name: `Include ${STUDIO}` }).click();
  await dialog.getByRole('switch', { name: 'Open Gmail in this circle' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await mail.snackbar.getByRole('button', { name: 'Open' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Work' })).toBeVisible();
  await expect(mail.row(STUDIO_THREAD)).toBeVisible();
  await expect(mail.row('Your pieces are out of the kiln')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Show mail from' }).getByRole('button')).toHaveCount(2);

  // A brand new tab starts in the circle it was told to.
  const fresh = await context.newPage();
  await fresh.goto('/?latency=0#inbox');
  await expect(fresh.getByRole('heading', { level: 1, name: 'Work' })).toBeVisible();
  await expect(fresh).toHaveTitle(/Work - Gmail$/);
});

test.describe('an account that can’t be read', () => {
  test.use({ query: 'latency=0&accountfail=studio' });

  test('All inboxes shows the others and says which one is missing', async ({ mail, page }) => {
    await mail.open('inbox');
    await pick(page, /^All inboxes/);
    const notice = page.getByRole('status').filter({ hasText: "couldn't load" });
    // Named the way its chip names it, and the chip shows it failed.
    await expect(notice).toContainText("Mail from riverastudio couldn't load");
    await expect(page.getByRole('button', { name: /^Only riverastudio, .*couldn't load$/ })).toBeVisible();
    await expect(mail.row(MAIN_THREAD)).toBeVisible();
    await expect(notice.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

test.describe('one account signed in', () => {
  test.use({ query: 'latency=0&accounts=1' });

  test('the menu offers no switching and Settings explains how to add one', async ({ mail, page }) => {
    await mail.open('inbox');
    const menu = await openAccountMenu(page);
    await expect(menu.getByRole('menuitem', { name: /All inboxes/ })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Show mail from' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'All settings' }).click();
    await page.getByRole('button', { name: 'Accounts' }).click();
    await expect(page.getByText('One account is signed in')).toBeVisible();
  });
});

test.describe('a saved circle', () => {
  test.use({
    seed: {
      onboarded: true,
      undoSendSeconds: 0,
      readingPane: 'right',
      circles: [{ id: 'work', name: 'Work', members: ['alex.rivera@example.com', STUDIO], color: '#4a86e8' }],
    },
  });

  test('opens from the account menu and back to one account', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.row(MAIN_THREAD)).toBeVisible();
    await pick(page, /^Work/);
    await expect(page.getByRole('heading', { level: 1, name: 'Work' })).toBeVisible();
    await expect(mail.row(STUDIO_THREAD)).toBeVisible();
    await pick(page, /alex\.rivera@example\.com/);
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    await expect(mail.row(STUDIO_THREAD)).toHaveCount(0);
  });
});
