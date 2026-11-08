import type { Locator, Page } from '@playwright/test';
import { expect, test, type Mail } from './fixtures';

const ONBOARDING = 'Onboarding v4: final review before handoff';
const LEASE_QUESTION = 'search/when+is+my+lease+renewal+due%3F';

/** Opens a conversation by its hash route and waits for its heading. */
async function openThread(mail: Mail, hash: string, extraQuery = '') {
  await mail.open(hash, extraQuery);
  await expect(mail.threadHeading).toBeVisible();
}

const panel = (page: Page) => page.getByRole('complementary', { name: 'Gemini' });
const topBarGemini = (page: Page) => page.getByRole('banner').getByRole('button', { name: 'Ask Gemini' });
const summary = (mail: Mail) => mail.thread.getByRole('region', { name: 'Summary by Gemini' });

/** The newest message composer in the page, by its body field. */
const messageBody = (page: Page) => page.getByRole('textbox', { name: 'Message body' }).last();

/** Opens a blank compose window with `c` and returns it with its fields. */
async function newMessage(mail: Mail) {
  const { page } = mail;
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  await page.keyboard.press('c');
  const window = page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
  await expect(window).toHaveAccessibleName('New message');
  // Compose focuses To once it opens; wait for that before moving on.
  await expect(window.getByRole('combobox', { name: 'To' })).toBeFocused();
  const subject = window.getByRole('textbox', { name: 'Subject' });
  const body = window.getByRole('textbox', { name: 'Message body' });
  // Tab from the subject lands above the signature.
  await subject.focus();
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();
  return { window, subject, body, signature: body.locator('.gmail_signature') };
}

/** Opens Help me write with its own keyboard shortcut (Ctrl+H, or Alt+H on a Mac). */
async function helpMeWriteByKey(window: Locator, body: Locator) {
  const trigger = window.getByRole('button', { name: 'Help me write' });
  const keys = await trigger.getAttribute('aria-keyshortcuts');
  expect(keys).toMatch(/^(Control|Alt)\+H$/);
  await body.focus();
  await body.page().keyboard.press(keys!);
  return body.page().getByRole('dialog', { name: 'Help me write' });
}

async function openGeminiSettings(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'See all settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Gemini' }).click();
  return settings;
}

async function setGemini(page: Page, on: boolean) {
  const settings = await openGeminiSettings(page);
  const master = settings.getByRole('switch', { name: 'Gemini', exact: true });
  await master.click();
  await expect(master).toBeChecked({ checked: on });
  await settings.getByRole('button', { name: 'Close settings' }).last().click();
  await expect(settings).toBeHidden();
}

