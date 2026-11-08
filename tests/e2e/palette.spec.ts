import { expect, test, type Mail } from './fixtures';
import type { Page } from '@playwright/test';

function palette(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  return {
    dialog,
    input: dialog.getByRole('combobox'),
    options: dialog.getByRole('option'),
    option: (name: string | RegExp) => dialog.getByRole('option', { name }),
    chip: dialog.locator('.palette__chip'),
  };
}

async function openPalette(page: Page) {
  await page.keyboard.press('ControlOrMeta+k');
  const p = palette(page);
  await expect(p.input).toBeFocused();
  return p;
}

async function openThread(mail: Mail) {
  await mail.open('inbox/t-onboarding-v4');
  await expect(mail.threadHeading).toContainText('Onboarding v4');
}

test.describe('command palette', () => {
  test('leads with actions on the open conversation, named in each row', async ({ mail, page }) => {
    await openThread(mail);
    const p = await openPalette(page);
    await expect(p.dialog.getByRole('group', { name: 'This conversation' })).toBeVisible();
    await expect(p.options.first()).toHaveAccessibleName(/^Archive “Onboarding v4: final review…”/);
    await expect(p.input).toHaveAttribute('aria-activedescendant', (await p.options.first().getAttribute('id'))!);

    await page.keyboard.type('arch');
    await expect(p.options.first()).toHaveAccessibleName(/^Archive “Onboarding v4/);
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeHidden();
    await expect(mail.snackbar).toContainText('Conversation archived');
    await expect(mail.row('Onboarding v4: final review')).toHaveCount(0);
  });

  test('acts on every selected conversation', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await page.keyboard.press('j');
    await page.keyboard.press('x');
    const p = await openPalette(page);
    await expect(p.dialog.getByRole('group', { name: '2 selected conversations' })).toBeVisible();
    await page.keyboard.type('star 2');
    await expect(p.options.first()).toHaveAccessibleName(/2 conversations/);
  });

  test('drills into Snooze, steps back with Backspace and Escape, and reads a typed time', async ({ mail, page }) => {
    await openThread(mail);
    const p = await openPalette(page);
    await page.keyboard.type('snooze');
    await expect(p.options.first()).toHaveAccessibleName(/^Snooze “Onboarding v4/);
    await page.keyboard.press('Enter');

    await expect(p.chip).toHaveText('Snooze');
    await expect(p.dialog.getByRole('group', { name: /^Snooze “Onboarding v4.*” until$/ })).toBeVisible();
    await expect(p.option(/^Tomorrow/)).toBeVisible();
    await expect(p.option(/^Pick date and time/)).toBeVisible();

    // Backspace on an empty field goes back up, keeping what was typed there.
    await page.keyboard.press('Backspace');
    await expect(p.chip).toBeHidden();
    await expect(p.input).toHaveValue('snooze');
    await page.keyboard.press('Enter');
    await expect(p.chip).toHaveText('Snooze');
    // Escape steps out of the page before it closes anything.
    await page.keyboard.press('Escape');
    await expect(p.chip).toBeHidden();
    await expect(p.dialog).toBeVisible();

    await page.keyboard.press('Enter');
    await page.keyboard.type('in 3 days 2pm');
    await expect(p.options.first()).toHaveAccessibleName(/^Snooze until .*2:00\s?PM/);
    await expect(p.options.first()).toContainText('In 3 days');
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeHidden();
    await expect(mail.snackbar).toContainText(/Snoozed until .*2:00\s?PM/);
  });

  test('flags a typed time that has passed instead of snoozing to it', async ({ mail, page }) => {
    await openThread(mail);
    const p = await openPalette(page);
    await page.keyboard.type('snooze 2020-01-01');
    await expect(p.options.first()).toHaveAttribute('aria-disabled', 'true');
    await expect(p.options.first()).toContainText('That time has already passed');
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeVisible();
  });

  test('"label receipts" labels the open conversation in one line', async ({ mail, page }) => {
    await openThread(mail);
    const p = await openPalette(page);
    await page.keyboard.type('label receipts');
    await expect(p.dialog.getByRole('group', { name: /^Label “Onboarding v4.*” as$/ })).toBeVisible();
    await expect(p.options.first()).toHaveAccessibleName(/^Receipts/);
    await page.keyboard.press('Enter');
    await expect(mail.snackbar).toContainText('Label "Receipts" added');
    await expect(mail.thread.getByText('Receipts', { exact: true })).toBeVisible();
  });

  test('"move to new label" creates the label and moves the conversation there', async ({ mail, page }) => {
    await openThread(mail);
    const p = await openPalette(page);
    await page.keyboard.type('move to new label Taxes 2026');
    await expect(p.options.first()).toHaveAccessibleName(/^Move to new label “Taxes 2026”/);
    await page.keyboard.press('Enter');
    await expect(mail.snackbar).toContainText('moved to "Taxes 2026"');
    await expect(mail.nav.getByRole('link', { name: /Taxes 2026/ })).toBeVisible();
  });

  test('searches mail with operator chips, opens a result, and runs the search with Shift+Enter', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    let p = await openPalette(page);
    await page.keyboard.type('from:priya');
    const run = p.option(/^Search all mail for “from:priya”/);
    await expect(run).toBeVisible();
    await expect(run.locator('.palette__op')).toHaveText(['from:priya']);
    const result = p.dialog.getByRole('group', { name: 'Mail' }).getByRole('option').nth(1);
    await expect(result).toBeVisible();
    const subject = (await result.locator('.palette__title').innerText()).trim();
    await page.keyboard.press('ArrowDown');
    await expect(result).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeHidden();
    await expect(mail.threadHeading).toHaveText(subject);

    p = await openPalette(page);
    await page.keyboard.type('from:priya has:attachment');
    await page.keyboard.press('Shift+Enter');
    await expect(p.dialog).toBeHidden();
    await expect(page).toHaveURL(/#search\/from%3Apriya\+has%3Aattachment$/);
  });

  test('flips a setting in place and shows its state', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const p = await openPalette(page);
    await page.keyboard.type('message previews');
    const row = p.option(/^Message previews/);
    await expect(row).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Enter');
    await expect(p.dialog).toBeVisible();
    await expect(row).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(p.dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bg.settings.v1') ?? '{}').showSnippets)).toBe(false);
  });

  test('"theme dark" switches the theme', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const p = await openPalette(page);
    await page.keyboard.type('theme dark');
    await expect(p.options.first()).toHaveAccessibleName(/^Dark/);
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('bg.settings.v1') ?? '{}').themeMode)).toBe('dark');
  });

  test('moves by group with Tab and to the ends with Home and End', async ({ mail, page }) => {
    await openThread(mail);
    const p = await openPalette(page);
    const groups = p.dialog.getByRole('group');
    await page.keyboard.press('Tab');
    const secondFirst = groups.nth(1).getByRole('option').first();
    await expect(secondFirst).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(p.options.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(p.options.last()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(p.options.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(p.options.last()).toHaveAttribute('aria-selected', 'true');
  });

  test('lists shortcuts after "?" and tells screen readers how many results there are', async ({ mail, page }) => {
    await openThread(mail);
    const p = await openPalette(page);
    await page.keyboard.type('?arch');
    await expect(p.option(/^Archive “Onboarding v4/)).toContainText('e');
    await expect(p.dialog.getByRole('status')).toHaveText(/^\d+ results?$/);
  });

  test('offers to repeat the last command', async ({ mail, page }) => {
    await openThread(mail);
    await openPalette(page);
    await page.keyboard.type('archive');
    await page.keyboard.press('Enter');
    await expect(mail.snackbar).toContainText('Conversation archived');
    // The reading pane moves on to the next conversation; Repeat archives that one.
    await expect(mail.threadHeading).not.toContainText('Onboarding v4');
    // Repeat offers itself once the next conversation is there to act on.
    await expect(mail.threadHeading).toHaveText(/\S/);
    const p = await openPalette(page);
    await expect(p.dialog.getByRole('group', { name: 'Recent' }).getByRole('option').first()).toHaveAccessibleName(/^Repeat: Archive “/);
  });
});
