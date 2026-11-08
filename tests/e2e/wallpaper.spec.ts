import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** A colourful PNG drawn in the page: stripes over a red-to-yellow field. */
async function stripesPng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 500;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 800, 0);
    g.addColorStop(0, '#c62828');
    g.addColorStop(1, '#f9a825');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 800, 500);
    ctx.fillStyle = '#111';
    for (let x = 0; x < 800; x += 6) ctx.fillRect(x, 0, 3, 500);
    return c.toDataURL('image/png').split(',')[1]!;
  });
  return Buffer.from(b64, 'base64');
}

type Stored = { themeSource?: string; seed?: string; wallpaper?: string; wallpaperColors?: string[] };
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('bg.settings.v1') ?? '{}') as Stored);

/** Drops a file on an element the way a browser does. */
async function dropOn(el: import('@playwright/test').Locator, b64: string, name: string, type: string) {
  await el.evaluate(
    (node, [b64, name, type]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name, { type }));
      for (const t of ['dragenter', 'dragover', 'drop']) node.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    },
    [b64, name, type] as const,
  );
}

test('At a glance shows your profile photo in the grown mark, and its colours only on request', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const glance = page.getByRole('region', { name: 'At a glance' });
  const profile = glance.getByRole('button', { name: 'Your profile photo, options' });
  await expect(profile.locator('img')).toHaveAttribute('src', /^data:image\/svg/);
  expect((await stored(page)).themeSource ?? 'google').toBe('google');

  // The mark's own layout: grown, with the date below it on the same left edge.
  const box = (await profile.boundingBox())!;
  const date = (await glance.locator('.glance__date').boundingBox())!;
  expect(box.width).toBeGreaterThan(88);
  expect(date.y).toBeGreaterThan(box.y + box.height);
  expect(Math.abs(date.x - box.x)).toBeLessThan(2);

  await profile.click();
  await expect(page.getByRole('menuitem')).toHaveText([/Crop and shape$/, /Change picture$/, /Use colors from this picture$/]);
  await page.getByRole('menuitem', { name: 'Use colors from this picture' }).click();
  await expect.poll(async () => (await stored(page)).themeSource).toBe('dynamic');

  // Quick settings offers the same colours as one more choice, already picked.
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  const qs = page.getByRole('dialog', { name: 'Quick settings' });
  await expect(qs.getByRole('button', { name: 'From your picture' })).toHaveAttribute('aria-pressed', 'true');
  await expect(qs.getByText('Colors from a picture')).toHaveCount(0);
  await qs.getByRole('button', { name: 'Google' }).click();
  await expect.poll(async () => (await stored(page)).themeSource).toBe('google');
  await qs.getByRole('button', { name: 'See all settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('button', { name: 'Appearance' }).click();
  await expect(dialog.getByRole('list', { name: 'Pictures' })).toHaveCount(0);
  await dialog.getByRole('radio', { name: 'From your picture' }).click();
  await expect.poll(async () => (await stored(page)).themeSource).toBe('dynamic');
});

test('a picture dropped on At a glance replaces the profile photo, survives a reload, and goes back', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const glance = page.getByRole('region', { name: 'At a glance' });
  await dropOn(glance.getByRole('button', { name: 'Your profile photo, options' }), (await stripesPng(page)).toString('base64'), 'stripes.png', 'image/png');
  // It opens in the editor first, and is kept only on Save.
  const editor = page.getByRole('dialog', { name: 'Crop your picture' });
  await expect(editor).toBeVisible();
  expect((await stored(page)).wallpaper ?? '').toBe('');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  const picture = glance.getByRole('button', { name: 'Your picture, options' });
  await expect(picture.locator('img')).toHaveAttribute('src', /^blob:/);
  // It doesn't recolour the app by itself.
  expect((await stored(page)).themeSource ?? 'google').toBe('google');
  const colors = (await stored(page)).wallpaperColors!;
  expect(colors.length).toBeGreaterThan(0);

  await picture.click();
  await expect(page.getByRole('menuitem')).toHaveText([/Crop and shape$/, /Change picture$/, /Use colors from this picture$/, /Use your profile photo$/]);
  await page.getByRole('menuitem', { name: 'Use colors from this picture' }).click();
  await expect.poll(async () => (await stored(page)).seed).toBe(colors[0]);
  if (colors.length > 1) {
    await picture.click();
    await page.getByRole('menuitem', { name: 'Shuffle colors from this picture' }).click();
    await expect.poll(async () => (await stored(page)).seed).toBe(colors[1]);
  }

  await page.reload();
  await expect(mail.rows.first()).toBeVisible();
  await expect(picture.locator('img')).toHaveAttribute('src', /^blob:/);

  await picture.click();
  await page.getByRole('menuitem', { name: 'Use your profile photo' }).click();
  await expect(glance.getByRole('button', { name: 'Your profile photo, options' }).locator('img')).toHaveAttribute('src', /^data:image\/svg/);
  expect((await stored(page)).wallpaper).toBe('');
  // The picture is gone from this browser, not just hidden.
  await page.reload();
  await expect(glance.getByRole('button', { name: 'Your profile photo, options' })).toBeVisible();
});