test.describe('Gemini', () => {
  test('summary card streams in, folds, and Ask a follow-up carries it into the panel, where an answer streams and Stop ends the next one', async ({ mail, page }) => {
    await openThread(mail, `inbox/t-onboarding-v4`, 'geminiDelay=1200');
    const card = summary(mail);

    // Thinking first, then the hand-written summary.
    await expect(card.getByRole('status', { name: 'Gemini is summarizing' })).toBeVisible();
    await expect(card).toHaveAttribute('aria-busy', 'true');
    await expect(card).toContainText('Step 2 of 4', { timeout: 10_000 });
    await expect(card).not.toHaveAttribute('aria-busy', 'true');

    const text = card.getByText('Marcus is writing the tickets', { exact: false });
    await card.getByRole('button', { name: 'Hide summary' }).click();
    const show = card.getByRole('button', { name: 'Show summary' });
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await expect(text).toBeHidden();
    await show.click();
    await expect(card.getByRole('button', { name: 'Hide summary' })).toHaveAttribute('aria-expanded', 'true');
    await expect(text).toBeVisible();
    // The card is still growing open; a click mid-way lets go over a different spot than it pressed.
    await card.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));

    await card.getByRole('button', { name: 'Ask a follow-up' }).click();
    const gemini = panel(page);
    await expect(gemini).toBeVisible();
    await expect(topBarGemini(page)).toHaveAttribute('aria-pressed', 'true');
    // The summary is the first answer in the chat, scoped to this email.
    await expect(gemini.locator('.gemini-turn--user').first()).toHaveText('Summarize this email');
    await expect(gemini.locator('.gemini-turn--model').first()).toContainText('Step 2 of 4');
    await expect(gemini.getByRole('button', { name: ONBOARDING })).toHaveAttribute('aria-pressed', 'true');
    const input = gemini.getByRole('textbox', { name: 'Ask Gemini' });
    await expect(input).toBeFocused();

    await input.fill('Who is writing the tickets?');
    await gemini.getByRole('button', { name: 'Send' }).click();
    await expect(input).toHaveValue('');
    await expect(gemini.getByRole('status', { name: 'Gemini is thinking' })).toBeVisible();
    await expect(gemini.getByRole('button', { name: 'Stop answering' })).toBeVisible();
    const answer = gemini.locator('.gemini-turn--model').nth(1);
    await expect(answer).toContainText('tickets', { timeout: 10_000 });
    await expect(answer.getByRole('button', { name: `Source 1: ${ONBOARDING}` })).toBeVisible();
    await expect(answer.getByRole('group', { name: 'Answer actions' }).getByRole('button', { name: 'Ask again' })).toBeVisible();
    await expect(gemini.getByRole('button', { name: 'Stop answering' })).toHaveCount(0);

    // The next question is stopped while Gemini is still thinking.
    await input.fill('When is the name check?');
    await page.keyboard.press('Enter');
    await expect(gemini.getByRole('status', { name: 'Gemini is thinking' })).toBeVisible();
    await gemini.getByRole('button', { name: 'Stop answering' }).click();
    await expect(gemini.locator('.gemini-turn--model').nth(2)).toHaveText('You stopped this answer.');
    await expect(gemini.getByRole('status', { name: 'Gemini is thinking' })).toHaveCount(0);
    await expect(gemini.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  test('a suggested reply by Gemini opens a reply with its whole text', async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-onboarding-v4');
    const suggestions = mail.thread.getByRole('group', { name: 'Suggested replies by Gemini' });
    await expect(suggestions.getByRole('button')).toHaveCount(3);

    await suggestions.getByRole('button', { name: /^Reply: Use Priya’s wording\./ }).click();

    const body = messageBody(page);
    await expect(body).toBeVisible();
    await expect(body).toContainText('“Step 2 of 4, invite your team” works for me.');
    await expect(body).toContainText('Thanks for a quick review, everyone.');
  });

  test('Help me write drafts from a prompt and fills the subject; Formalize replaces it, and Undo brings it back', async ({ mail, page }) => {
    const { window, subject, body, signature } = await newMessage(mail);
    const signed = await signature.innerHTML();
    await expect(subject).toHaveValue('');
    // Addressed, so a Create that reached the message's own form would send it.
    const to = window.getByRole('combobox', { name: 'To' });
    await to.fill('dana@example.com');
    await to.press('Enter');
    await body.focus();

    await window.getByRole('button', { name: 'Help me write' }).click();
    const help = page.getByRole('dialog', { name: 'Help me write' });
    const prompt = help.getByRole('textbox', { name: 'What should Gemini write?' });
    await expect(prompt).toBeFocused();
    // An empty message has nothing to rework yet.
    await expect(help.getByRole('button', { name: /^Formalize/ })).toHaveCount(0);
    await prompt.fill('ask Dana to move our 1:1 to Friday');
    await help.getByRole('button', { name: 'Create' }).click();

    await expect(help).toContainText('Could you move our 1:1 to Friday?');
    // The draft shows its subject apart from the message, like a small compose window.
    await expect(help).toContainText(/Subject\s*Move our 1:1 to Friday/);
    // Create is Help me write's own: it never reaches the message's Send.
    await expect(window).toBeVisible();
    await help.getByRole('button', { name: 'Insert' }).click();
    await expect(help).toBeHidden();
    await expect(body).toContainText('Hi Dana,');
    await expect(body).toContainText('Could you move our 1:1 to Friday?');
    await expect(subject).toHaveValue('Move our 1:1 to Friday');
    await expect.poll(() => signature.innerHTML()).toBe(signed);

    // With text in the message, the shortcut offers to rework it.
    const again = await helpMeWriteByKey(window, body);
    const rework = again.getByRole('list', { name: 'Rework what you wrote' });
    await expect(rework).toBeVisible();
    await rework.getByRole('button', { name: /^Formalize/ }).click();
    await expect(again).toContainText('Hello Dana,');
    await again.getByRole('button', { name: 'Replace' }).click();
    await expect(body).toContainText('Hello Dana,');
    await expect(body).not.toContainText('Hi Dana,');
    await expect.poll(() => signature.innerHTML()).toBe(signed);
    await expect(mail.snackbar).toContainText('Replaced your text');

    await mail.snackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(body).toContainText('Hi Dana,');
    await expect(body).not.toContainText('Hello Dana,');
    await expect.poll(() => signature.innerHTML()).toBe(signed);
  });

  test('Proofread lists the typos, and Accept all fixes them without touching the signature', async ({ mail, page }) => {
    const { window, body, signature } = await newMessage(mail);
    const signed = await signature.innerHTML();
    await page.keyboard.type('i will send teh notes tommorow .');

    await window.getByRole('button', { name: 'Help me write' }).click();
    await page.getByRole('dialog', { name: 'Help me write' }).getByRole('button', { name: /^Proofread/ }).click();
    // The popover takes its name from its title, which now reads Proofread.
    const help = page.getByRole('dialog', { name: 'Proofread' });

    const fixes = help.getByRole('list', { name: 'Suggestions' }).getByRole('listitem');
    await expect(fixes).toHaveCount(4);
    await expect(fixes.filter({ hasText: 'teh' })).toContainText('Spelling');
    await expect(fixes.filter({ hasText: 'tommorow' })).toContainText('tomorrow');

    await help.getByRole('button', { name: 'Accept all' }).click();
    await expect(help).toContainText('All set. Your message is ready.');
    await expect(body).toContainText('I will send the notes tomorrow.');
    await expect(body).not.toContainText('teh');
    await expect.poll(() => signature.innerHTML()).toBe(signed);

    await help.getByRole('button', { name: 'Done' }).click();
    await expect(help).toBeHidden();
  });

  test('a question in search gets an answer with sources, and a source opens its conversation', async ({ mail, page }) => {
    await mail.open(LEASE_QUESTION);
    const answer = page.getByRole('region', { name: 'Answer from Gemini' });
    await expect(answer).toContainText('November 15');
    const sources = answer.getByRole('list', { name: 'Sources' }).getByRole('listitem');
    await expect(sources.first()).toContainText(/Lease renewal for \d{4}, unit 3B/);

    await answer.getByRole('button', { name: /^Source 1: Lease renewal for/ }).click();

    await expect(page).toHaveURL(/t-lease-renewal/);
    await expect(mail.threadHeading).toHaveText(/^Lease renewal for \d{4}, unit 3B$/);
  });

  test('turning Gemini off in Settings hides every Gemini surface, and on brings them back', async ({ mail, page }) => {
    const rail = mail.nav;
    const expectSurfaces = async (on: boolean) => {
      const n = on ? 1 : 0;
      await expect(topBarGemini(page)).toHaveCount(n);
      await expect(summary(mail)).toHaveCount(n);
      await expect(mail.thread.getByRole('group', { name: 'Suggested replies by Gemini' })).toHaveCount(n);
      // Without Gemini, short answers from local rules stand in.
      await expect(mail.thread.getByRole('group', { name: 'Suggested replies', exact: true })).toHaveCount(1 - n);
    };

    await openThread(mail, 'inbox/t-onboarding-v4');
    await rail.getByRole('button', { name: 'More' }).click();
    await expect(summary(mail)).toContainText('Step 2 of 4');
    await expectSurfaces(true);
    // AI Inbox stays out of the sidebar for now.
    await expect(rail.getByRole('link', { name: 'AI Inbox' })).toHaveCount(0);

    await setGemini(page, false);
    await expectSurfaces(false);
    await mail.open(LEASE_QUESTION);
    await expect(page.getByRole('heading', { level: 1, name: 'Search results' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Answer from Gemini' })).toHaveCount(0);

    // The setting is kept: a reload stays off.
    await openThread(mail, 'inbox/t-onboarding-v4');
    await expect(mail.thread.getByRole('group', { name: 'Suggested replies', exact: true })).toBeVisible();
    await expect(topBarGemini(page)).toHaveCount(0);

    await setGemini(page, true);
    await expect(summary(mail)).toContainText('Step 2 of 4');
    await expectSurfaces(true);
    await mail.open(LEASE_QUESTION);
    await expect(page.getByRole('region', { name: 'Answer from Gemini' })).toContainText('November 15');
  });

  test('when Gemini fails, each surface says so and Try again asks again', async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-onboarding-v4', 'gemini=fail&geminiDelay=400');
    const failure = 'Gemini couldn’t answer right now. Try again in a moment.';
    const card = summary(mail);
    await expect(card).toContainText(failure);
    // Replies fall back to the local suggestions.
    await expect(mail.thread.getByRole('group', { name: 'Suggested replies', exact: true })).toBeVisible();

    await card.getByRole('button', { name: 'Try again' }).click();
    await expect(card.getByRole('status', { name: 'Gemini is summarizing' })).toBeVisible();
    await expect(card).toContainText(failure);

    await topBarGemini(page).click();
    const gemini = panel(page);
    await gemini.getByRole('button', { name: 'List the action items' }).click();
    const turn = gemini.locator('.gemini-turn--model').last();
    await expect(turn).toContainText(failure);
    await turn.getByRole('button', { name: 'Try again' }).click();
    await expect(turn.getByRole('status', { name: 'Gemini is thinking' })).toBeVisible();
    await expect(turn).toContainText(failure);
    // A failed answer offers nothing to copy or rate.
    await expect(turn.getByRole('group', { name: 'Answer actions' })).toHaveCount(0);

    await mail.open(LEASE_QUESTION, 'gemini=fail');
    const answer = page.getByRole('region', { name: 'Answer from Gemini' });
    await expect(answer).toContainText(failure);
    await expect(answer.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('an account without Gemini in its plan shows no Gemini anywhere', async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-research-readout', 'gemini=plan');
    await expect(mail.threadHeading).toHaveText('Can we move the pricing page research readout?');
    await expect(topBarGemini(page)).toHaveCount(0);
    await expect(summary(mail)).toHaveCount(0);
    await expect(mail.thread.getByRole('button', { name: 'Summarize this email' })).toHaveCount(0);
    await mail.nav.getByRole('button', { name: 'More' }).click();
    await expect(mail.nav.getByRole('link', { name: 'Storage' })).toBeVisible();
    await expect(mail.nav.getByRole('link', { name: 'AI Inbox' })).toHaveCount(0);

    await page.keyboard.press('c');
    const window = page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
    await expect(window).toHaveAccessibleName('New message');
    await expect(window.getByRole('button', { name: 'Help me write' })).toHaveCount(0);

    await mail.open(LEASE_QUESTION, 'gemini=plan');
    await expect(page.getByRole('heading', { level: 1, name: 'Search results' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Answer from Gemini' })).toHaveCount(0);

    // A link straight to AI Inbox explains instead of showing an empty page.
    await mail.open('ai-inbox', 'gemini=plan');
    await expect(page.getByRole('status').filter({ hasText: 'Gemini isn’t on this account' })).toBeVisible();
  });

  test('AI Inbox: a to-do marked done moves under Done, Undo returns it, and done survives a reload', async ({ mail, page }) => {
    await mail.open('ai-inbox');
    await expect(page).toHaveURL(/#ai-inbox$/);
    await expect(page.getByRole('heading', { level: 1, name: 'AI Inbox' })).toBeVisible();

    const todo = 'Sign and return the lease renewal by November 15';
    const markDone = page.getByRole('checkbox', { name: `Mark “${todo}” done` });
    const markOpen = page.getByRole('checkbox', { name: `Mark “${todo}” not done` });
    const doneGroup = page.locator('details').filter({ hasText: /Done \(\d+\)/ });
    await expect(markDone).not.toBeChecked();
    await expect(doneGroup).toHaveCount(0);

    await markDone.click();
    await expect(mail.snackbar).toContainText('Marked done');
    await expect(markDone).toHaveCount(0);
    await expect(doneGroup.getByText(/Done \(1\)/)).toBeVisible();
    await doneGroup.getByText(/Done \(1\)/).click();
    await expect(markOpen).toBeChecked();

    await mail.snackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(markDone).not.toBeChecked();
    await expect(doneGroup).toHaveCount(0);

    await markDone.click();
    await expect(doneGroup.getByText(/Done \(1\)/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'AI Inbox' })).toBeVisible();
    await expect(doneGroup.getByText(/Done \(1\)/)).toBeVisible();
    await expect(markDone).toHaveCount(0);
    await doneGroup.getByText(/Done \(1\)/).click();
    await expect(markOpen).toBeChecked();
  });

  test('keyboard: the palette opens the panel, Enter sends, and Escape closes the sheet one layer at a time', async ({ mail, page }) => {
    // 1280px wide: the panel floats over the reading pane as a sheet.
    expect(page.viewportSize()?.width).toBe(1280);
    await openThread(mail, 'inbox/t-lease-renewal');

    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette.getByRole('combobox')).toBeFocused();
    await page.keyboard.type('Ask Gemini');
    await expect(palette.getByRole('option').first()).toHaveAccessibleName(/^Ask Gemini/);
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();

    const gemini = panel(page);
    const input = gemini.getByRole('textbox', { name: 'Ask Gemini' });
    await expect(input).toBeFocused();
    await expect(gemini.getByRole('button', { name: 'Summarize this email' })).toBeVisible();

    await page.keyboard.type('Who is fixing the fan?');
    await page.keyboard.press('Enter');
    await expect(gemini.locator('.gemini-turn--user')).toHaveText(['Who is fixing the fan?']);
    const answer = gemini.locator('.gemini-turn--model');
    await expect(answer.getByRole('button', { name: /^Source 1: Lease renewal for/ })).toBeVisible();

    // Escape closes what's on top first: the palette, then the sheet. The conversation under it stays.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(gemini).toBeVisible();
    // Focus on one of the sheet's buttons rather than its text field.
    await answer.getByRole('button', { name: 'Good response' }).click();
    await expect(answer.getByRole('button', { name: 'Good response' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(gemini).toBeHidden();
    await expect(topBarGemini(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page).toHaveURL(/#inbox\/t-lease-renewal$/);

    // Reopened, the chat is where it was.
    await topBarGemini(page).click();
    await expect(gemini.locator('.gemini-turn--user')).toHaveText(['Who is fixing the fan?']);
  });
});

test.describe('Gemini on a phone @phone', () => {
  test('Ask a follow-up opens the panel over the whole screen, and Close Gemini goes back to the email', async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-onboarding-v4');
    const card = summary(mail);
    await expect(card).toContainText('Step 2 of 4');

    await card.getByRole('button', { name: 'Ask a follow-up' }).click();
    const gemini = panel(page);
    // The panel's code is split out; the dev server compiles it on first open, slowly when other workers load it too.
    await expect(gemini).toBeVisible({ timeout: 20_000 });
    await expect(gemini.locator('.gemini-turn--model').first()).toContainText('Step 2 of 4');
    const viewport = page.viewportSize()!;
    // Polled, since it slides up into place.
    await expect.poll(() => gemini.boundingBox()).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });

    await gemini.getByRole('button', { name: 'Close Gemini' }).click();
    await expect(gemini).toBeHidden();
    await expect(card).toBeVisible();
    await expect(page).toHaveURL(/#inbox\/t-onboarding-v4$/);
  });
});
