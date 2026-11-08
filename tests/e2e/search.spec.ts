import { expect, test } from './fixtures';

test.describe('search and navigation', () => {
  test('live suggestions, Enter to search, Has attachment narrows, Save as split adds it to the nav', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();

    const box = page.getByRole('combobox', { name: 'Search in mail' });
    await box.click();
    await box.pressSequentially('photos');

    const suggestions = page.getByRole('listbox', { name: 'Search suggestions' });
    await expect(suggestions).toBeVisible();
    await expect(suggestions.getByRole('option', { name: 'photos Search all mail' })).toBeVisible();
    // Matching conversations show up as you type, before any search runs.
    await expect(suggestions.getByRole('option', { name: /Abuela’s 90th/ })).toBeVisible();
    await expect(page).toHaveURL(/#inbox$/);

    await box.press('Enter');

    await expect(page).toHaveURL(/#search\/photos$/);
    await expect(suggestions).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Search results' })).toBeVisible();
    await expect(mail.row('photos from the lake')).toBeVisible();
    const all = await mail.rows.count();
    expect(all).toBeGreaterThan(1);

    const filters = page.getByRole('toolbar', { name: 'Search filters' });
    await filters.getByRole('button', { name: 'Has attachment' }).click();

    await expect(page).toHaveURL(/#search\/photos\+has%3Aattachment$/);
    await expect(mail.rows).toHaveCount(1);
    await expect(mail.row('photos from the lake')).toBeVisible();
    await expect(page.getByText('1 conversation', { exact: true })).toBeVisible();

    // Save as split lives in the list's More menu, keeping the chips to one row.
    const listActions = page.getByRole('toolbar', { name: 'List actions' });
    await listActions.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Save as split' }).click();

    await expect(mail.snackbar).toContainText('Saved as a split');
    await listActions.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('menuitem', { name: 'Saved as split' })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    const split = mail.nav.getByRole('link', { name: 'Photos attachment' });
    await expect(split).toBeVisible();

    await split.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Photos attachment' })).toBeVisible();
    await expect(mail.rows).toHaveCount(1);
    await expect(mail.row('photos from the lake')).toBeVisible();
  });

  test('Ctrl/Cmd+K, type "trash", Enter goes to Trash', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await page.keyboard.type('trash');
    await expect(palette.getByRole('option').first()).toContainText('Trash');
    await page.keyboard.press('Enter');

    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(/#trash$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();
    await expect(mail.nav.getByRole('link', { name: 'Trash' })).toHaveAttribute('aria-current', 'page');
  });

  test('search options pick a date with the M3 date picker, by mouse and keyboard', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    await page.getByRole('button', { name: 'Show search options' }).click();
    const form = page.getByRole('form', { name: 'Search options' });
    await expect(form).toBeVisible();

    await form.getByRole('button', { name: 'Choose date' }).click();
    const picker = page.getByRole('dialog', { name: 'Select date' });
    await expect(picker).toBeVisible();
    // No native date input anywhere.
    await expect(page.locator('input[type=date]')).toHaveCount(0);

    // Today has focus; the arrow keys move by day and week. Dates are read in the page's time zone, not this machine's.
    const dates = await page.evaluate(() => {
      const today = new Date();
      const weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
      const label = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      return { today: label(today), weekAgo: label(weekAgo), shown: weekAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) };
    });
    await expect(picker.getByRole('button', { name: dates.today })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(picker.getByRole('button', { name: dates.weekAgo })).toBeFocused();
    await page.keyboard.press('Enter');
    await picker.getByRole('button', { name: 'OK' }).click();
    await expect(picker).toBeHidden();
    await expect(form).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'Of' })).toHaveValue(dates.shown);

    // Escape inside the picker closes just the picker.
    await form.getByRole('button', { name: /^Choose date/ }).click();
    await expect(picker).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(form).toBeVisible();
    // Even when Escape comes before focus has moved into the picker.
    await form.getByRole('button', { name: /^Choose date/ }).click();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(form).toBeVisible();

    await form.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/#search\/.*after/);
  });
});
