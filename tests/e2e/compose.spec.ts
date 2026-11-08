import { expect, test, type Mail } from './fixtures';

async function writeMessage(mail: Mail, subject: string, body: string) {
  const { page } = mail;
  await page.keyboard.press('c');
  // The window is named after its subject, so find it by its To field.
  const window = page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
  await expect(window).toHaveAccessibleName('New message');

  const to = window.getByRole('combobox', { name: 'To' });
  await expect(to).toBeFocused();
  await to.pressSequentially('priya');
  const suggestion = window.getByRole('option', { name: 'Priya Natarajan priya.natarajan@example.com' });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(window.getByRole('button', { name: 'Remove Priya Natarajan' })).toBeVisible();

  await window.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await expect(window).toHaveAccessibleName(subject);
  // Tab from the subject lands above the signature, like Gmail.
  await page.keyboard.press('Tab');
  const editor = window.getByRole('textbox', { name: 'Message body' });
  await expect(editor).toBeFocused();
  await page.keyboard.type(body);
  await expect(editor).toContainText(body);
  return window;
}

test.describe('compose', () => {
  test('c opens compose, a picked contact plus Ctrl/Cmd+Enter sends it to Sent', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const subject = 'Launch checklist for Friday';
    const window = await writeMessage(mail, subject, 'Here is the list we agreed on.');

    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(window).toBeHidden();

    await mail.nav.getByRole('link', { name: 'Sent' }).click();
    await expect(page).toHaveURL(/#sent$/);
    const row = mail.row(subject);
    await expect(row).toBeVisible();
    await expect(row).toContainText('Here is the list we agreed on.');
    await row.click();
    await expect(mail.threadHeading).toContainText(subject);
    await expect(mail.thread.getByRole('button', { name: 'to Priya Natarajan' })).toBeVisible();
  });

  test('with undo send off, the "Message sent" snackbar stays on screen', async ({ mail, page }) => {
    await mail.open('sent');
    await expect(mail.rows.first()).toBeVisible();
    const subject = 'Confirm me';
    await writeMessage(mail, subject, 'Did it go?');
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(mail.snackbar).toContainText('Message sent');
    // The snackbar promises a 6 s confirmation; give it one second on screen.
    await page.waitForTimeout(1_000);
    await expect(mail.snackbar).toContainText('Message sent', { timeout: 500 });
    await expect(mail.row(subject)).toBeVisible();
  });

  test.describe('with undo send', () => {
    test.use({ seed: { onboarded: true, readingPane: 'right', undoSendSeconds: 5 } });

    test('Undo in the snackbar brings the compose window back intact', async ({ mail, page }) => {
      await mail.open('inbox');
      await expect(mail.rows.first()).toBeVisible();
      const subject = 'Draft that should not leave';
      const body = 'Second thoughts about this one.';
      const window = await writeMessage(mail, subject, body);

      await window.getByRole('button', { name: 'Send', exact: true }).click();

      await expect(window).toBeHidden();
      await expect(mail.snackbar).toContainText('Sending…');
      await mail.snackbar.getByRole('button', { name: 'Undo' }).click();

      await expect(mail.snackbar).toContainText('Sending undone');
      const back = page.getByRole('region', { name: subject });
      await expect(back).toBeVisible();
      await expect(back.getByRole('textbox', { name: 'Subject' })).toHaveValue(subject);
      await expect(back.getByRole('textbox', { name: 'Message body' })).toContainText(body);
      await expect(back.getByRole('button', { name: 'Remove Priya Natarajan' })).toBeVisible();
    });
  });

  test('inline reply in a long thread adds one message to it', async ({ mail, page }) => {
    await mail.open('inbox/t-onboarding-v4');
    const subject = 'Onboarding v4: final review before handoff';
    await expect(mail.threadHeading).toContainText(subject);
    await expect(mail.row(subject).getByText('12', { exact: true })).toBeVisible();

    await mail.thread.getByRole('button', { name: 'Reply', exact: true }).last().click();
    const editor = mail.thread.getByRole('textbox', { name: 'Message body' });
    await expect(editor).toBeFocused();
    const text = 'Signing off on v4. Thanks all.';
    await editor.pressSequentially(text);
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(editor).toBeHidden();
    await expect(mail.row(subject).getByText('13', { exact: true })).toBeVisible();
    // The sent reply arrives open at the end of the thread.
    const sent = mail.thread.locator('[data-mid]').last();
    await expect(sent).toHaveClass(/msg--expanded/);
    await expect(sent.frameLocator('iframe').locator('body')).toContainText(text);

    // Unfold the thread and count every message.
    await mail.thread.getByRole('button', { name: /older messages/ }).click();
    const collapsed = mail.thread.getByRole('button', { name: /^Message from / });
    const expanded = mail.thread.getByRole('button', { name: 'Reply', exact: true });
    await expect.poll(async () => (await collapsed.count()) + (await expanded.count()) - 1).toBe(13);
  });
});

