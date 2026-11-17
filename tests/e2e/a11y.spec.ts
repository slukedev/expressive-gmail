import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';

// @axe-core/playwright isn't installed, so this checks the rule a screen reader user hits first: every visible control has a name. One aria snapshot per scope keeps it fast.
async function expectNamed(scope: Locator, role: string, minimum: number) {
  const lines = (await scope.ariaSnapshot()).split('\n');
  const controls = lines.filter((l) => new RegExp(`^\\s*- '?${role}\\b`).test(l));
  expect(controls.length, `${role}s in scope`).toBeGreaterThanOrEqual(minimum);
  const unnamed = controls.filter((l) => !new RegExp(`^\\s*- '?${role} "[^"]*\\S`).test(l));
  expect(unnamed, `${role}s without an accessible name`).toEqual([]);
}

const expectNamedButtons = (scope: Locator, minimum: number) => expectNamed(scope, 'button', minimum);

test.describe('accessibility smoke', () => {
  test('inbox toolbar and rows (including hover actions) name every button', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    await expectNamedButtons(page.getByRole('toolbar', { name: 'List actions' }), 2);

    await mail.rows.first().hover();
    await expect(mail.rows.first().getByRole('button', { name: 'Archive' })).toBeVisible();
    await expectNamedButtons(mail.list, 10);
    await expectNamedButtons(page.getByRole('navigation', { name: 'Mailboxes' }), 1);
    await expectNamedButtons(page.getByRole('banner'), 4);
  });

  test('thread toolbar, header and messages name every button', async ({ mail, page }) => {
    await mail.open('inbox/t-research-readout');
    await expect(mail.threadHeading).toContainText('Can we move the pricing page research readout?');
    await expectNamedButtons(mail.threadToolbar, 8);
    await expectNamedButtons(mail.thread, 12);

    await mail.list.getByRole('button', { name: 'Select conversation' }).nth(0).click();
    await expectNamedButtons(page.getByRole('toolbar', { name: '1 selected' }), 6);
  });

  test('quick settings and all settings name every control', async ({ mail, page }) => {
    await mail.open('inbox');
    await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
    const quick = page.getByRole('dialog', { name: 'Quick settings' });
    await expect(quick).toBeVisible();
    await expectNamedButtons(quick, 5);
    await expectNamed(quick, 'radio', 3);
    await expectNamed(quick, 'switch', 0);

    await quick.getByRole('button', { name: 'See all settings' }).click();
    const all = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(all).toBeVisible();
    await expectNamedButtons(all, 3);
    for (const role of ['textbox', 'combobox', 'switch', 'radio', 'checkbox']) await expectNamed(all, role, 0);

    const nav = all.getByRole('navigation', { name: 'Settings sections' });
    // One evaluate on the nav: Playwright's Firefox crashes on allInnerTexts after repeated aria snapshots.
    const names = (await nav.evaluate((el) => [...el.querySelectorAll<HTMLElement>('.settings-nav-item__label')].map((l) => l.innerText))).filter(
      (t) => t !== 'Switch to classic Gmail',
    );
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) {
      const item = nav.getByRole('button', { name, exact: true });
      await item.click();
      await expect(item).toHaveAttribute('aria-current', 'page');
      for (const role of ['button', 'textbox', 'combobox', 'switch', 'radio', 'checkbox']) await expectNamed(all, role, 0);
    }
  });

  test('compose, the command palette, the account menu and Gemini name every control', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();

    await page.keyboard.press('c');
    const compose = page.getByRole('region', { name: 'New message' });
    await expect(compose).toBeVisible();
    await expectNamedButtons(compose, 6);
    await expectNamed(compose, 'textbox', 2);
    await compose.getByRole('button', { name: 'Close' }).click();

    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await expectNamed(palette, 'combobox', 1);
    await expectNamed(palette, 'option', 3);
    await page.keyboard.press('Escape');

    await page.locator('.account-btn').click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expectNamed(menu, 'menuitem', 3);
    await page.keyboard.press('Escape');

    await page.getByRole('banner').getByRole('button', { name: 'Ask Gemini' }).click();
    const gemini = page.getByRole('complementary', { name: 'Gemini' });
    await expect(gemini).toBeVisible();
    await expectNamedButtons(gemini, 2);
    await expectNamed(gemini, 'textbox', 1);
  });

  test('list sections are lists of conversations only, and the resize handle reports the width', async ({ mail, page }) => {
    await mail.open('inbox', 'latency=0');
    await expect(mail.rows.first()).toBeVisible();
    const sections = mail.list.getByRole('list');
    expect(await sections.count()).toBeGreaterThan(0);
    // Headings, banners and follow-ups sit between the lists, never inside one.
    const strays = await mail.list.evaluate((el) =>
      [...el.querySelectorAll('[role="list"]')].flatMap((list) =>
        [...list.querySelectorAll('*')].filter((c) => c.closest('[role="listitem"]') === null && c.matches('h1, h2, h3, [role="status"], [role="button"], button')).map((c) => c.outerHTML.slice(0, 80)),
      ),
    );
    expect(strays).toEqual([]);
    await expect(sections.first()).toHaveAccessibleName(/\S/);

    const handle = page.getByRole('separator', { name: 'Resize list' });
    const width = Math.round((await page.locator('.list-pane').boundingBox())!.width);
    await expect(handle).toHaveAttribute('aria-valuenow', String(width));
    await handle.focus();
    await page.keyboard.press('ArrowRight');
    await expect(handle).toHaveAttribute('aria-valuenow', String(width + 24));
  });
});
