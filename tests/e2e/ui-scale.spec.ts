import type { FrameLocator, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Interface size zooms the app's frame from the host page, so these run in
// preview/frame.html, which hosts the preview the way Gmail's content script does.
test.use({ viewport: { width: 1366, height: 768 } });

/** Screen point of an element in the zoomed frame. Playwright's own frame mapping ignores the zoom, so clicks go through the mouse. */
async function point(page: Page, el: Locator) {
  const zoom = Number(await page.locator('iframe').evaluate((f) => (f as HTMLIFrameElement).style.zoom || 1));
  const r = await el.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
  return { x: (r.x + r.width / 2) * zoom, y: (r.y + r.height / 2) * zoom };
}

async function press(page: Page, el: Locator, button: 'left' | 'right' = 'left') {
  const { x, y } = await point(page, el);
  await page.mouse.click(x, y, { button });
}

const rect = (el: Locator) => el.evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);

const SIZES = ['80%', '90%', '100%', '110%', '125%'];

async function pickSize(page: Page, app: FrameLocator, size: string) {
  // The sheet slides in, so these click the elements themselves rather than a point on screen.
  await app.getByRole('banner').getByRole('button', { name: 'Settings' }).dispatchEvent('click');
  const sheet = app.getByRole('dialog', { name: 'Quick settings' });
  // The sheet's slider steps by key, applying each step.
  const slider = sheet.getByRole('slider', { name: 'Interface size' });
  await slider.focus();
  await page.keyboard.press('Home');
  for (let i = 0; i < SIZES.indexOf(size); i++) await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', size);
  await expect(page.locator('iframe')).toHaveCSS('zoom', String(Number(size.replace('%', '')) / 100));
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

for (const [size, zoom] of [
  ['80%', 0.8],
  ['125%', 1.25],
] as const) {
  test(`at ${size} the app fills the window and menus stay on their anchors`, async ({ mail, page }) => {
    await mail.page.goto('/preview/frame.html?latency=0#inbox');
    const app = page.frameLocator('iframe');
    await expect(app.getByRole('list', { name: 'Conversations' }).getByRole('listitem').first()).toBeVisible();
    await pickSize(page, app, size);
    await expect(page.locator('iframe')).toHaveCSS('zoom', String(zoom));

    const frame = page.frames()[1];
    // The frame lays out at the window's size over the zoom, and nothing scrolls.
    await expect
      .poll(() => frame.evaluate((z) => Math.abs(innerWidth - 1366 / z) <= 1 && Math.abs(innerHeight - 768 / z) <= 1, zoom))
      .toBe(true);
    expect(await frame.evaluate(() => devicePixelRatio)).toBeCloseTo(zoom, 2);
    expect(await frame.evaluate(() => [document.documentElement.scrollWidth - innerWidth, document.documentElement.scrollHeight - innerHeight])).toEqual([0, 0]);
    expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([1366, 768]);
    expect(await page.locator('iframe').evaluate((f) => [f.getBoundingClientRect().width, f.getBoundingClientRect().height].map(Math.round))).toEqual([1366, 768]);

    // A menu at the window's end opens under its button, inside the window.
    const account = app.locator('.account-btn');
    await press(page, account);
    const menu = app.getByRole('menu').first();
    await expect(menu).toBeVisible();
    await expect.poll(async () => {
      const [b, m] = [await rect(account), await rect(menu)];
      return Math.abs(m.top - b.bottom) < 8 && Math.abs(m.right - b.right) < 16 && m.right <= 1366 / zoom + 1;
    }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // A context menu opens at the pointer.
    const row = app.getByRole('list', { name: 'Conversations' }).getByRole('listitem').filter({ hasText: 'I GOT IT' }).first();
    await row.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const at = await point(page, row);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const context = app.getByRole('menu').first();
    await expect(context).toBeVisible();
    await expect.poll(async () => {
      const m = await rect(context);
      const x = at.x / zoom;
      return m.left <= x + 8 && m.left >= x - 8;
    }).toBe(true);
  });
}

test('the size comes back with a reload and goes back to 100%', async ({ mail, page }) => {
  await mail.page.goto('/preview/frame.html?latency=0#inbox');
  const app = page.frameLocator('iframe');
  await expect(app.getByRole('list', { name: 'Conversations' }).getByRole('listitem').first()).toBeVisible();
  await pickSize(page, app, '90%');
  await page.reload();
  // The host applies its own copy before the app loads, so the first frame is already at size.
  await expect(page.locator('iframe')).toHaveCSS('zoom', '0.9');
  await expect(app.getByRole('list', { name: 'Conversations' }).getByRole('listitem').first()).toBeVisible();
  await pickSize(page, app, '100%');
  await expect(page.locator('iframe')).toHaveCSS('zoom', '1');
});

test('outside a host page there is no Interface size', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  const sheet = page.getByRole('dialog', { name: 'Quick settings' });
  await expect(sheet.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  await expect(sheet.getByRole('slider', { name: 'Interface size' })).toHaveCount(0);
});

test('Settings changes the size as soon as it is picked', async ({ mail, page }) => {
  await mail.page.goto('/preview/frame.html?latency=0#inbox');
  const app = page.frameLocator('iframe');
  await expect(app.getByRole('list', { name: 'Conversations' }).getByRole('listitem').first()).toBeVisible();
  await app.getByRole('banner').getByRole('button', { name: 'Settings' }).dispatchEvent('click');
  await app.getByText('See all settings').dispatchEvent('click');
  await app.locator('.settings').getByText('Appearance', { exact: true }).first().dispatchEvent('click');
  const group = app.getByRole('radiogroup', { name: 'Interface size' });
  await group.getByRole('radio', { name: '110%' }).dispatchEvent('click');
  await expect(page.locator('iframe')).toHaveCSS('zoom', '1.1');
  // Still open, and every option's label fits.
  await expect(group.getByRole('radio', { name: '110%' })).toHaveAttribute('aria-checked', 'true');
  expect(await group.evaluate((g) => [...g.querySelectorAll('.button-group__item')].every((s) => s.scrollWidth <= s.clientWidth + 0.5))).toBe(true);
});

test('the command palette makes the interface smaller and larger', async ({ mail, page }) => {
  await mail.page.goto('/preview/frame.html?latency=0#inbox');
  const app = page.frameLocator('iframe');
  await expect(app.getByRole('list', { name: 'Conversations' }).getByRole('listitem').first()).toBeVisible();
  await app.locator('body').evaluate(() => window.focus());
  const input = app.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox');
  for (const [command, zoom] of [
    ['smaller interface', '0.9'],
    ['smaller interface', '0.8'],
    ['larger interface', '0.9'],
  ]) {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(input).toBeFocused();
    await input.fill(command);
    await page.keyboard.press('Enter');
    await expect(page.locator('iframe')).toHaveCSS('zoom', zoom);
  }
});

test('a browser that cannot zoom the frame goes back to 100% and drops the setting', async ({ mail, page }) => {
  await mail.page.goto('/preview/frame.html?latency=0#inbox');
  const app = page.frameLocator('iframe');
  await expect(app.getByRole('list', { name: 'Conversations' }).getByRole('listitem').first()).toBeVisible();
  await pickSize(page, app, '80%');
  // Stand in for an engine that left the frame's layout at the host's width.
  await page.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ source: 'better-gmail/content', type: 'scale', scale: 0.8, width: 2000 }, location.origin));
  await expect(page.locator('iframe')).toHaveCSS('zoom', '1');
  await expect(app.getByRole('region', { name: 'Notifications' })).toContainText("This browser can't change the interface size.");
  await app.getByRole('banner').getByRole('button', { name: 'Settings' }).dispatchEvent('click');
  const sheet = app.getByRole('dialog', { name: 'Quick settings' });
  await expect(sheet.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  await expect(sheet.getByRole('slider', { name: 'Interface size' })).toHaveCount(0);
});