test.describe('recipient suggestions', () => {
  async function openCompose(mail: Mail) {
    const { page } = mail;
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    await page.keyboard.press('c');
    return page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
  }

  test('To, Cc and Bcc all suggest people; arrow keys and Enter turn one into a chip', async ({ mail, page }) => {
    const window = await openCompose(mail);
    await window.getByRole('button', { name: 'Cc', exact: true }).click();
    await window.getByRole('button', { name: 'Bcc', exact: true }).click();

    for (const label of ['To', 'Cc', 'Bcc']) {
      const input = window.getByRole('combobox', { name: label, exact: true });
      await input.click();
      await input.pressSequentially('na');
      const options = window.getByRole('listbox').getByRole('option');
      await expect(options.nth(1)).toBeVisible();
      await expect(input).toHaveAttribute('aria-expanded', 'true');
      await expect(options.first()).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('ArrowDown');
      await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
      const picked = (await options.nth(1).locator('.md-body-medium').innerText()).trim();
      await page.keyboard.press('Enter');
      await expect(input).toHaveValue('');
      await expect(window.getByRole('listbox')).toBeHidden();
      // The chip sits in the field it was picked in.
      const field = window.locator('.recipients').filter({ has: page.getByRole('combobox', { name: label, exact: true }) });
      await expect(field.getByRole('button', { name: `Remove ${picked}` })).toBeVisible();
    }
  });

  test.describe('when the contact search endpoint fails', () => {
    test.use({ query: 'latency=0&contacts=fail' });

    test('people you mail with are still suggested, with no error shown', async ({ mail, page }) => {
      const window = await openCompose(mail);
      const to = window.getByRole('combobox', { name: 'To', exact: true });
      await to.pressSequentially('priya');
      const suggestion = window.getByRole('option', { name: 'Priya Natarajan priya.natarajan@example.com' });
      await expect(suggestion).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(window.getByRole('button', { name: 'Remove Priya Natarajan' })).toBeVisible();

      await window.getByRole('button', { name: 'Cc', exact: true }).click();
      const cc = window.getByRole('combobox', { name: 'Cc', exact: true });
      await cc.pressSequentially('greta');
      await expect(window.getByRole('option', { name: /^Greta/ })).toBeVisible();
      await expect(mail.snackbar.getByText(/contact|suggestion/i)).toHaveCount(0);
    });
  });
});

/** Opens a new message from the inbox and returns its window. */
async function newWindow(mail: Mail) {
  const { page } = mail;
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  await page.keyboard.press('c');
  const window = page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
  await expect(window).toBeVisible();
  return window;
}

