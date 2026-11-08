import { DEFAULT_SEED, expect, test } from './fixtures';

test.describe('at a glance', () => {
  test('the empty reading pane lists what wants a look, and each row opens its conversation', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    const glance = page.getByRole('region', { name: 'At a glance' });
    await expect(glance.getByRole('heading', { name: /^Good (morning|afternoon|evening), Alex$/ })).toBeVisible();

    // The Ledgerly code sits in Updates, out of sight behind the bundle; the board brings it forward.
    const look = glance.getByRole('heading', { name: 'Worth a look' });
    await expect(look).toBeVisible();
    await expect(glance.getByRole('button', { name: /Code 482 913/ })).toBeVisible();
    // Oakline's parcel was delivered after its "Out for delivery" email, so only Stride's shows, as on Purchases.
    const stride = glance.getByRole('button', { name: /Shipped Stride & Co\./ });
    await expect(stride).toBeVisible();
    await expect(glance.getByRole('button', { name: /Out for delivery/ })).toHaveCount(0);
    // With rows to show, no sentence restates them.
    await expect(glance.locator('.glance__summary')).toHaveCount(0);

    await stride.click();
    await expect(mail.thread.getByRole('heading', { level: 1, name: /Stride & Co\. order is on the way/ })).toBeVisible();
    await expect(glance).toHaveCount(0);

    // Closing the conversation brings the board back without replaying its entrance.
    await page.keyboard.press('u');
    await expect(glance).toBeVisible();
    await expect(glance.locator('.glance')).toHaveAttribute('data-settled', '');
  });

  test('Worth a look leaves out what is already over and shows a package at its newest status', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    const glance = page.getByRole('region', { name: 'At a glance' });
    await expect(glance.getByRole('heading', { name: 'Worth a look' })).toBeVisible();
    // Hollowpine's order said "Shipped", then "Out for delivery"; Swiftlane delivered it today, so it reads Delivered.
    await expect(glance.getByRole('button', { name: /^Delivered Hollowpine Outfitters/ })).toBeVisible();
    await expect(glance.getByRole('button', { name: /Hollowpine/ })).toHaveCount(1);
    // Last month's Larkspur orders, delivered or never heard from again, are history.
    await expect(glance.getByRole('button', { name: /Larkspur/ })).toHaveCount(0);
    await expect(glance.getByRole('button', { name: /Running late/ })).toHaveCount(0);
    // Oakline arrived two days ago: good to know then, not now.
    await expect(glance.getByRole('button', { name: /Oakline/ })).toHaveCount(0);
  });

  test('Copy puts a fresh code on the clipboard without opening the email', async ({ mail, page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'Clipboard permissions are Chromium-only in Playwright');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await mail.open('inbox', 'latency=0');
    const glance = page.getByRole('region', { name: 'At a glance' });
    const copy = glance.getByRole('button', { name: 'Copy code 482 913' });
    await copy.click();
    // Copy confirms in place: the chip turns to its Copied state and a screen reader hears the code.
    await expect(copy).toHaveAttribute('data-confirmed', 'true');
    await expect(copy.getByText('Copied', { exact: true })).toBeVisible();
    await expect(mail.announced('Code 482 913 copied')).toHaveCount(1);
    await expect(mail.snackbar).not.toContainText('copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('482913');
    await expect(glance).toBeVisible();
  });

  test('selecting rows swaps the board for the selection summary', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    await expect(page.getByRole('region', { name: 'At a glance' })).toBeVisible();
    await mail.list.locator('.row__lead').nth(0).click();
    await expect(page.getByRole('region', { name: 'Reading pane' })).toContainText('1 selected');
    await expect(page.getByRole('region', { name: 'At a glance' })).toHaveCount(0);
  });
});

test.describe('at a glance turned off', () => {
  test.use({ seed: { ...DEFAULT_SEED, glance: false } });

  test('the reading pane goes back to the plain empty state', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    await expect(page.getByRole('region', { name: 'Reading pane' })).toContainText('No conversation selected');
    await expect(page.getByRole('region', { name: 'At a glance' })).toHaveCount(0);
  });
});

test.describe('date groups', () => {
  test('the inbox breaks into newest-first sections and j still walks every row in order', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    await expect(mail.rows.first()).toBeVisible();
    const headings = mail.list.locator('.list-group > h2');
    const titles = await headings.allInnerTexts();
    expect(titles[0]).toBe('Today');
    expect(titles).toContain('Yesterday');
    // Sections never repeat, so each date lands in one place.
    expect(new Set(titles).size).toBe(titles.length);

    // Keyboard order runs straight through the section breaks.
    const indices = await mail.list.locator('[data-row-index]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-row-index'))));
    expect(indices).toEqual(indices.map((_, i) => i));
    const firstInSecond = mail.list.locator('.list-group').nth(1).locator('[data-row-index]').first();
    const target = Number(await firstInSecond.getAttribute('data-row-index'));
    for (let i = 0; i <= target; i++) await page.keyboard.press('j');
    await expect(firstInSecond).toHaveAttribute('data-cursor');
  });

  test.describe('turned off', () => {
    test.use({ seed: { ...DEFAULT_SEED, groupByDate: false } });
    test('the list is one run again', async ({ mail }) => {
      await mail.open('inbox', 'latency=0');
      await expect(mail.rows.first()).toBeVisible();
      await expect(mail.list.locator('.list-group')).toHaveCount(0);
    });
  });

  test.describe('in a reordered inbox', () => {
    test.use({ seed: { ...DEFAULT_SEED, inboxType: 'unread-first' } });
    test('Unread first keeps its order and skips date sections', async ({ mail }) => {
      await mail.open('inbox', 'latency=0');
      await expect(mail.rows.first()).toBeVisible();
      await expect(mail.list.locator('.list-group')).toHaveCount(0);
    });
  });
});

test.describe('thread motion', () => {
  test('opening a collapsed message grows its card instead of jumping, and the folded middle unfolds', async ({ mail, page }) => {
    await mail.open('inbox/t-onboarding-v4', 'latency=0');
    const fold = mail.thread.getByRole('button', { name: /older messages/ });
    await expect(fold).toBeVisible();
    await fold.click();
    await expect(mail.thread.locator('.msg[data-reveal]').first()).toBeVisible();
    await expect(mail.thread.locator('.msg[data-reveal]')).toHaveCount(0, { timeout: 3000 });

    const collapsed = mail.thread.locator('.msg--collapsed[data-mid]').first();
    const id = await collapsed.getAttribute('data-mid');
    // Record height animations as they start, so a busy machine can't finish one before we look.
    await page.evaluate(() => {
      const w = window as unknown as { heights: string[] };
      w.heights = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        const frames = keyframes as Keyframe[];
        if (Array.isArray(frames) && frames[0]?.height) w.heights.push(`${(this as HTMLElement).dataset.mid}:${frames[0].height}->${frames[frames.length - 1]!.height}`);
        return animate.call(this, keyframes, options);
      };
    });
    await collapsed.click();
    const card = mail.thread.locator(`[data-mid="${id}"]`);
    await expect(card).toHaveClass(/msg--expanded/);
    // The card holds its height until its email has measured itself, then grows once.
    const recorded = () => page.evaluate(() => (window as unknown as { heights: string[] }).heights);
    await expect.poll(recorded).toHaveLength(1);
    const heights = await recorded();
    const [, from, to] = /:(\d+(?:\.\d+)?)px->(\d+(?:\.\d+)?)px/.exec(heights[0]!)!;
    expect(heights[0]).toContain(`${id}:`);
    expect(Number(to)).toBeGreaterThan(Number(from));
  });
});
