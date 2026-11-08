import { expect, test, type Mail } from './fixtures';

/** Moves the keyboard cursor (j) down to the row whose name matches. */
async function cursorTo(mail: Mail, name: RegExp) {
  for (let i = 0; i < 40; i++) {
    await mail.page.keyboard.press('j');
    // The cursor moves focus on the next frame.
    const label = await mail.page.evaluate(
      () => new Promise<string>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(document.activeElement?.getAttribute('aria-label') ?? '')))),
    );
    if (name.test(label)) return;
  }
  throw new Error(`No row matching ${name}`);
}

async function compose(mail: Mail, subject: string, body: string) {
  const { page } = mail;
  await page.keyboard.press('c');
  const window = page.getByRole('region').filter({ has: page.getByRole('combobox', { name: 'To' }) });
  const to = window.getByRole('combobox', { name: 'To' });
  await expect(to).toBeFocused();
  await to.pressSequentially('priya');
  await window.getByRole('option', { name: 'Priya Natarajan priya.natarajan@example.com' }).click();
  await window.getByRole('textbox', { name: 'Subject' }).fill(subject);
  await page.keyboard.press('Tab');
  await page.keyboard.type(body);
  return window;
}

test.describe('attachment reminder', () => {
  test('asks before sending a message that says it has an attachment, and Send anyway sends it', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const window = await compose(mail, 'Q3 plan', "Hi Priya, I've attached the plan for Q3.");
    await page.keyboard.press('ControlOrMeta+Enter');

    const dialog = page.getByRole('dialog', { name: 'Did you mean to attach files?' });
    await expect(dialog).toContainText('You wrote “I\'ve attached” in your message');
    // Attaching is the likelier intent, so it has focus.
    await expect(dialog.getByRole('button', { name: 'Attach files' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Send anyway' }).click();

    await expect(window).toBeHidden();
    await mail.nav.getByRole('link', { name: 'Sent' }).click();
    await expect(mail.row('Q3 plan')).toBeVisible();
  });

  test('Attach files opens the picker, then Send has focus and goes without asking again', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const window = await compose(mail, 'Signed lease', 'Attaching the signed lease.');
    await page.keyboard.press('ControlOrMeta+Enter');
    const dialog = page.getByRole('dialog', { name: 'Did you mean to attach files?' });

    const chooser = page.waitForEvent('filechooser');
    await dialog.getByRole('button', { name: 'Attach files' }).click();
    await (await chooser).setFiles({ name: 'lease.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') });

    await expect(window.getByText('lease.pdf')).toBeVisible();
    const send = window.getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(window).toBeHidden();
  });

  test('stays quiet about attachments mentioned in the quoted message', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    await mail.rowBody(/Grüße aus München/).click();
    await mail.thread.getByRole('button', { name: 'Reply', exact: true }).last().click();
    const editor = mail.thread.getByRole('textbox', { name: 'Message body' });
    await expect(editor).toBeFocused();
    await page.keyboard.type('Thanks for the attachment, looks great.');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(mail.snackbar).toContainText('Message sent');
    await expect(page.getByRole('dialog', { name: 'Did you mean to attach files?' })).toHaveCount(0);
  });
});

