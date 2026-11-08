import { expect, test, type Mail } from './fixtures';

async function writeMessage(mail: Mail, subject: string, body: string) {
  const { page } = mail;
  await page.keyboard.press('c');
  const window = page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
  const to = window.getByRole('combobox', { name: 'To' });
  await expect(to).toBeFocused();
  await to.pressSequentially('priya');
  await window.getByRole('option', { name: 'Priya Natarajan priya.natarajan@example.com' }).click();
  await window.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await window.getByRole('textbox', { name: 'Message body' }).click();
  await page.keyboard.type(body);
  return window;
}

test.describe('schedule send', () => {
  // The demo answers slowly here, as Gmail does, so the flow is covered with real waits.
  test.use({ query: 'latency=300' });

  test('schedule from compose, find it in Scheduled, cancel it back to a draft', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const subject = 'Quarterly numbers for Monday';
    const window = await writeMessage(mail, subject, 'Here they are.');

    // Ctrl/Cmd+Shift+Enter opens the send options instead of sending.
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByText('Schedule send')).toBeVisible();
    const tomorrow = menu.getByRole('menuitem', { name: /^Tomorrow morning/ });
    await expect(tomorrow).toContainText(/8:00\sAM/);
    await expect(menu.getByRole('menuitem', { name: /^Tomorrow afternoon/ })).toContainText(/1:00\sPM/);
    await expect(menu.getByRole('menuitem', { name: 'Pick date & time' })).toBeVisible();
    // The demo schedules on its own side, as Gmail does; nothing to say about it.
    await expect(menu.locator('.menu-note')).toHaveCount(0);
    await tomorrow.click();

    // Picking a time only sets it: Send shows it, and nothing goes until Send is pressed.
    const send = window.getByRole('button', { name: /^Schedule send for \w{3}, \w{3} \d+, 8:00\sAM$/ });
    await expect(send).toContainText(/8:00\sAM/);
    await expect(window).toBeVisible();
    await send.click();

    await expect(window).toBeHidden();
    await expect(mail.snackbar).toContainText(/Send scheduled for \w{3}, \w{3} \d+, 8:00\sAM/);

    await mail.open('scheduled');
    const row = mail.row(subject);
    await expect(row).toBeVisible();
    await expect(row).toContainText(/8:00\sAM|\w{3} \d+/);
    await row.click();
    const banner = mail.thread.getByRole('note').filter({ hasText: 'Send scheduled for' });
    await expect(banner).toContainText(/8:00\sAM/);
    await banner.getByRole('button', { name: 'Cancel send' }).click();
    await expect(mail.snackbar).toContainText('Send canceled. Your message is in Drafts.');
    await expect(mail.row(subject)).toHaveCount(0);

    await mail.nav.getByRole('link', { name: /^Drafts/ }).click();
    await expect(mail.row(subject)).toBeVisible();
  });

  test('pick a date and time, then undo from the snackbar to get the draft back', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const subject = 'Dinner on Saturday';
    const window = await writeMessage(mail, subject, 'Seven works for us.');

    await window.getByRole('button', { name: 'More send options' }).click();
    await page.getByRole('menuitem', { name: 'Pick date & time' }).click();
    const dialog = page.getByRole('dialog', { name: 'Pick date & time' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Next month' }).click();
    await dialog.getByRole('button', { name: / 15, \d{4}$/ }).click();
    await dialog.getByLabel('Time').fill('19:30');
    await expect(dialog).toContainText(/15, 7:30\sPM/);
    await dialog.getByRole('button', { name: 'Set time' }).click();
    await expect(dialog).toBeHidden();
    await window.getByRole('button', { name: /^Schedule send for .*15, 7:30\sPM$/ }).click();

    await expect(mail.snackbar).toContainText(/Send scheduled for .*15, 7:30\sPM/);
    await mail.snackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(mail.snackbar).toContainText('Scheduled send undone');
    const reopened = page.getByRole('region', { name: subject });
    await expect(reopened).toBeVisible();
    await expect(reopened.getByRole('textbox', { name: 'Message body' })).toContainText('Seven works for us.');

    await mail.open('scheduled');
    await expect(mail.list.or(page.getByText('Nothing scheduled'))).toBeVisible();
    await expect(mail.row(subject)).toHaveCount(0);
  });

  test('a time in the past, or too soon for Gmail, cannot be picked', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const window = await writeMessage(mail, 'Past', 'Too late.');
    await window.getByRole('button', { name: 'More send options' }).click();
    await page.getByRole('menuitem', { name: 'Pick date & time' }).click();
    const dialog = page.getByRole('dialog', { name: 'Pick date & time' });
    // Today in the page's own time zone, whatever the machine running the test uses.
    await dialog.locator('[aria-current="date"]').click();
    await dialog.getByLabel('Time').fill('00:00');
    await expect(dialog).toContainText('Pick a time at least 5 minutes from now.');
    await expect(dialog.getByRole('button', { name: 'Set time' })).toBeDisabled();
    // A minute or two from now is still too soon; Gmail calls it an invalid time. (Skipped near midnight, when that's tomorrow.)
    const soon = await page.evaluate(() => {
      const d = new Date(Date.now() + 2 * 60_000);
      return d.getDate() === new Date().getDate() ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null;
    });
    if (soon) {
      await dialog.getByLabel('Time').fill(soon);
      await expect(dialog.getByRole('button', { name: 'Set time' })).toBeDisabled();
    }
  });
});

test.describe('a picked time', () => {
  test.use({ query: 'latency=0' });

  test("can be taken back, and Send then sends now", async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const window = await writeMessage(mail, 'Changed my mind', 'Now is fine.');
    await window.getByRole('button', { name: 'More send options' }).click();
    await page.getByRole('menuitem', { name: /^Tomorrow morning/ }).click();
    await expect(window.getByRole('button', { name: /^Schedule send for / })).toBeVisible();

    await window.getByRole('button', { name: 'More send options' }).click();
    await page.getByRole('menuitem', { name: "Don't schedule" }).click();
    const send = window.getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeVisible();
    await send.click();
    await expect(window).toBeHidden();
    await expect(mail.snackbar).not.toContainText('Send scheduled');
  });
});

test.describe('where scheduling is off', () => {
  // Like the Gmail API source, whose public API can't schedule.
  test.use({ query: 'latency=0&schedule=off' });

  test('the menu hides Schedule send and says what it needs', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const window = await writeMessage(mail, 'Note check', 'Hello.');
    await window.getByRole('button', { name: 'More send options' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('Scheduling needs the “Your Gmail session” connection (Settings > Connection).')).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Tomorrow morning/ })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Pick date & time' })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: /Send with reminder/ })).toBeVisible();
  });
});