test.describe('signatures', () => {
  test('Gmail’s signature is imported, a reply uses the reply default, and the picker swaps it without touching the text', async ({ mail, page }) => {
    const window = await newWindow(mail);
    const body = window.getByRole('textbox', { name: 'Message body' });
    // The account's Gmail signature is there from the start.
    await expect(body.locator('.gmail_signature')).toContainText('Product Designer, Fernwork');

    // Write a short one in Settings and make it the reply default for this address.
    await window.getByRole('button', { name: 'Signature' }).click();
    await page.getByRole('menuitem', { name: 'Manage signatures' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('button', { name: 'New signature' }).click();
    await settings.getByRole('textbox', { name: 'Name' }).fill('Short');
    await settings.getByRole('textbox', { name: 'Signature' }).click();
    await page.keyboard.type('Alex, on the road');
    await settings.getByRole('button', { name: 'Save signature' }).click();
    await expect(settings.getByRole('listitem').filter({ hasText: 'Short' })).toBeVisible();
    await settings.getByRole('combobox', { name: 'Signature for replies and forwards from alex.rivera@example.com' }).click();
    await page.getByRole('option', { name: 'Short' }).click();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();

    // In the open message: a click in the space under the text writes above the signature.
    const space = (await window.locator('.compose-body').boundingBox())!;
    await page.mouse.click(space.x + 40, space.y + space.height - 24);
    await page.keyboard.type('Notes attached below.');
    await expect(body.locator('.gmail_signature')).not.toContainText('Notes attached below.');
    // Then swap signatures; the words stay put.
    await window.getByRole('button', { name: 'Signature' }).click();
    await page.getByRole('menuitemradio', { name: /^Short/ }).click();
    await expect(body.locator('.gmail_signature')).toContainText('Alex, on the road');
    await expect(body.locator('.gmail_signature')).not.toContainText('Fernwork');
    await expect(body).toContainText('Notes attached below.');
    await window.getByRole('button', { name: 'Signature' }).click();
    await page.getByRole('menuitemradio', { name: 'No signature' }).click();
    await expect(body.locator('.gmail_signature')).toHaveCount(0);
    await expect(body).toContainText('Notes attached below.');

    // A reply starts with the reply default.
    await window.getByRole('button', { name: 'Save and close' }).click();
    await mail.open('inbox/t-research-readout');
    await mail.thread.getByRole('button', { name: 'Forward', exact: true }).first().click();
    const reply = mail.thread.getByRole('textbox', { name: 'Message body' });
    await expect(reply.locator('.gmail_signature')).toContainText('Alex, on the road');
  });

  test('changing From brings that address’s default signature unless you picked one yourself', async ({ mail, page }) => {
    await page.addInitScript(() => {
      const data = {
        signatures: [
          { id: 'work', name: 'Work', html: '<div>Alex, Fernwork</div>' },
          { id: 'hello', name: 'Hello', html: '<div>Alex, say hello</div>' },
        ],
        defaults: { 'alex.rivera@example.com': { new: 'work', reply: 'work' }, 'hello@alexrivera.example.net': { new: 'hello', reply: null } },
        imported: ['alex.rivera@example.com'],
        recentEmoji: [],
      };
      if (!localStorage.getItem('bg.compose.v1')) localStorage.setItem('bg.compose.v1', JSON.stringify(data));
    });
    const window = await newWindow(mail);
    const body = window.getByRole('textbox', { name: 'Message body' });
    await expect(body.locator('.gmail_signature')).toContainText('Alex, Fernwork');
    await window.getByRole('combobox', { name: 'From' }).click();
    await page.getByRole('option', { name: /hello@alexrivera\.example\.net/ }).click();
    await expect(body.locator('.gmail_signature')).toContainText('Alex, say hello');
  });
});

test.describe('writing', () => {
  test('keyboard: Cc and Bcc open focused, list and link shortcuts format, Escape saves and closes', async ({ mail, page }) => {
    const window = await newWindow(mail);
    await page.keyboard.press('ControlOrMeta+Shift+c');
    await expect(window.getByRole('combobox', { name: 'Cc', exact: true })).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Shift+b');
    await expect(window.getByRole('combobox', { name: 'Bcc', exact: true })).toBeFocused();

    const body = window.getByRole('textbox', { name: 'Message body' });
    await window.getByRole('textbox', { name: 'Subject' }).fill('Trail plans');
    await page.keyboard.press('Tab');
    await expect(body).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Shift+8');
    await page.keyboard.type('Water');
    await expect(body.locator('ul li')).toHaveText('Water');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Map here');
    // Select "here" and link it.
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('ControlOrMeta+k');
    const dialog = page.getByRole('dialog', { name: 'Insert link' });
    await expect(dialog.getByRole('textbox', { name: 'Text to display' })).toHaveValue('here');
    await dialog.getByRole('textbox', { name: 'Web address or email' }).fill('maps.example.com/trail');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(body.getByRole('link', { name: 'here' })).toHaveAttribute('href', 'https://maps.example.com/trail');
    await expect(body).toContainText('Map here');

    await body.click();
    await page.keyboard.press('Escape');
    await expect(window).toBeHidden();
    await expect(mail.snackbar).toContainText('Draft saved');
  });

  test('the formatting toolbar shows what the selection has on', async ({ mail, page }) => {
    const window = await newWindow(mail);
    await window.getByRole('textbox', { name: 'Message body' }).click();
    await window.getByRole('button', { name: 'Show formatting' }).click();
    const toolbar = window.getByRole('toolbar', { name: 'Formatting' });
    await expect(toolbar).toBeVisible();
    const bold = toolbar.getByRole('button', { name: 'Bold' });
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await bold.click();
    await page.keyboard.type('Loud');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await expect(window.getByRole('textbox', { name: 'Message body' }).locator('b')).toHaveText('Loud');
    // One Tab stop: arrows move between the tools.
    await bold.focus();
    await page.keyboard.press('ArrowRight');
    await expect(toolbar.getByRole('button', { name: 'Italic' })).toBeFocused();
  });

  test('dropping files shows the drop zone and attaches them', async ({ mail, page }) => {
    const window = await newWindow(mail);
    const form = window.locator('form');
    const transfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['quarterly numbers'], 'q3-report.csv', { type: 'text/csv' }));
      dt.items.add(new File(['x'.repeat(2048)], 'trail-map.pdf', { type: 'application/pdf' }));
      return dt;
    });
    await form.dispatchEvent('dragenter', { dataTransfer: transfer });
    await expect(window.getByText('Drop 2 files to attach')).toBeVisible();
    await form.dispatchEvent('drop', { dataTransfer: transfer });
    await expect(window.getByText('Drop 2 files to attach')).toBeHidden();
    const files = window.getByRole('list', { name: 'Attachments' });
    await expect(files.getByText('q3-report.csv')).toBeVisible();
    await expect(files.getByText('trail-map.pdf')).toBeVisible();
    await window.getByRole('button', { name: 'Remove q3-report.csv' }).click();
    await expect(files.getByText('q3-report.csv')).toBeHidden();
  });

  test('switching an inline reply to Forward clears the recipients and changes the subject', async ({ mail, page }) => {
    await mail.open('inbox/t-onboarding-v4');
    await mail.thread.getByRole('button', { name: 'Reply', exact: true }).last().click();
    const body = mail.thread.getByRole('textbox', { name: 'Message body' });
    await expect(body).toBeFocused();
    await page.keyboard.type('Keeping this line.');
    await mail.thread.getByRole('button', { name: /^Type of response/ }).click();
    await page.getByRole('menuitemradio', { name: 'Forward' }).click();
    await expect(mail.thread.getByRole('combobox', { name: 'To' })).toHaveValue('');
    await expect(mail.thread.locator('.recipient-chip')).toHaveCount(0);
    await expect(mail.thread.getByText('Forwarded message')).toBeVisible();
    await expect(body).toContainText('Keeping this line.');
  });

  test('c straight after Escape opens a new window while the last one is still closing', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    await page.keyboard.press('c');
    await expect(page.getByRole('region', { name: 'New message' })).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await expect(page.locator('.compose-window[data-key]:not([data-leaving])')).toHaveCount(1);
    await expect(page.locator('.compose-window[data-key]:not([data-leaving])').getByRole('combobox', { name: 'To' })).toBeFocused();
  });

  test.describe('in a 1024px window', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('a second window folds the first down to its bar so both stay on screen, and Restore swaps them', async ({ mail, page }) => {
      await mail.open('inbox');
      await expect(mail.rows.first()).toBeVisible();
      await page.keyboard.press('c');
      const first = page.getByRole('region', { name: 'New message' });
      await expect(first).toHaveCount(1);
      await page.keyboard.press('Escape');
      await page.keyboard.press('c');
      await expect(page.getByRole('region', { name: 'Draft that' })).toHaveCount(0);
      const windows = page.locator('.compose-window');
      await expect(windows).toHaveCount(1);
      await windows.first().getByRole('textbox', { name: 'Subject' }).fill('First');
      await windows.first().getByRole('button', { name: 'Minimize' }).click();
      await expect(windows.first()).toHaveAttribute('data-state', 'minimized');
      await page.keyboard.press('Escape');
      await page.locator('body').click({ position: { x: 600, y: 400 } });
      await page.keyboard.press('c');
      await expect(windows).toHaveCount(2);
      await page.getByRole('region', { name: 'First' }).getByRole('button', { name: 'Restore' }).click();
      await expect(page.getByRole('region', { name: 'First' })).toHaveAttribute('data-state', 'open');
      await expect(windows.nth(1)).toHaveAttribute('data-state', 'minimized');
      // Once they've slid into place, both are fully on screen.
      await expect
        .poll(() => page.evaluate(() => [...document.querySelectorAll('.compose-window')].every((w) => { const r = w.getBoundingClientRect(); return !w.getAnimations().length && r.left >= 0 && r.right <= innerWidth; })))
        .toBe(true);
    });
  });
});

