import { expect, test } from './fixtures';

// Safari's Tab skips buttons and links unless Option is held.
const tabKey = (browserName: string) => (browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

test.describe('keyboard and focus', () => {
  test('Tab starts at the rail header: menu, brand, then Compose', async ({ mail, page, browserName }) => {
    const tab = tabKey(browserName);
    await mail.open('inbox', 'latency=0');
    await expect(mail.rows.first()).toBeVisible();
    await page.keyboard.press(tab);
    await expect(page.getByRole('button', { name: 'Collapse menu' })).toBeFocused();
    // Focus the person moved with Tab still gets its tooltip.
    await expect(page.locator('.m3-tooltip')).toHaveText('Collapse menu');
    await page.keyboard.press(tab);
    await expect(mail.nav.getByRole('link', { name: 'Gmail inbox' })).toBeFocused();
    await page.keyboard.press(tab);
    await expect(mail.nav.getByRole('button', { name: 'Compose' })).toBeFocused();
  });

  test('search suggestions close when focus tabs out of search, and stay open inside it', async ({ mail, page, browserName }) => {
    const tab = tabKey(browserName);
    await mail.open('inbox', 'latency=0');
    await expect(mail.rows.first()).toBeVisible();
    await page.keyboard.press('/');
    const input = page.getByRole('combobox', { name: 'Search in mail' });
    const panel = page.getByRole('listbox', { name: 'Search suggestions' });
    await expect(input).toBeFocused();
    await expect(panel).toBeVisible();

    // Into the quick filters: still searching.
    const unread = panel.getByRole('button', { name: 'Unread' });
    for (let i = 0; i < 10 && !(await unread.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press(tab);
    await expect(unread).toBeFocused();
    await expect(panel).toBeVisible();

    // Past the last one: the panel and its scrim go.
    for (let i = 0; i < 10 && (await page.evaluate(() => !!document.activeElement?.closest('.search'))); i++) await page.keyboard.press(tab);
    await expect(panel).toBeHidden();
    await expect(page.locator('.search__scrim')).toHaveCount(0);
  });

  test('after a click, j moves focus with the open thread and Esc returns to its row', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    const bodies = mail.list.locator('[data-row-index]');
    await expect(bodies.nth(3)).toBeVisible();
    await bodies.nth(3).click({ position: { x: 200, y: 16 } });
    await expect(page).toHaveURL(/#inbox\/.+/);
    // A mouse click doesn't draw the keyboard ring.
    expect(await bodies.nth(3).evaluate((el) => el.matches(':focus-visible'))).toBe(false);

    await page.keyboard.press('j');
    await expect(bodies.nth(4)).toBeFocused();
    await expect(bodies.nth(4)).toHaveAttribute('aria-current', 'true');
    const opened = page.url();

    // Enter acts on the row being read, not the one clicked first.
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(opened);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/#inbox$/);
    await expect(bodies.nth(4)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(opened);
    await page.keyboard.press('u');
    await expect(page).toHaveURL(/#inbox$/);
    await expect(bodies.nth(4)).toBeFocused();
  });

  test('x checks a row, Shift X checks everything from there to the cursor', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    await expect(mail.rows.nth(3)).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await expect(page.getByRole('toolbar', { name: '1 selected' })).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('Shift+X');
    await expect(page.getByRole('toolbar', { name: '4 selected' })).toBeVisible();
  });

  test('Enter on a button inside a row presses it and leaves the conversation closed', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    await expect(mail.rows.nth(1)).toBeVisible();
    await mail.rows.nth(1).getByRole('button', { name: 'Select conversation' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('toolbar', { name: '1 selected' })).toBeVisible();
    await expect(page).toHaveURL(/#inbox$/);
    await expect(mail.thread).toHaveCount(0);
  });

  test('archiving from a focused row hands focus to the row that takes its place', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    const bodies = mail.list.locator('[data-row-index]');
    await expect(bodies.nth(2)).toBeVisible();
    const next = await mail.rows.nth(1).locator('.row__subject-text').innerText();
    await page.keyboard.press('j');
    // A focused row builds its hover actions.
    const archive = mail.rows.nth(0).getByRole('button', { name: 'Archive', exact: true });
    await archive.focus();
    await page.keyboard.press('Enter');
    await expect(mail.rows.nth(0)).toContainText(next);
    await expect(bodies.nth(0)).toBeFocused();
  });

  test('a tooltip stays shut when a closing panel hands focus back to its button', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    await expect(mail.rows.first()).toBeVisible();
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    // Opened from the keyboard: Safari doesn't focus a clicked button, so it would have nothing to restore.
    await settings.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.mouse.move(0, 400);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(settings).toBeFocused();
    // Longer than the hover delay, so a late open would show.
    await page.waitForTimeout(900);
    await expect(page.locator('.m3-tooltip')).toHaveCount(0);
  });
});
