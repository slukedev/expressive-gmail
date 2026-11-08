import { expect, test } from './fixtures';

test('Dark theme from Quick settings applies at once and survives a reload', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme-mode', 'light');
  const lightBg = await page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);

  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Quick settings' });
  await expect(sheet).toBeVisible();
  const dark = sheet.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' });
  await dark.click();

  await expect(dark).toHaveAttribute('aria-checked', 'true');
  await expect(html).toHaveAttribute('data-theme-mode', 'dark');
  await expect.poll(() => page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(lightBg);

  await page.reload();

  await expect(mail.rows.first()).toBeVisible();
  await expect(html).toHaveAttribute('data-theme-mode', 'dark');
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Quick settings' }).getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
});

test('Search settings filters to the real controls, links to list sections, and Escape clears before it closes', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: /settings/i }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const search = dialog.getByRole('searchbox', { name: 'Search settings' });
  await expect(search).toBeVisible();

  await search.fill('compact');
  await expect(dialog.getByRole('heading', { name: 'Search results' })).toBeVisible();
  // The match is the working control, not a link to it.
  const density = dialog.getByRole('radiogroup', { name: 'Density' });
  await density.getByRole('radio', { name: 'Compact' }).click();
  await expect(density.getByRole('radio', { name: 'Compact' })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByText('Undo send')).toHaveCount(0);

  await search.fill('label');
  await dialog.getByRole('region', { name: 'Other sections' }).getByRole('button', { name: /^Labels/ }).click();
  await expect(search).toHaveValue('');
  await expect(dialog.getByRole('heading', { name: 'Labels', level: 2 })).toBeVisible();

  await search.fill('qwerty');
  await expect(dialog.getByText('No settings match “qwerty”')).toBeVisible();
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(dialog).toBeVisible();
  await search.press('Escape');
  await expect(dialog).toBeHidden();
});

async function openAllSettings(page: import('@playwright/test').Page) {
  await page.locator('.account-btn').click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'All settings' }).click();
  return page.getByRole('dialog', { name: 'Settings' });
}

test('a dialog opened from Settings dims Settings with its own scrim', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const settings = await openAllSettings(page);
  await expect(page.locator('.m3-scrim')).toHaveCount(1);
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Labels' }).click();
  await settings.getByRole('button', { name: 'Create new label' }).click();
  await expect(page.getByRole('dialog', { name: /label/i }).last()).toBeVisible();
  await expect(page.locator('.m3-scrim')).toHaveCount(2);
  // The second scrim lies over Settings, not under it.
  const top = await page.evaluate(() => {
    const scrims = document.querySelectorAll('.m3-scrim');
    const r = document.querySelector('.settings')!.getBoundingClientRect();
    return document.elementFromPoint(r.left + 40, r.top + 40) === scrims[scrims.length - 1];
  });
  expect(top).toBe(true);
});

test('the sidebar ends with the way back to classic Gmail', async ({ mail, page }) => {
  await mail.open('inbox');
  const settings = await openAllSettings(page);
  const nav = settings.getByRole('navigation', { name: 'Settings sections' });
  const classic = nav.getByRole('button', { name: 'Switch to classic Gmail' });
  await expect(classic).toBeVisible();
  // Below every section, at the foot of the sidebar.
  const sections = await nav.locator('.settings__sections').boundingBox();
  const foot = await classic.boundingBox();
  expect(foot!.y).toBeGreaterThan(sections!.y + sections!.height);
  // Search finds it too.
  await settings.getByRole('searchbox', { name: 'Search settings' }).fill('classic');
  await expect(settings.getByRole('region', { name: 'Other sections' }).getByRole('button', { name: /Switch to classic Gmail/ })).toBeVisible();
});

