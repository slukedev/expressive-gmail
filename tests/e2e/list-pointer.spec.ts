import { expect, test } from './fixtures';

test.describe('working down the list with the pointer', () => {
  test('archive, then click again without moving the mouse: the next row archives', async ({ mail, page }) => {
    await mail.open('inbox');
    const first = mail.rows.nth(0);
    await expect(first).toBeVisible();
    const subjects = await mail.rows.locator('.row__subject-text').allInnerTexts();

    await first.hover();
    const box = (await first.getByRole('button', { name: 'Archive', exact: true }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    for (let i = 0; i < 3; i++) {
      await page.mouse.down();
      await page.mouse.up();
      await expect(mail.row(subjects[i])).toHaveCount(0);
      // The row that slid in under the still pointer is the hovered one, whatever the browser thinks.
      await expect(mail.rows.nth(0).locator('[data-row-index]')).toHaveAttribute('data-hover', '');
      await expect(mail.rows.nth(0).getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
    }
    await expect(mail.rows.nth(0)).toContainText(subjects[3]);
    await expect(mail.snackbar).toContainText('Conversation archived');
  });

  test('a quick double click archives one row and never brings it back', async ({ mail }) => {
    await mail.open('inbox');
    const first = mail.rows.nth(0);
    await expect(first).toBeVisible();
    const [a, b] = await mail.rows.locator('.row__subject-text').allInnerTexts();

    await first.hover();
    await first.getByRole('button', { name: 'Archive', exact: true }).dblclick();

    await expect(mail.row(a)).toHaveCount(0);
    await expect(mail.rows.nth(0)).toContainText(b);
    await expect(mail.snackbar).not.toContainText('moved to Inbox');
  });

  test('Shift previews the range from the last checked row, and Shift-click applies its state', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.nth(4)).toBeVisible();
    const lead = (i: number) => mail.rows.nth(i).locator('.row__lead');
    const body = (i: number) => mail.rows.nth(i).locator('[data-row-index]');

    await lead(1).click();
    await body(4).hover();
    await expect(mail.list.locator('[data-range]')).toHaveCount(0);

    await page.keyboard.down('Shift');
    await page.mouse.move(0, 0, { steps: 1 });
    await body(4).hover();
    await expect(mail.list.locator('[data-range="add"]')).toHaveCount(3);
    await page.keyboard.up('Shift');
    await expect(mail.list.locator('[data-range]')).toHaveCount(0);

    await lead(4).click({ modifiers: ['Shift'] });
    await expect(page.getByRole('toolbar', { name: '4 selected' })).toBeVisible();
    // Shift-click is a selection, not a text selection.
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');

    // Uncheck row 2: it becomes the anchor, and the range takes its unchecked state.
    await lead(2).click();
    await lead(4).click({ modifiers: ['Shift'] });
    await expect(page.getByRole('toolbar', { name: '1 selected' })).toBeVisible();
    await expect(body(1)).toHaveClass(/row--selected/);
  });
});

test.describe('archiving a whole date section', () => {
  test('its header folds away with the rows, and nothing below jumps when they leave', async ({ mail, page }) => {
    await mail.open('inbox');
    const today = page.locator('.list-group').first();
    await expect(today.locator('.list-section')).toHaveText('Today');
    const next = (await page.locator('.list-group').nth(1).locator('.list-section').innerText()).trim();
    const leads = today.locator('.row__lead');
    await leads.first().click();
    await leads.last().click({ modifiers: ['Shift'] });
    await page.locator('.list-scroll').evaluate((el) => el.scrollTo({ top: 0 }));
    await page.mouse.move(1, 1);

    // The next header's position on every frame, through the collapse and the moment the rows leave the cache.
    await page.evaluate((title) => {
      const w = window as unknown as { tops: number[] };
      w.tops = [];
      const start = performance.now();
      const tick = () => {
        const h = [...document.querySelectorAll('.list-section')].find((x) => x.textContent?.trim() === title);
        if (h) w.tops.push(h.getBoundingClientRect().top);
        if (performance.now() - start < 1200) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, next);
    await page.keyboard.press('e');
    await expect(page.locator('.list-section', { hasText: 'Today' })).toHaveCount(0);
    await page.waitForTimeout(1300);

    const tops = await page.evaluate(() => (window as unknown as { tops: number[] }).tops);
    const steps = tops.slice(1).map((t, i) => Math.abs(t - tops[i]));
    // The header moved up with the collapse...
    expect(steps.some((d) => d > 1)).toBe(true);
    // ...and never sat still and then jumped, which is how a section unmounting late shows. (A big
    // collapse can repeat a frame or two on its way; four still frames is a stop.)
    let still = 0;
    let moving = false;
    for (const d of steps) {
      // Before the collapse starts the header is meant to be still.
      if (d > 1 && moving) expect(still, `a ${Math.round(d)}px jump after ${still} still frames`).toBeLessThan(4);
      if (d > 1) moving = true;
      still = d < 0.5 ? still + 1 : 0;
    }
    // It comes to rest where it ends.
    expect(Math.abs(tops.at(-1)! - tops.at(-6)!)).toBeLessThan(1);
    await expect(page.getByRole('toolbar', { name: /selected$/ })).toHaveCount(0);
  });
});

test.describe('an empty inbox with replies set aside', () => {
  test('says how many replies are waiting instead of "all caught up", until one comes off the stack', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('j');
      await page.keyboard.press('Shift+L');
      await expect(mail.snackbar).toContainText('Moved to Reply later');
    }
    const empty = page.getByRole('heading', { name: '2 replies to write' });
    for (let i = 0; i < 10 && !(await empty.isVisible()); i++) {
      await page.keyboard.press('*');
      await page.keyboard.press('a');
      await page.keyboard.press('e');
      await page.waitForTimeout(700);
    }
    await expect(empty).toBeVisible();
    await expect(page.getByText("You're all caught up")).toHaveCount(0);
    // Archived rows leave the selection with them.
    await expect(page.getByRole('toolbar', { name: /selected$/ })).toHaveCount(0);

    await page.getByRole('button', { name: "See who's waiting" }).click();
    const stack = page.getByRole('region', { name: 'Reply later' });
    await expect(stack.getByRole('button', { expanded: true })).toBeVisible();
    await expect(page.getByRole('button', { name: "See who's waiting" })).toHaveCount(0);

    // Taken off the stack, a conversation is back in the inbox, so the inbox isn't empty any more.
    await stack.getByRole('button', { name: 'Done, remove from Reply later' }).first().click();
    await expect(mail.list.locator('[data-row-index]')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: /to write$/ })).toHaveCount(0);
  });
});
