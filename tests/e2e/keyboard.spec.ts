import { DEFAULT_SEED, expect, test } from './fixtures';

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

  test('arrow keys do nothing until turned on in Settings', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    const bodies = mail.list.locator('[data-row-index]');
    await expect(bodies.nth(1)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(bodies.nth(0)).not.toBeFocused();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog.getByText('Move through categories and conversations')).toHaveCount(0);
  });

  test.describe('with arrow keys on', () => {
    test.use({ seed: { ...DEFAULT_SEED, arrowKeys: true } });

    test('arrow keys walk the list and up into the category rows, and Enter opens one', async ({ mail, page }) => {
      await mail.open('inbox', 'latency=0');
      const bodies = mail.list.locator('[data-row-index]');
      await expect(bodies.nth(2)).toBeVisible();

      await page.keyboard.press('ArrowDown');
      await expect(bodies.nth(0)).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(bodies.nth(1)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      // A list beside the reading pane shows the categories as rows above the mail.
      const categories = page.getByRole('list', { name: 'Inbox categories' }).getByRole('button');
      const count = await categories.count();
      expect(count).toBeGreaterThan(1);
      await expect(categories.last()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(bodies.nth(0)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      for (let i = 1; i < count; i++) await page.keyboard.press('ArrowUp');
      await expect(categories.first()).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#category\/\w+$/);
      await expect(page.getByRole('heading', { name: 'Promotions', exact: true })).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await expect(bodies.nth(0)).toBeFocused();
      await page.keyboard.press('End');
      await expect(bodies.last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(bodies.nth(0)).toBeFocused();
    });

    test.describe('with a wide list', () => {
      test.use({ seed: { onboarded: true, undoSendSeconds: 0, readingPane: 'none', arrowKeys: true } });

      test('Up from the first conversation reaches the open tab; Left, Right and Enter pick another', async ({ mail, page }) => {
        await mail.open('inbox', 'latency=0');
        const bodies = mail.list.locator('[data-row-index]');
        await expect(bodies.nth(1)).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowUp');
        const tabs = page.getByRole('tablist', { name: 'Inbox categories' });
        await expect(tabs.getByRole('tab', { name: /^Primary/ })).toBeFocused();
        await page.keyboard.press('ArrowRight');
        // Moving along the tabs opens nothing until Enter.
        await expect(page).toHaveURL(/#inbox$/);
        await expect(tabs.getByRole('tab').nth(1)).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#category\/\w+$/);
        await expect(page.getByRole('heading', { name: 'Promotions', exact: true })).toBeVisible();
        await page.keyboard.press('ArrowDown');
        await expect(bodies.nth(0)).toBeFocused();
        // Esc closes the open conversation first, then leaves the category.
        await page.keyboard.press('Enter');
        await expect(mail.threadHeading).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/#category\/\w+$/);
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/#inbox$/);
      });

      test('Enter opens the conversation full screen and arrows scroll it; Esc comes back to its row', async ({ mail, page }) => {
        await mail.open('inbox', 'latency=0');
        const long = mail.rowBody('Onboarding v4: final review before handoff');
        await expect(long).toBeVisible();
        await long.focus();
        await page.keyboard.press('Enter');
        await expect(mail.threadHeading).toContainText('Onboarding v4');
        const scroller = mail.thread.locator('.thread-scroll');
        await expect(scroller).toBeFocused();
        await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
        for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
        await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
        // From the toolbar too, after a click moved focus off the conversation.
        await mail.threadToolbar.getByRole('button').first().focus();
        const at = await scroller.evaluate((el) => el.scrollTop);
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(at);
        await expect(scroller).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(/#inbox$/);
        await expect(long).toBeFocused();
        // Enter opens it again, and Enter in the open conversation starts a reply.
        await page.keyboard.press('Enter');
        await expect(scroller).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(mail.thread.getByRole('textbox', { name: 'Message body' })).toBeFocused();
      });
    });

    test('with letter shortcuts off, arrows and Enter still move and open', async ({ mail, page }) => {
      await mail.open('inbox', 'latency=0');
      await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem('bg.settings.v1') ?? '{}');
        localStorage.setItem('bg.settings.v1', JSON.stringify({ ...s, keyboardShortcuts: false }));
      });
      await page.reload();
      const bodies = mail.list.locator('[data-row-index]');
      await expect(bodies.nth(1)).toBeVisible();
      await page.keyboard.press('j');
      await expect(bodies.nth(0)).not.toBeFocused();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(bodies.nth(1)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#inbox\/.+/);
      await expect(mail.threadHeading).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page).toHaveURL(/#inbox$/);
      await expect(bodies.nth(1)).toBeFocused();
    });

    test('in the sidebar, Up and Down move between destinations and Right goes to the list', async ({ mail, page }) => {
      await mail.open('inbox', 'latency=0');
      await expect(mail.rows.first()).toBeVisible();
      const items = mail.nav.locator('.rail-item');
      await mail.inboxLink.focus();
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('ArrowUp');
      await expect(mail.inboxLink).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(mail.list.locator('[data-row-index]').first()).toBeFocused();
    });
  });

  test('a key changed in the shortcuts dialog runs its action, and the old one stops', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    await expect(mail.rows.first()).toBeVisible();
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();

    const archive = dialog.getByRole('button', { name: /^Change the key for Archive,/ });
    await archive.click();
    await expect(dialog.getByRole('button', { name: 'Press a key for Archive' })).toBeFocused();
    // Esc while listening cancels instead of closing the dialog.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(archive).toHaveAccessibleName('Change the key for Archive, now e or y');

    await archive.click();
    // Sequence starters are refused; the key keeps listening.
    await page.keyboard.press('g');
    await expect(dialog.getByText('Not g or *')).toBeVisible();
    // Star's key: Star is left without one.
    await page.keyboard.press('s');
    await expect(archive).toHaveAccessibleName('Change the key for Archive, now s');
    await expect(dialog.getByRole('button', { name: 'Change the key for Star or unstar, now none' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Reset keys' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.keyboard.press('j');
    await expect(mail.rows.first().locator('[data-row-index]')).toBeFocused();
    const label = await mail.rows.first().locator('[data-row-index]').getAttribute('aria-label');
    const before = await mail.rows.count();
    await page.keyboard.press('e');
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    // e is no longer Archive: the row is still there.
    await expect(page.getByLabel(label!, { exact: true })).toBeVisible();
    await expect(mail.rows).toHaveCount(before);
    await page.keyboard.press('s');
    await expect(mail.snackbar).toContainText('Conversation archived');
    await expect(page.getByLabel(label!, { exact: true })).toHaveCount(0);
    await expect(mail.rows).toHaveCount(before - 1);

    // Reset brings Gmail's keys back.
    await page.keyboard.press('?');
    await dialog.getByRole('button', { name: 'Reset keys' }).click();
    await expect(archive).toHaveAccessibleName('Change the key for Archive, now e or y');
    await expect(dialog.getByRole('button', { name: 'Reset keys' })).toHaveCount(0);
  });
});
