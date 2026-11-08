import { DEFAULT_SEED, expect, test } from './fixtures';

test.describe('quick filters', () => {
  test('Unread narrows the list to unread mail, the chip removes it, and a new view starts unfiltered', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const bodies = mail.list.locator('[data-row-index]');
    const labels = async () => bodies.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect((await labels()).some((l) => !l.startsWith('Unread, '))).toBe(true);

    await page.getByRole('button', { name: 'Filter conversations' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Unread' }).click();
    await page.keyboard.press('Escape');

    const chips = page.getByRole('toolbar', { name: 'Active filters' });
    await expect(chips.getByRole('button', { name: 'Unread', exact: true })).toBeVisible();
    await expect.poll(async () => (await labels()).every((l) => l.startsWith('Unread, '))).toBe(true);
    expect((await labels()).length).toBeGreaterThan(0);

    await chips.getByRole('button', { name: 'Remove Unread filter' }).click();
    await expect(chips).toHaveCount(0);
    await expect.poll(async () => (await labels()).some((l) => !l.startsWith('Unread, '))).toBe(true);

    await page.getByRole('button', { name: 'Filter conversations' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Starred' }).click();
    await page.keyboard.press('Escape');
    await expect(chips).toBeVisible();
    await mail.nav.getByRole('link', { name: /^Sent/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sent' })).toBeVisible();
    await expect(chips).toHaveCount(0);
  });
});

test.describe('pause inbox', () => {
  test.use({ seed: { ...DEFAULT_SEED, inboxPause: { since: Date.now() - 3 * 3600_000, until: null } } });

  test('mail that arrived during the pause waits behind the banner until Resume', async ({ mail, page }) => {
    await mail.open('inbox');
    const banner = page.getByRole('status').filter({ hasText: 'Inbox paused' });
    await expect(banner).toBeVisible();
    const waiting = Number(/(\d+) new conversations? (?:is|are) waiting/.exec(await banner.innerText())?.[1]);
    expect(waiting).toBeGreaterThan(0);
    const shown = await mail.rows.count();

    await banner.getByRole('button', { name: 'Resume' }).click();

    await expect(banner).toHaveCount(0);
    await expect(mail.rows).toHaveCount(shown + waiting);
  });
});

test.describe('navigation rail with a big inbox', () => {
  test.use({ seed: { ...DEFAULT_SEED, railExpanded: false } });

  test('the collapsed rail shows 999+ inside its edge, and the expanded rail lays items out in rows', async ({ mail, page }) => {
    await mail.open('inbox', 'unread');
    const rail = page.locator('nav.rail');
    const badge = rail.locator('.rail-badge');
    await expect(badge).toHaveText('999+');
    const [r, b] = await Promise.all([rail.boundingBox(), badge.boundingBox()]);
    expect(b!.x + b!.width).toBeLessThanOrEqual(r!.x + r!.width);
    expect(b!.y).toBeGreaterThanOrEqual(r!.y);

    await mail.nav.getByRole('button', { name: 'Expand menu' }).click();
    const inbox = mail.inboxLink;
    await expect(inbox).toContainText('1,');
    const [label, count] = await Promise.all([
      inbox.locator('.rail-item__label').boundingBox(),
      inbox.locator('.rail-item__count').boundingBox(),
    ]);
    // Count on the same line as the name, to its right.
    expect(Math.abs(label!.y + label!.height / 2 - (count!.y + count!.height / 2))).toBeLessThan(2);
    expect(count!.x).toBeGreaterThan(label!.x + label!.width);
  });
});

test.describe('collapsed rail on desktop', () => {
  test.use({ seed: { ...DEFAULT_SEED, railExpanded: false }, viewport: { width: 1440, height: 900 } });

  test('More opens the modal rail on the More destinations; Escape and a destination close it', async ({ mail, page }) => {
    await mail.open('inbox');
    const more = mail.nav.getByRole('link', { name: 'More' });
    const modal = page.getByRole('dialog', { name: 'Menu' });

    await more.click();
    await expect(modal.getByRole('link', { name: 'Important' })).toBeFocused();
    await expect(modal.getByRole('link', { name: 'Trash' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);

    await more.click();
    await modal.getByRole('link', { name: 'Trash' }).click();
    await expect(modal).toHaveCount(0);
    await expect(page).toHaveURL(/#trash$/);
    await expect(mail.nav.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  test('only the menu button changes the rail: hovering does not expand it, and Compose just opens a draft', async ({ mail, page }) => {
    await mail.open('inbox');
    const width = () => mail.nav.evaluate((el) => el.getBoundingClientRect().width);
    await expect.poll(width).toBe(96);

    await mail.nav.getByRole('link', { name: /^Starred/ }).hover();
    await page.waitForTimeout(700);
    expect(await width()).toBe(96);
    await expect(mail.inboxLink.locator('.rail-item__count')).toBeHidden();

    await mail.nav.getByRole('button', { name: 'Compose' }).click();
    const compose = page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
    await expect(compose).toHaveAccessibleName('New message');
    await page.waitForTimeout(500);
    expect(await width()).toBe(96);
    await expect(mail.nav.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false');
  });
});

test('tracking pixels are removed from newsletters and the message says so', async ({ mail, page }) => {
  await mail.open('category/promotions/p-stride-2');
  await expect(mail.thread.getByText('1 tracker blocked')).toBeVisible();
  const pixels = await page
    .frameLocator('iframe.msg__frame')
    .first()
    .locator('img[src*="/wf/open"]')
    .count();
  expect(pixels).toBe(0);
});

test('the rail owns its menu button: it collapses the rail to icons and expands it again', async ({ mail, page }) => {
  await mail.open('inbox');
  const toggle = mail.nav.getByRole('button', { name: 'Collapse menu' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(mail.inboxLink.locator('.rail-item__count')).toBeVisible();

  await toggle.click();
  const expand = mail.nav.getByRole('button', { name: 'Expand menu' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(mail.inboxLink.locator('.rail-item__count')).toBeHidden();
  await expect.poll(() => mail.nav.evaluate((el) => el.getBoundingClientRect().width)).toBe(96);

  await expand.click();
  await expect(mail.nav.getByRole('button', { name: 'Collapse menu' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Main menu' })).toHaveCount(0);
});

test('Select lives in the list app bar menu and selects the unread rows', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const unread = await mail.list.locator('[data-row-index][aria-label^="Unread, "]').count();
  await page.getByRole('toolbar', { name: 'List actions' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Select' }).click();
  await page.getByRole('menuitem', { name: 'Unread' }).click();
  await expect(page.locator('.selection-bar__count')).toHaveText(`${unread} selected`);
});

test('an attachment chip on a list row previews the file without opening the conversation', async ({ mail, page }) => {
  await mail.open('inbox');
  const chip = mail.rows.getByRole('button', { name: /^Preview staging-naming-step/ }).first();
  await chip.click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toContainText('staging-naming-step.png');
  await expect(page).not.toHaveURL(/#inbox\//);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(page).not.toHaveURL(/#inbox\//);

  // The dark area around the file closes it too, like the scrim behind a dialog.
  await chip.click();
  await expect(viewer).toBeVisible();
  const stage = (await viewer.locator('.viewer__stage').boundingBox())!;
  await page.mouse.click(stage.x + 24, stage.y + stage.height - 16);
  await expect(viewer).toBeHidden();
  await expect(page).not.toHaveURL(/#inbox\//);
});

test('a chip that only informs (a deal\'s discount or deadline) opens the row like the rest of it', async ({ mail, page }) => {
  await mail.open('category/promotions');
  const chip = mail.rows.locator('.smart-chip--static').first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).toHaveURL(/#category\/promotions\/.+/);
  await expect(mail.threadHeading).toBeVisible();
});

test('the Support menu and the command palette open the project on GitHub', async ({ mail, page, context }) => {
  await context.route('https://github.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>GitHub</title>' }));
  await mail.open('inbox');
  await page.getByRole('button', { name: 'Support' }).click();
  let popup = page.waitForEvent('popup');
  await page.getByRole('menuitem', { name: 'Expressive Gmail on GitHub' }).click();
  expect((await popup).url()).toBe('https://github.com/slukedev/expressive-gmail');

  await page.keyboard.press('Control+k');
  await page.keyboard.type('github');
  popup = page.waitForEvent('popup');
  await page.keyboard.press('Enter');
  expect((await popup).url()).toBe('https://github.com/slukedev/expressive-gmail');
});