test.describe('a connection that can’t edit labels', () => {
  test.use({ query: 'latency=0&labels=readonly' });

  test('has no Labels section, in the sidebar, in search or in the command palette', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const settings = await openAllSettings(page);
    const nav = settings.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav.getByRole('button', { name: 'Splits' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Labels' })).toHaveCount(0);
    await settings.getByRole('searchbox', { name: 'Search settings' }).fill('label');
    await expect(settings.getByRole('button', { name: /^Labels/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('combobox').fill('manage');
    await expect(palette.getByRole('option', { name: /Manage splits/ })).toBeVisible();
    await expect(palette.getByRole('option', { name: /Manage labels/ })).toHaveCount(0);
  });
});

test('closing Settings after changing the inbox type reloads the list and keeps the open conversation where it was', async ({ mail, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const list = page.locator('.list-scroll');
  await list.evaluate((el) => (el.scrollTop = 400));
  const target = mail.rows.locator('[data-row-index]').nth(9);
  await target.click();
  const active = list.locator('.row[aria-current="true"]');
  await expect(active).toBeVisible();
  const offset = () => active.evaluate((row) => Math.round(row.getBoundingClientRect().top - row.closest('.list-scroll')!.getBoundingClientRect().top));
  const before = await offset();
  const subject = await active.getAttribute('aria-label');

  const settings = await openAllSettings(page);
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Inbox', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Inbox type' }).click();
  await page.getByRole('option', { name: 'Unread first' }).click();
  await settings.getByRole('button', { name: 'Close settings' }).last().click();
  await expect(settings).toBeHidden();

  // Same conversation, still open, back at the same height in the list.
  await expect(active).toHaveAttribute('aria-label', subject!);
  await expect.poll(offset).toBeGreaterThan(before - 4);
  expect(await offset()).toBeLessThan(before + 4);
});

test('Your own color themes the app as you pick it, and comes back after a preset', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim());
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  const colors = page.getByRole('dialog', { name: 'Quick settings' }).getByRole('group', { name: 'Colors' });
  const google = await primary();

  await colors.getByLabel('Pick your own color').fill('#e91e63');
  await expect.poll(primary).not.toBe(google);
  const mine = await primary();
  await expect(colors.getByLabel('Change your color')).toBeVisible();

  await colors.getByRole('button', { name: 'Teal' }).click();
  await expect(colors.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(primary).not.toBe(mine);

  // A click on a kept colour brings it back rather than opening the picker.
  await colors.getByLabel('Your color').click();
  await expect(colors.getByLabel('Change your color')).toBeVisible();
  await expect(colors.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(primary).toBe(mine);

  await page.reload();
  await expect(mail.rows.first()).toBeVisible();
  await expect.poll(primary).toBe(mine);
});

test('Random color rolls a new theme on every click, in Quick settings and Settings alike', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim());
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Quick settings' });
  const colors = sheet.getByRole('group', { name: 'Colors' });

  // Swatches are discs at every width (Safari once stretched them into ovals).
  await expect(colors.getByRole('button', { name: 'Random color' })).toBeVisible();
  // Layout sizes, untouched by the sheet's opening scale.
  const shapes = await colors.locator('.swatch-wallpaper').evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetWidth === (e as HTMLElement).offsetHeight));
  expect(shapes).not.toContain(false);

  const seen = [await primary()];
  await colors.getByRole('button', { name: 'Random color' }).click();
  const again = colors.getByRole('button', { name: 'Another random color' });
  await expect(again).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(primary).not.toBe(seen[0]);
  seen.push(await primary());
  await again.click();
  await expect.poll(primary).not.toBe(seen[1]);

  // Settings shows the same roll as chosen, and a preset hands the choice back.
  await sheet.getByRole('button', { name: 'See all settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('button', { name: 'Appearance' }).click();
  await expect(settings.getByRole('button', { name: 'Another random color' })).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('button', { name: 'Teal' }).click();
  await expect(settings.getByRole('button', { name: 'Random color' })).toHaveAttribute('aria-pressed', 'false');
});

test('A random theme gives each tab its own color, and a new tab leaves the open ones alone', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const primary = (p: typeof page) => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-primary').trim());
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'Random color' }).click();
  await expect.poll(() => primary(page)).not.toBe('');
  await page.waitForTimeout(500);
  const first = await primary(page);

  const other = await page.context().newPage();
  await other.goto(page.url());
  await expect(other.getByRole('main').locator('.row').first()).toBeVisible();
  await expect.poll(() => primary(other)).not.toBe(first);
  // The new tab's roll is saved for the next load, but the open tab keeps its colour.
  await page.waitForTimeout(800);
  expect(await primary(page)).toBe(first);
});