test('Ctrl/Cmd+B, I and U format what you type next', async ({ mail, page }) => {
  const window = await newWindow(mail);
  await window.getByRole('textbox', { name: 'Subject' }).fill('Styles');
  await page.keyboard.press('Tab');
  const body = window.getByRole('textbox', { name: 'Message body' });
  for (const [key, tag, word] of [['b', 'b', 'Bold'], ['i', 'i', 'Slanted'], ['u', 'u', 'Under']] as const) {
    await page.keyboard.press(`ControlOrMeta+${key}`);
    await page.keyboard.type(word);
    await page.keyboard.press(`ControlOrMeta+${key}`);
    await page.keyboard.type(' ');
    await expect(body.locator(tag)).toHaveText(word);
  }
});

test('an opened quote sits below the signature, and switching to Forward and back never doubles it', async ({ mail, page }) => {
  await mail.open('inbox/t-onboarding-v4');
  await mail.thread.getByRole('button', { name: 'Reply', exact: true }).last().click();
  const body = mail.thread.getByRole('textbox', { name: 'Message body' });
  await expect(body).toBeFocused();
  await page.keyboard.type('Looks good.');
  await mail.thread.getByRole('button', { name: 'Show quoted text' }).click();
  const quotes = body.locator(':scope > .gmail_quote');
  await expect(quotes).toHaveCount(1);
  // Signature first, then the quote, the order sending uses.
  expect(await body.evaluate((el) => [...el.children].map((c) => c.className).filter(Boolean))).toEqual(['gmail_signature', 'gmail_quote']);

  const mode = mail.thread.getByRole('button', { name: /^Type of response/ });
  await mode.click();
  await page.getByRole('menuitemradio', { name: 'Forward' }).click();
  await expect(quotes).toHaveCount(0);
  await expect(body.locator('.gmail_quote')).toHaveCount(0);
  await expect(mail.thread.getByText('Forwarded message')).toBeVisible();
  await mode.click();
  await page.getByRole('menuitemradio', { name: 'Reply', exact: true }).click();
  await expect(body.locator('.gmail_quote')).toHaveCount(0);
  await expect(mail.thread.getByRole('button', { name: 'Show quoted text' })).toHaveCount(1);
  await expect(body).toContainText('Looks good.');
});