test.describe('reply later', () => {
  test('Shift L sets a conversation aside; the stack works through it and empties as you reply', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const leila = /coffee after crit tomorrow/;
    const nadia = mail.row(/Book club moved to the 22nd/);
    await expect(mail.row(leila)).toBeVisible();

    // Set two aside from the list with the keyboard cursor.
    await cursorTo(mail, leila);
    await page.keyboard.press('Shift+L');
    await expect(mail.snackbar).toContainText('Moved to Reply later');
    await expect(mail.row(leila)).toHaveCount(0);
    // A selection works too.
    await nadia.getByRole('button', { name: 'Select conversation' }).click();
    await page.keyboard.press('Shift+L');
    await expect(nadia).toHaveCount(0);

    const stack = page.getByRole('region', { name: 'Reply later' });
    await expect(stack).toContainText('Reply later 2');
    await expect(stack).toContainText('Leila and Nadia');
    await stack.getByRole('button', { name: /Reply later/ }).click();
    const items = stack.getByRole('list', { name: 'Set aside to reply later' }).getByRole('listitem');
    await expect(items).toHaveCount(2);

    // Oldest first: Leila, then Nadia.
    await stack.getByRole('button', { name: 'Start replying' }).click();
    await expect(mail.threadHeading).toContainText('coffee after crit');
    const session = mail.thread.getByRole('region', { name: 'Reply later' });
    await expect(session).toContainText('1 more after this one');
    const editor = mail.thread.getByRole('textbox', { name: 'Message body' });
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.type('Yes! 4pm at the usual place?');
    await page.keyboard.press('ControlOrMeta+Enter');

    // Sending moves straight on to the next one, reply open.
    await expect(mail.threadHeading).toContainText('Book club moved');
    await expect(session).toContainText('Last one');
    await session.getByRole('button', { name: 'Done' }).click();

    await expect(mail.snackbar).toContainText("That's everything you set aside");
    await expect(stack).toHaveCount(0);
    await expect(nadia).toBeVisible();
  });

  test('the thread toolbar toggles it, and Undo puts it back', async ({ mail }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    await mail.rowBody(/Grüße aus München/).click();
    const toggle = mail.threadToolbar.getByRole('button', { name: 'Reply later' });
    await toggle.click();
    await expect(mail.threadToolbar.getByRole('button', { name: 'Remove from Reply later' })).toHaveAttribute('aria-pressed', 'true');
    await mail.snackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(mail.threadToolbar.getByRole('button', { name: 'Reply later' })).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('free up space', () => {
  test('finds the biggest mail first and deletes it to Trash with Undo', async ({ mail, page }) => {
    await mail.open('storage');
    await expect(page.getByRole('heading', { name: 'Free up space' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Over 10 MB/ })).toHaveAttribute('aria-pressed', 'true');
    const big = page.getByRole('list', { name: 'Conversations over 10 MB' });
    await expect(big.getByRole('listitem')).toHaveCount(1);
    await expect(big).toContainText('slides-lake-1998.png');

    await page.getByRole('button', { name: 'Delete it' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete 1 conversation?' });
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Nothing over 10 MB in your mail.')).toBeVisible();
    await expect(mail.snackbar).toContainText('moved to Trash');

    await mail.snackbar.getByRole('button', { name: 'Undo' }).click();
    await expect(big.getByRole('listitem')).toHaveCount(1);
  });

  test('old promotions are counted and cleared in one step', async ({ mail, page }) => {
    await mail.open('storage');
    const promos = page.locator('.storage-bucket', { hasText: 'Promotions older than a year' });
    await expect(promos).toContainText('3 conversations');
    await promos.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog', { name: 'Delete 3 conversations?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(promos).toContainText('Nothing here');
  });

  test('is in the palette', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await page.keyboard.type('free up');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#storage$/);
  });
});

test.describe('dark emails', () => {
  test.use({ colorScheme: 'dark' });

  test('darkens a designed email and View in light theme brings back its own colors', async ({ mail, page }) => {
    await mail.open('inbox/p-stride-1');
    const frame = mail.thread.locator('iframe.msg__frame').last();
    await expect(frame).toBeVisible();
    const body = frame.contentFrame().locator('body');
    await expect(body).toContainText('STRIDE');
    // The email paints a white page; darkened, its largest light box is now dark.
    const pageLightness = () =>
      frame.contentFrame().locator('body').evaluate((b) => {
        const lum = (css: string) => {
          const [r, g, bl] = (css.match(/[\d.]+/g) ?? ['0', '0', '0']).map(Number);
          return (0.2126 * r! + 0.7152 * g! + 0.0722 * bl!) / 255;
        };
        const painted = [...b.querySelectorAll<HTMLElement>('table, td, div')].filter((el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)');
        const biggest = painted.sort((x, y) => y.offsetWidth * y.offsetHeight - x.offsetWidth * x.offsetHeight)[0]!;
        return lum(getComputedStyle(biggest).backgroundColor);
      });
    await expect.poll(pageLightness).toBeLessThan(0.3);

    await mail.thread.getByRole('button', { name: 'More' }).last().click();
    await page.getByRole('menuitem', { name: 'View in light theme' }).click();
    await expect.poll(pageLightness).toBeGreaterThan(0.8);
  });
});

test.describe('next unread', () => {
  test('Shift K jumps back past read conversations to the nearest unread one, Shift J says when none are left', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const bodies = mail.list.locator('[data-row-index]');
    const names = await bodies.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''));
    const unread = (i: number) => names[i]?.startsWith('Unread') ?? false;
    // A read row whose nearest unread neighbour above is at least three rows up.
    const from = names.findIndex((_, i) => i > 3 && !unread(i) && !unread(i - 1) && !unread(i - 2) && names.slice(0, i).some((_, j) => unread(j)));
    expect(from).toBeGreaterThan(0);
    const target = names.slice(0, from).findLastIndex((_, j) => unread(j));

    for (let i = 0; i <= from; i++) await page.keyboard.press('j');
    await expect(bodies.nth(from)).toBeFocused();
    await page.keyboard.press('Shift+K');
    await expect(bodies.nth(target)).toBeFocused();

    // Past the last unread one, Shift J stays put and says so.
    const last = names.findLastIndex((_, j) => unread(j));
    for (let i = target; i < last + 1; i++) await page.keyboard.press('j');
    await page.keyboard.press('Shift+J');
    await expect(mail.snackbar).toContainText('No unread conversations below this one');
  });
});
