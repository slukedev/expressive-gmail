import { expect, test, type Mail } from './fixtures';

/**
 * Playwright can only tap, not drag, a touchscreen, so the swipe is a
 * PointerEvent sequence with pointerType "touch" dispatched on the row.
 */
async function swipe(mail: Mail, subject: string, dx: number) {
  const body = mail.rowBody(subject);
  const box = (await body.boundingBox())!;
  await body.evaluate(
    (el, { box, dx }) => {
      const y = box.y + box.height / 2;
      const x0 = box.x + 40;
      const fire = (type: string, x: number) =>
        el.dispatchEvent(
          new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1 }),
        );
      fire('pointerdown', x0);
      for (let i = 1; i <= 10; i++) fire('pointermove', x0 + (dx * i) / 10);
      fire('pointerup', x0 + dx);
    },
    { box, dx },
  );
}

test.describe('phone @phone', () => {
  test('no rail; the menu beside the search field opens the drawer; Compose FAB is there', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();

    await expect(mail.nav).toBeHidden();
    await expect(page.getByRole('button', { name: 'Compose' })).toBeVisible();

    // Gmail Android's M3 Expressive app bar: menu and avatar sit outside the field.
    await expect(page.getByRole('search').getByRole('button', { name: 'Main menu' })).toHaveCount(0);
    await expect(page.getByRole('search').getByRole('button', { name: 'Show search options' })).toHaveCount(0);
    await page.getByRole('banner').getByRole('button', { name: 'Main menu' }).tap();

    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name: 'Starred' }).tap();

    await expect(page).toHaveURL(/#starred$/);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Starred' })).toBeVisible();
  });

  test('a thread opens full screen and the back arrow returns to the list', async ({ mail, page }) => {
    await mail.open('inbox');
    const subject = 'Onboarding v4: final review before handoff';
    // The middle of this row is its attachment chip, which previews the file instead.
    await mail.row(subject).getByText(subject).tap();

    await expect(page).toHaveURL(/#inbox\/t-onboarding-v4$/);
    await expect(mail.threadHeading).toContainText(subject);
    await expect(mail.list).toBeHidden();
    await expect(page.getByRole('button', { name: 'Compose' })).toBeHidden();

    await mail.threadToolbar.getByRole('button', { name: 'Back to list' }).tap();

    await expect(page).toHaveURL(/#inbox$/);
    await expect(mail.row(subject)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compose' })).toBeVisible();
  });

  test('an open thread has one app bar: back, archive, delete, mark unread and More', async ({ mail, page }) => {
    await mail.open('inbox/t-onboarding-v4');
    await expect(mail.threadHeading).toBeVisible();
    // The search bar steps aside while a conversation is open, like Gmail Android.
    await expect(page.getByRole('banner')).toBeHidden();

    const bar = mail.threadToolbar;
    // At the very top once the pane has settled in.
    await expect.poll(async () => (await bar.boundingBox())!.y).toBe(0);
    const box = (await bar.boundingBox())!;
    expect(box.height).toBe(64);
    for (const name of ['Back to list', 'Archive', 'Delete', 'Mark as unread', 'More']) {
      const b = (await bar.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
    }
    await expect(bar.getByRole('button', { name: 'Snooze' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Reply later' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Older' })).toHaveCount(0);

    await bar.getByRole('button', { name: 'More', exact: true }).tap();
    await expect(page.getByRole('menuitem', { name: 'Snooze' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Reply later' }).tap();
    await expect(mail.snackbar).toContainText('Moved to Reply later');

    await bar.getByRole('button', { name: 'Back to list' }).tap();
    await expect(page.getByRole('banner')).toBeVisible();
  });

  test('swiping a row right archives it', async ({ mail }) => {
    await mail.open('inbox');
    const subject = 'I GOT IT';
    await expect(mail.row(subject)).toBeVisible();
    const width = (await mail.rowBody(subject).boundingBox())!.width;

    await swipe(mail, subject, width * 0.6);

    await expect(mail.snackbar).toContainText('Conversation archived');
    await expect(mail.row(subject)).toHaveCount(0);
  });

  test('swiping a row left marks it read and the row slides back into place', async ({ mail, page }) => {
    await mail.open('inbox');
    const unread = mail.rows.filter({ has: page.getByLabel(/^Unread, /) }).first();
    await expect(unread).toBeVisible();
    const subject = await unread.locator('.row__subject-text').innerText();
    await unread.scrollIntoViewIfNeeded();
    const before = (await mail.rowBody(subject).boundingBox())!;

    await swipe(mail, subject, -before.width * 0.6);

    await expect(mail.rowBody(subject)).not.toHaveAccessibleName(/^Unread, /);
    await expect.poll(async () => Math.round((await mail.rowBody(subject).boundingBox())!.x)).toBe(Math.round(before.x));
    await expect(mail.rowBody(subject)).toBeInViewport({ ratio: 1 });
  });

  test('coming back from a conversation finds the list where it was left', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.nth(12)).toBeAttached();
    const scroller = page.locator('.list-scroll');
    const top = await scroller.evaluate((el) => {
      el.scrollTop = Math.min(900, el.scrollHeight - el.clientHeight - 20);
      return el.scrollTop;
    });
    expect(top).toBeGreaterThan(300);
    // A row in the middle of the screen, whatever the list holds today.
    const index = await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('[data-row-index]')?.getAttribute('data-row-index'));
    expect(index).toBeTruthy();
    const row = mail.list.locator(`[data-row-index="${index}"]`);
    await row.locator('.row__subject-text').tap();
    await expect(mail.threadHeading).toBeVisible();

    await mail.threadToolbar.getByRole('button', { name: 'Back to list' }).tap();

    await expect(row).toBeInViewport();
    expect(Math.abs((await scroller.evaluate((el) => el.scrollTop)) - top)).toBeLessThan(4);
  });
});