test.describe('expanded composer', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('is a page: subject as the title, files as tiles in the side rail, and Escape folds it back into the dock', async ({ mail, page }) => {
    const window = await newWindow(mail);
    await window.getByRole('textbox', { name: 'Subject' }).fill('Offsite plan');
    await window.getByRole('button', { name: 'Full screen' }).click();
    const full = page.getByRole('dialog', { name: 'Offsite plan' });
    await expect(full).toBeVisible();
    // The subject leads the page in Tab order too.
    await expect(full.getByRole('textbox', { name: 'Subject' })).toHaveValue('Offsite plan');
    const order = await full.evaluate((el) => [...el.querySelectorAll('[aria-label="Subject"], input[role="combobox"]')].map((n) => n.getAttribute('aria-label')));
    expect(order[0]).toBe('Subject');
    // Formatting is docked open; no toggle needed.
    await expect(full.getByRole('toolbar', { name: 'Formatting' })).toBeVisible();

    const rail = full.getByRole('complementary', { name: 'Message details' });
    await full.locator('input[type=file]').setInputFiles([
      { name: 'agenda.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(2048) },
      { name: 'venue.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaPhfDwAE/wH+Yh1d5gAAAABJRU5ErkJggg==', 'base64') },
    ]);
    const tiles = rail.getByRole('list', { name: 'Attached files' });
    await expect(tiles.getByText('agenda.pdf')).toBeVisible();
    await expect(tiles.locator('img')).toHaveCount(1);
    await rail.getByRole('button', { name: 'Remove agenda.pdf' }).click();
    await expect(tiles.getByText('agenda.pdf')).toBeHidden();

    // Signature and send later live in the send row, as in the docked window, not the rail.
    await expect(rail.getByText('Signature', { exact: true })).toHaveCount(0);
    await expect(rail.getByText('Send later')).toHaveCount(0);
    const body = full.getByRole('textbox', { name: 'Message body' });
    await full.getByRole('button', { name: 'Signature' }).click();
    await page.getByRole('menuitemradio', { name: 'No signature' }).click();
    await expect(body.locator('.gmail_signature')).toHaveCount(0);

    await body.click();
    await page.keyboard.press('Escape');
    await expect(full).toBeHidden();
    const docked = page.getByRole('region', { name: 'Offsite plan' });
    await expect(docked).toHaveAttribute('data-state', 'open');
    await expect(docked.getByText('venue.png')).toBeVisible();
  });

  test('a reply shows the mail it answers as a card in the rail, and quoting it puts it below the signature', async ({ mail, page }) => {
    await mail.open('inbox/t-onboarding-v4');
    await mail.thread.getByRole('button', { name: 'Reply', exact: true }).last().click();
    await expect(mail.thread.getByRole('textbox', { name: 'Message body' })).toBeFocused();
    await page.keyboard.type('Signing off on v4.');
    await page.getByRole('button', { name: 'Pop out reply' }).click();
    await page.getByRole('button', { name: 'Full screen' }).click();
    const rail = page.getByRole('complementary', { name: 'Message details' });
    const card = rail.getByRole('region', { name: 'Replying to' });
    await expect(card).toContainText('wrote:');
    await card.getByRole('button', { name: 'Quote it in your message' }).click();
    await expect(card).toBeHidden();
    const body = page.getByRole('dialog').getByRole('textbox', { name: 'Message body' });
    expect(await body.evaluate((el) => [...el.children].map((c) => c.className).filter(Boolean))).toEqual(['gmail_signature', 'gmail_quote']);
    await expect(body).toContainText('Signing off on v4.');
  });

  test('the rail lists your latest mail with the person you write to, and opening one docks the draft beside it', async ({ mail, page }) => {
    const window = await newWindow(mail);
    await window.getByRole('combobox', { name: 'To' }).fill('priya');
    await page.getByRole('option').first().click();
    await window.getByRole('textbox', { name: 'Subject' }).fill('Checking in');
    await window.getByRole('button', { name: 'Full screen' }).click();
    const full = page.getByRole('dialog', { name: 'Checking in' });
    const recent = full.getByRole('region', { name: /^Recent with / });
    const first = recent.getByRole('button').first();
    await expect(first).toBeVisible();
    const subject = (await first.locator('.compose-recent__subject').textContent())!;
    await first.click();
    await expect(full).toBeHidden();
    await expect(page.getByRole('region', { name: 'Checking in' })).toHaveAttribute('data-state', 'open');
    await expect(mail.thread.getByRole('heading', { level: 1 })).toContainText(subject.slice(0, 20));
  });
});

