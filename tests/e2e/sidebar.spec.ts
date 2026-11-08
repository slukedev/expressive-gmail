import { expect, test } from './fixtures';

test('Settings > Sidebar rearranges the rail by keyboard and drag, keeps it across a reload, and restores the default', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.inboxLink).toBeVisible();
  // The first few destinations on the rail, before More.
  const railNames = async () => (await mail.nav.locator('.rail__primary > li > .rail-item .rail-item__label').allInnerTexts()).slice(0, 4);
  expect(await railNames()).toEqual(['Inbox', 'Starred', 'Snoozed', 'Sent']);

  await page.locator('.account-btn').click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'All settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Sidebar' }).click();
  await expect(settings.getByRole('heading', { name: 'Sidebar', level: 2 })).toBeVisible();

  // Drafts steps down past the Under More heading into More, by keyboard.
  const drafts = settings.getByRole('button', { name: 'Move Drafts' });
  await drafts.focus();
  await drafts.press('ArrowDown');
  await expect(mail.announced('Drafts, Under More, 1 of')).toBeAttached();
  await expect(settings.getByRole('button', { name: 'Move Drafts' })).toBeFocused();

  // Starred is hidden from its row's menu.
  await settings.getByRole('button', { name: 'Options for Starred' }).click();
  await page.getByRole('menuitemradio', { name: 'Hide' }).click();

  // Trash is dragged up above Inbox.
  const trash = settings.getByRole('button', { name: 'Move Trash' });
  const inbox = settings.getByRole('button', { name: 'Move Inbox' });
  await trash.scrollIntoViewIfNeeded();
  const from = (await trash.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await inbox.scrollIntoViewIfNeeded();
  for (let i = 0; i < 12; i++) {
    const to = (await inbox.boundingBox())!;
    await page.mouse.move(to.x + to.width / 2, to.y - 4, { steps: 4 });
  }
  await page.mouse.up();

  // Labels comes before Splits; Splits is switched off.
  await settings.getByRole('button', { name: 'Move Labels' }).press('ArrowUp');
  await settings.getByRole('switch', { name: 'Show Splits in the sidebar' }).click();

  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  const expected = ['Trash', 'Inbox', 'Snoozed', 'Sent'];
  await expect.poll(railNames).toEqual(expected);
  await expect(mail.nav.getByRole('heading', { name: 'Splits' })).toHaveCount(0);
  await mail.nav.getByRole('button', { name: 'More' }).click();
  await expect(mail.nav.locator('.rail__more .rail-item__label').first()).toHaveText('Drafts');
  await expect(mail.nav.getByRole('link', { name: /^Starred/ })).toHaveCount(0);

  await page.reload();
  await expect(mail.inboxLink).toBeVisible();
  await expect.poll(railNames).toEqual(expected);

  // Right-click on the rail: hide Sent, then undo from the snackbar.
  await mail.nav.getByRole('link', { name: /^Sent/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Hide from sidebar' }).click();
  await expect(mail.nav.getByRole('link', { name: /^Sent/ })).toHaveCount(0);
  await mail.snackbar.getByRole('button', { name: 'Undo' }).click();
  await expect(mail.nav.getByRole('link', { name: /^Sent/ })).toBeVisible();

  await mail.nav.getByRole('link', { name: /^Inbox/ }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Hide from sidebar' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Customize sidebar' }).click();
  await settings.getByRole('button', { name: 'Restore the default sidebar' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(railNames).toEqual(['Inbox', 'Starred', 'Snoozed', 'Sent']);
  await expect(mail.nav.getByRole('heading', { name: 'Splits' })).toBeVisible();
});