test('the command palette changes the picture and offers its colours', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'At a glance' }).getByRole('button', { name: 'Your profile photo, options' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('picture');
  const list = page.getByRole('listbox');
  await expect(list.getByRole('option', { name: /Change picture/ })).toBeVisible();
  await list.getByRole('option', { name: /Use colors from this picture/ }).click();
  await expect.poll(async () => (await stored(page)).themeSource).toBe('dynamic');
});

test('a file that is not a picture is refused in plain words', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const glance = page.getByRole('region', { name: 'At a glance' });
  await dropOn(glance.getByRole('button', { name: 'Your profile photo, options' }), Buffer.from('not really a jpeg').toString('base64'), 'broken.jpg', 'image/jpeg');
  await expect(mail.snackbar).toContainText("This picture couldn't be opened");
  expect((await stored(page)).wallpaper ?? '').toBe('');
});

test('a new picture is cropped and shaped before it is kept, and Cancel keeps nothing', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const glance = page.getByRole('region', { name: 'At a glance' });
  const png = (await stripesPng(page)).toString('base64');
  await dropOn(glance.getByRole('button', { name: 'Your profile photo, options' }), png, 'stripes.png', 'image/png');
  const editor = page.getByRole('dialog', { name: 'Crop your picture' });
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toBeHidden();
  await expect(glance.getByRole('button', { name: 'Your profile photo, options' })).toBeVisible();
  expect((await stored(page)).wallpaper ?? '').toBe('');

  await dropOn(glance.getByRole('button', { name: 'Your profile photo, options' }), png, 'stripes.png', 'image/png');
  const zoom = editor.getByRole('slider', { name: 'Zoom' });
  await expect(zoom).toHaveAttribute('aria-valuenow', '1');
  await editor.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => Number(await zoom.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
  // The shapes are one radio group: arrow keys move the choice.
  const shapes = editor.getByRole('radiogroup', { name: 'Shape' });
  await expect(shapes.getByRole('radio', { name: 'Cookie' })).toHaveAttribute('aria-checked', 'true');
  await shapes.getByRole('radio', { name: 'Cookie' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(shapes.getByRole('radio', { name: 'Circle' })).toHaveAttribute('aria-checked', 'true');
  await expect(shapes.getByRole('radio', { name: 'Circle' })).toBeFocused();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();

  const settings = (await stored(page)) as Stored & { pictureShape?: string; pictureCrop?: { for: string; width: number } };
  expect(settings.pictureShape).toBe('Circle');
  expect(settings.pictureCrop?.for).toBe(settings.wallpaper);
  // 800 x 500 at zoom 1 is a 500 px square, 0.625 of the width; zoomed in, less.
  expect(settings.pictureCrop!.width).toBeLessThan(0.625);

  // Editing again starts from what was saved; Reset goes back to the crop made for it.
  await glance.getByRole('button', { name: 'Your picture, options' }).click();
  await page.getByRole('menuitem', { name: 'Crop and shape' }).click();
  const again = page.getByRole('dialog', { name: 'Crop and shape' });
  await expect(again.getByRole('radio', { name: 'Circle' })).toHaveAttribute('aria-checked', 'true');
  expect(Number(await again.getByRole('slider', { name: 'Zoom' }).getAttribute('aria-valuenow'))).toBeGreaterThan(1);
  await again.getByRole('button', { name: 'Reset' }).click();
  await expect(again.getByRole('slider', { name: 'Zoom' })).toHaveAttribute('aria-valuenow', '1');
  await expect(again.getByRole('button', { name: 'Reset' })).toBeDisabled();
});

test('the unread count on the picture narrows the inbox to unread, and back', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  const unread = await mail.inboxUnread();
  const glance = page.getByRole('region', { name: 'At a glance' });
  const badge = glance.getByRole('button', { name: `${unread} unread. Show only unread` });
  await expect(badge).toHaveAttribute('aria-pressed', 'false');
  await badge.click();
  await expect(glance.getByRole('button', { name: /Showing only unread/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^Filters: Unread/ })).toBeVisible();
  await glance.getByRole('button', { name: /Showing only unread/ }).click();
  await expect(page.getByRole('button', { name: 'Filter conversations' })).toBeVisible();

  // From another view it opens the inbox, filtered.
  await mail.nav.getByRole('link', { name: /^Starred/ }).click();
  await expect(page).toHaveURL(/#starred$/);
  await glance.getByRole('button', { name: /Show only unread/ }).click();
  await expect(page).toHaveURL(/#inbox$/);
  await expect(page.getByRole('button', { name: /^Filters: Unread/ })).toBeVisible();
});