test.describe('the Drafts folder', () => {
  test('says who a draft is to, and a click opens it in the composer, not the reading pane', async ({ mail, page }) => {
    await mail.open('drafts');
    const row = mail.row('Toast for Sofia’s graduation');
    await expect(row).toContainText('Draft');
    await expect(mail.row('Peer feedback for Tomás')).toContainText('Draft to Dana Whitfield');
    await mail.rowBody('Toast for Sofia’s graduation').click();
    const window = page.getByRole('region', { name: 'Toast for Sofia’s graduation' });
    await expect(window.getByRole('textbox', { name: 'Message body' })).toContainText('cardboard house');
    expect(page.url()).toMatch(/#drafts$/);
  });

  test('Discard draft takes the row away at once and the draft stays gone', async ({ mail, page }) => {
    await mail.open('drafts');
    const row = mail.row('Peer feedback for Tomás');
    await expect(row).toBeVisible();
    await expect(async () => {
      await row.hover();
      await row.getByRole('button', { name: 'Discard draft' }).click({ timeout: 2000 });
    }).toPass();
    await expect(row).toHaveCount(0);
    await expect(page.getByText('Draft discarded')).toBeVisible();
    // A fresh read of the folder agrees.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(mail.row('Toast for Sofia’s graduation')).toBeVisible();
    await expect(mail.row('Peer feedback for Tomás')).toHaveCount(0);
  });
});
