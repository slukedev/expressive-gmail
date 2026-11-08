import { expect, test } from './fixtures';

test.describe('thread replies', () => {
  test('Reply picks up the draft already in the thread, and the draft row goes once it is sent', async ({ mail, page }) => {
    await mail.open('inbox/t-research-readout');
    const draftRow = mail.thread.locator('.msg--draft');
    await expect(draftRow).toContainText('Monday at 11 works');

    await mail.thread.getByRole('button', { name: 'Reply', exact: true }).last().click();

    const editors = mail.thread.getByRole('textbox', { name: 'Message body' });
    await expect(editors).toHaveCount(1);
    await expect(editors).toContainText('Monday at 11 works');
    // The draft shows in the composer, not as a row as well.
    await expect(draftRow).toHaveCount(0);

    await editors.click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(editors).toBeHidden();
    // The sent reply arrives open, as in Gmail.
    const sent = mail.thread.locator('[data-mid]').last();
    await expect(sent).toHaveClass(/msg--expanded/);
    await expect(sent).toContainText('Alex Rivera');
    await expect(sent.frameLocator('iframe').locator('body')).toContainText('Monday at 11 works');
    await expect(draftRow).toHaveCount(0);
    // The backend agrees: the draft went out as the reply and Drafts has one fewer.
    await expect(mail.nav.getByRole('link', { name: /^Drafts/ })).toContainText('3');
    await page.evaluate(() => (location.hash = '#inbox'));
    await page.evaluate(() => (location.hash = '#inbox/t-research-readout'));
    await expect(mail.threadHeading).toBeVisible();
    await expect(draftRow).toHaveCount(0);
  });

  test('discarding a resumed draft removes its row', async ({ mail }) => {
    await mail.open('inbox/t-research-readout');
    const draftRow = mail.thread.locator('.msg--draft');
    await draftRow.click();
    await expect(mail.thread.getByRole('textbox', { name: 'Message body' })).toContainText('Monday at 11 works');

    await mail.thread.getByRole('button', { name: 'Discard draft' }).click();
    await expect(mail.snackbar).toContainText('Draft discarded');
    await expect(mail.thread.getByRole('textbox', { name: 'Message body' })).toHaveCount(0);
    await expect(draftRow).toHaveCount(0);
    await expect(mail.thread.getByRole('button', { name: 'Reply', exact: true }).last()).toBeVisible();
  });

  test('suggested replies skip automated mail but show on a question from a person', async ({ mail }) => {
    // An itinerary from itinerary@ gets a summary card and no canned replies.
    await mail.open('inbox/x-arch-tokyo');
    await expect(mail.threadHeading).toContainText('Your trip to Tokyo');
    await expect(mail.thread.getByRole('button', { name: 'Forward' })).toBeVisible();
    await expect(mail.thread.getByRole('group', { name: 'Suggested replies' })).toHaveCount(0);

    await mail.open('inbox/t-onboarding-v4');
    await expect(mail.thread.getByRole('group', { name: 'Suggested replies' })).toBeVisible();
  });
});

test.describe('reading a conversation', () => {
  test('Unsubscribe stays reachable from the message menu when the pane is too narrow for the button', async ({ mail, page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await mail.open('all/p-margin-142');
    const message = mail.thread.locator('.msg--expanded').last();
    await expect(message.getByRole('button', { name: 'Unsubscribe', exact: true })).toBeHidden();

    await message.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Unsubscribe' }).click();
    const dialog = page.getByRole('dialog', { name: /Unsubscribe from Margin Notes/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('the subject moves into the toolbar once it scrolls away on a wide pane', async ({ mail, page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    await mail.open('all/t-onboarding-v4');
    await expect(mail.threadHeading).toBeVisible();
    const title = mail.threadToolbar.locator('.thread-toolbar__title');
    await expect(title).not.toHaveAttribute('data-shown');

    await mail.thread.getByRole('button', { name: /older messages/ }).click();
    await mail.thread.locator('.thread-scroll').evaluate((s) => s.scrollTo({ top: s.scrollHeight }));
    await expect(title).toHaveAttribute('data-shown');
    await expect(title).toHaveText('Onboarding v4: final review before handoff');

    await mail.thread.locator('.thread-scroll').evaluate((s) => s.scrollTo({ top: 0 }));
    await expect(title).not.toHaveAttribute('data-shown');
  });

  test('shortcuts keep working after clicking into an email', async ({ mail, page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit runs no event listeners in a sandboxed frame without allow-scripts, so keys there never reach the app');
    await mail.open('inbox/t-onboarding-v4');
    await expect(mail.threadHeading).toBeVisible();
    const frame = mail.thread.locator('iframe.msg__frame').last();
    await expect(frame).toBeVisible();
    await frame.click({ position: { x: 4, y: 4 } });
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');

    await page.keyboard.press('u');
    await expect(page).toHaveURL(/#inbox$/);
  });
});
