import { expect, test } from './fixtures';

test.describe('triage', () => {
  test('archive from the hover action, then Undo puts the row back where it was', async ({ mail }) => {
    await mail.open('inbox');
    const subject = 'Onboarding v4: final review before handoff';
    await expect(mail.rows.nth(1)).toContainText(subject);
    const before = await mail.rows.count();

    await mail.hoverAction(subject, 'Archive');

    await expect(mail.row(subject)).toHaveCount(0);
    await expect(mail.rows).toHaveCount(before - 1);
    await expect(mail.snackbar).toContainText('Conversation archived');

    await mail.snackbar.getByRole('button', { name: 'Undo' }).click();

    await expect(mail.snackbar).toContainText('Action undone');
    await expect(mail.rows).toHaveCount(before);
    await expect(mail.rows.nth(1)).toContainText(subject);
    await expect(mail.page).toHaveURL(/#inbox$/);
  });

  test('j j then e archives the keyboard-focused row', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const firstLabel = await mail.rows.nth(0).locator('[data-row-index]').getAttribute('aria-label');
    const second = await mail.rows.nth(1).locator('[data-row-index]').getAttribute('aria-label');

    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await expect(mail.rows.nth(1).locator('[data-row-index]')).toBeFocused();

    await page.keyboard.press('e');

    await expect(mail.snackbar).toContainText('Conversation archived');
    await expect(page.getByLabel(second!, { exact: true })).toHaveCount(0);
    // The first row was not the target.
    await expect(page.getByLabel(firstLabel!, { exact: true })).toBeVisible();
  });

  test('starring a row toggles its star and lists it in Starred', async ({ mail, page }) => {
    await mail.open('inbox');
    const subject = 'I GOT IT';
    const star = mail.row(subject).getByRole('button', { name: 'Not starred' });
    await star.click();
    await expect(mail.row(subject).getByRole('button', { name: 'Starred' })).toHaveAttribute('aria-pressed', 'true');

    await mail.nav.getByRole('link', { name: 'Starred' }).click();
    await expect(page).toHaveURL(/#starred$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Starred' })).toBeVisible();
    await expect(mail.row(subject)).toBeVisible();

    // Unstar from the Starred view: it leaves the list.
    await mail.row(subject).getByRole('button', { name: 'Starred' }).click();
    await expect(mail.row(subject)).toHaveCount(0);
  });

  test('opening an unread thread marks it read and drops the Inbox count by one', async ({ mail }) => {
    await mail.open('inbox');
    const subject = 'Onboarding v4: final review before handoff';
    await expect(mail.rowBody(subject)).toHaveAccessibleName(/^Unread, /);
    const unread = await mail.inboxUnread();
    expect(unread).toBeGreaterThan(0);

    await mail.rowBody(subject).click();

    await expect(mail.threadHeading).toContainText(subject);
    await expect(mail.rowBody(subject)).not.toHaveAccessibleName(/^Unread, /);
    await expect(mail.inboxLink).toHaveAccessibleName(`Inbox ${unread - 1} unread`);
  });

  test('bulk select three rows, mark them read, Escape clears the selection', async ({ mail, page }) => {
    await mail.open('inbox');
    const targets = mail.rows.filter({ has: page.getByLabel(/^Unread, /) });
    await expect(targets.first()).toBeVisible();
    const labels: string[] = [];
    for (let i = 0; i < 3; i++) {
      const label = (await targets.nth(i).locator('[data-row-index]').getAttribute('aria-label'))!;
      labels.push(label.replace(/^Unread, /, ''));
    }
    const unread = await mail.inboxUnread();

    for (const label of labels) {
      await mail.rows.filter({ has: page.getByLabel(`Unread, ${label}`, { exact: true }) }).getByRole('button', { name: 'Select conversation' }).click();
    }

    const bar = page.getByRole('toolbar', { name: '3 selected' });
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('3 selected');

    await bar.getByRole('button', { name: 'Mark as read' }).click();

    await expect(mail.snackbar).toContainText('3 conversations marked as read');
    for (const label of labels) await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    await expect(mail.inboxLink).toHaveAccessibleName(`Inbox ${unread - 3} unread`);
    // Selection survives the action, so the bar now offers the opposite.
    await expect(bar.getByRole('button', { name: 'Mark as unread' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(bar).toBeHidden();
    await expect(page.getByRole('toolbar', { name: 'List actions' })).toBeVisible();
    await expect(mail.list.getByRole('button', { name: 'Deselect conversation' })).toHaveCount(0);
  });

  test('snooze from the thread toolbar until Tomorrow moves it to Snoozed', async ({ mail, page }) => {
    await mail.open('inbox/t-onboarding-v4');
    const subject = 'Onboarding v4: final review before handoff';
    await expect(mail.threadHeading).toContainText(subject);

    await mail.threadToolbar.getByRole('button', { name: 'Snooze' }).click();
    await page.getByRole('menuitem', { name: /^Tomorrow/ }).click();

    await expect(mail.snackbar).toContainText(/snoozed/i);
    await expect(mail.row(subject)).toHaveCount(0);

    await mail.nav.getByRole('link', { name: 'Snoozed' }).click();
    await expect(page).toHaveURL(/#snoozed$/);
    await expect(mail.row(subject)).toBeVisible();
    await expect(mail.row(subject)).toContainText(/Until/);
  });

  test('apply a label from the thread menu, then remove it with the chip', async ({ mail, page }) => {
    await mail.open('inbox/t-onboarding-v4');
    // The chips follow the subject; only the subject itself is the heading.
    const removeTravel = mail.thread.getByRole('button', { name: 'Remove label Travel' });
    await expect(mail.threadHeading).toContainText('Onboarding v4');
    await expect(removeTravel).toHaveCount(0);

    await mail.threadToolbar.getByRole('button', { name: 'Labels' }).click();
    const travel = page.getByRole('menuitemcheckbox', { name: 'Travel' });
    await travel.click();
    await expect(travel).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    await expect(mail.snackbar).toContainText('Label "Travel" added');
    await expect(removeTravel).toBeVisible();
    await expect(mail.row('Onboarding v4')).toContainText('Travel');

    await removeTravel.click();

    await expect(mail.snackbar).toContainText('Label "Travel" removed');
    await expect(removeTravel).toHaveCount(0);
    await expect(mail.thread.getByRole('button', { name: 'Remove label Work', exact: true })).toBeVisible();
  });
});

test.describe('when Gmail lags behind a write', () => {
  test('a trashed row collapses away and stays gone through a refresh that returns the old list', async ({ mail, page }) => {
    // Writes take 4 s to show up in reads, like Gmail's session endpoints right after a change.
    await mail.open('inbox', 'latency=0&lag=4000');
    const row = mail.row('coffee after crit tomorrow?');
    await expect(row).toBeVisible();
    await row.hover();
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(mail.snackbar).toContainText('moved to Trash');
    await expect(row).toHaveCount(0);

    // Refresh while Gmail still answers with the old list.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForTimeout(1500);
    await expect(row).toHaveCount(0);

    // Once Gmail catches up it's in Trash.
    await page.waitForTimeout(3000);
    await page.evaluate(() => (location.hash = '#trash'));
    await expect(mail.row('coffee after crit tomorrow?')).toBeVisible();
  });
});

test.describe('delete forever where the source can\'t', () => {
  test('session-style mail hands off to classic Gmail instead of failing, and keeps the conversation', async ({ mail }) => {
    await mail.open('trash', 'latency=0&nodelete');
    const first = mail.rows.first();
    await expect(first).toBeVisible();
    const before = await mail.rows.count();
    await first.click();
    await mail.threadToolbar.getByRole('button', { name: 'Delete forever' }).click();
    await expect(mail.snackbar).toContainText('Deleting forever only works in classic Gmail');
    await expect(mail.snackbar.getByRole('button', { name: 'Open classic Gmail' })).toBeVisible();
    await expect(mail.snackbar).not.toContainText("isn't available");
    await expect(mail.rows).toHaveCount(before);
  });
});

test('Empty Trash now asks first, then empties all of Trash', async ({ mail, page }) => {
  await mail.open('trash', 'latency=0');
  await expect(mail.rows.first()).toBeVisible();
  await page.locator('.list-bar').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Empty Trash now' }).click();

  const dialog = page.getByRole('dialog', { name: 'Empty Trash?' });
  await expect(dialog).toContainText("Everything in Trash will be deleted forever. You can't undo this.");
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(mail.rows.first()).toBeVisible();

  await page.locator('.list-bar').getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Empty Trash now' }).click();
  await page.getByRole('dialog', { name: 'Empty Trash?' }).getByRole('button', { name: 'Empty Trash' }).click();
  await expect(mail.snackbar).toContainText('Trash emptied');
  await expect(page.getByRole('heading', { name: 'Trash is empty' })).toBeVisible();
});
