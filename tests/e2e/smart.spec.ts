import type { BrowserContext, Page } from '@playwright/test';
import { expect, test, type Mail } from './fixtures';

/** Grants clipboard access where the browser supports it. Returns whether reads will work. */
async function allowClipboard(context: BrowserContext, browserName: string): Promise<boolean> {
  if (browserName !== 'chromium') return false;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${process.env.PREVIEW_PORT || 5199}` });
  return true;
}

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** Answers any request to an outside site with a stub so nothing reaches the network. */
async function stubSite(context: BrowserContext, pattern: string) {
  await context.route(pattern, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
}

/** Opens a thread by id and waits for its heading. */
async function openThread(mail: Mail, hash: string) {
  await mail.open(hash);
  await expect(mail.threadHeading).toBeVisible();
}

test.describe('smart features', () => {
  test('Updates: the Ledgerly row copies its code', async ({ mail, page, context, browserName }) => {
    const canRead = await allowClipboard(context, browserName);
    await mail.open('category/updates');
    const chip = mail.row('Your Ledgerly verification code').getByRole('button', { name: /Copy code/ });
    await expect(chip).toContainText('482 913');

    await chip.click();

    // The label rolls to "Copied", which also becomes the chip's name.
    await expect(mail.row('Your Ledgerly verification code').getByRole('button', { name: /Copied/ })).toHaveAttribute('data-confirmed', 'true');
    await expect(mail.announced('Code 482 913 copied')).toHaveCount(1);
    if (canRead) expect(await clipboard(page)).toBe('482913');
    // The chip copies; it does not open the thread.
    await expect(page).toHaveURL(/#category\/updates$/);
  });

  test('a shipping email shows a tracker at its newest status and opens the carrier page', async ({ mail, page, context }) => {
    await stubSite(context, '**/parcelpath.example/**');
    await openThread(mail, 'category/updates/u-parcel-out');
    const card = mail.thread.getByRole('region', { name: /Your package/ });

    // This email says "Out for delivery"; Parcelpath's later email says it arrived, and that leads.
    await expect(card.locator('.smart-card__big')).toHaveText('Delivered');
    const steps = card.getByRole('list', { name: 'Delivery progress' }).getByRole('listitem');
    await expect(steps).toHaveCount(4);
    for (const [i, label] of ['Ordered', 'Shipped', 'Out for delivery', 'Delivered'].entries()) await expect(steps.nth(i)).toContainText(label);
    await expect(steps.nth(3)).toHaveAttribute('aria-current', 'step');
    await expect(card.locator('[aria-current="step"]')).toHaveCount(1);
    const updates = card.getByRole('region', { name: 'Updates' });
    await expect(updates.getByRole('listitem').filter({ hasText: 'Out for delivery' })).toContainText('This email');
    await expect(card).toContainText('PP 4419 2086 7731 US');

    const popup = page.waitForEvent('popup');
    await card.getByRole('button', { name: 'Track package' }).click();
    const tab = await popup;
    await tab.waitForLoadState('domcontentloaded');
    expect(tab.url()).toBe('https://parcelpath.example/t/PP441920867731US');
  });

  test('a "Shipped" email finds the later emails with its tracking number and links to them', async ({ mail }) => {
    // Opened straight from a link: none of the carrier's emails are loaded yet, so this comes from a search.
    await openThread(mail, 'category/updates/u-hollowpine-shipped');
    const card = mail.thread.getByRole('region', { name: 'Your package from Hollowpine Outfitters' });
    await expect(card.locator('.smart-card__big')).toHaveText('Delivered', { timeout: 15_000 });
    await expect(card.locator('.smart-card__note').first()).toContainText('from Swiftlane');

    // Each step once, newest first; this email keeps saying what it said.
    const updates = card.getByRole('region', { name: 'Updates' }).getByRole('listitem');
    await expect(updates).toHaveText([/^Delivered.*Swiftlane/, /^Out for delivery.*Parcelkit/, /^Shipped.*This email$/]);

    await updates.first().getByRole('button', { name: /^Delivered, .*Open email$/ }).click();
    await expect(mail.threadHeading).toHaveText('Delivered: SL 7702 4418 9023 6');
    // The carrier's email tells the same story from its side.
    const there = mail.thread.getByRole('region', { name: /Your package/ });
    await expect(there.locator('.smart-card__big')).toHaveText('Delivered');
    await expect(there.getByRole('region', { name: 'Updates' }).getByRole('listitem').first()).toContainText('This email');

    // The list row of the original email now reads Delivered too, and drops its Track chip.
    await mail.open('category/updates');
    const row = mail.row('Your Hollowpine Outfitters order has shipped');
    await expect(row.locator('.row__smart')).toContainText('Delivered');
    await expect(row.getByRole('button', { name: 'Track package' })).toHaveCount(0);
  });

  test('Mark as delivered on a package card sets it by hand, Worth a look follows, and it goes back to the emails', async ({ mail, page }) => {
    await openThread(mail, 'category/updates/x-stride-shipped');
    const card = mail.thread.getByRole('region', { name: /Your package/ });
    await expect(card.locator('.smart-card__big')).toHaveText('Shipped');

    await card.getByRole('button', { name: 'Package options' }).click();
    await page.getByRole('menuitem', { name: 'Mark as delivered' }).click();
    await expect(card.locator('.smart-card__big')).toHaveText('Delivered');
    await expect(card.locator('.smart-card__note').first()).toContainText('set by you');
    await expect(mail.snackbar).toContainText('Marked as delivered');

    // The board and the row read the hand-set status after a reload too.
    await mail.open('inbox', 'latency=0');
    const glance = page.getByRole('region', { name: 'At a glance' });
    await expect(glance.getByRole('button', { name: /^Delivered Stride/ })).toBeVisible();
    await expect(glance.getByRole('button', { name: /^Shipped Stride/ })).toHaveCount(0);

    await openThread(mail, 'category/updates/x-stride-shipped');
    await mail.thread.getByRole('button', { name: 'Package options' }).click();
    await page.getByRole('menuitem', { name: 'Use status from emails' }).click();
    await expect(mail.thread.getByRole('region', { name: /Your package/ }).locator('.smart-card__big')).toHaveText('Shipped');
  });

  test('Add to Packages in the message menu turns an order email into a tracked package', async ({ mail, page }) => {
    await openThread(mail, 'category/updates/u-oakline');
    await expect(mail.thread.getByRole('region', { name: /Your package/ })).toHaveCount(0);

    // The message's own More menu, not the conversation toolbar's.
    const messageMore = mail.thread.locator('[data-mid]').last().getByRole('button', { name: 'More', exact: true });
    await messageMore.click();
    await page.getByRole('menuitem', { name: 'Add to Packages' }).click();

    // One step: what the email says about the order fills it in.
    const card = mail.thread.getByRole('region', { name: 'Your package from Oakline Home' });
    await expect(card.locator('.smart-card__big')).toHaveText('Ordered');
    await expect(mail.snackbar).toContainText('Added your Oakline Home order to Packages');

    // Added by hand, so the menus offer to take it out again.
    await messageMore.click();
    await page.getByRole('menuitem', { name: 'Remove from Packages' }).click();
    await expect(card).toHaveCount(0);
  });

  test('a flight email shows the route and copies the confirmation', async ({ mail, page, context, browserName }) => {
    const canRead = await allowClipboard(context, browserName);
    await openThread(mail, 'category/updates/u-albatross');
    const card = mail.thread.locator('section[data-kind="flight"]');

    await expect(card.locator('.smart-card__route')).toHaveText(/SFO\s*\S*\s*LIS/);
    await expect(card).toContainText('K7XQ2M');

    const copy = card.getByRole('button', { name: 'Copy confirmation' });
    await copy.click();

    await expect(copy).toHaveAttribute('data-confirmed', 'true');
    await expect(mail.announced('Confirmation copied')).toHaveCount(1);
    if (canRead) expect(await clipboard(page)).toBe('K7XQ2M');
  });

  test('the invite card answers Yes, the reply is in Sent, and the answer survives a reload', async ({ mail }) => {
    await openThread(mail, 'inbox/t-design-crit-invite');
    const card = mail.thread.getByRole('region', { name: 'Design crit' });
    await expect(card).toContainText('When');
    await expect(card).toContainText('Where');
    await expect(card).toContainText('Lighthouse, 3rd floor');
    await expect(card).toContainText('Guests');
    await expect(card).toContainText('4 guests');

    const going = card.getByRole('radiogroup', { name: 'Going?' });
    await going.getByRole('radio', { name: 'Yes' }).click();

    await expect(mail.snackbar).toContainText('Accepted "Design crit". Priya Natarajan will get your reply.');
    // The reply lands in the conversation as a message from me.
    await expect(mail.thread.locator('[data-mid]').last().frameLocator('iframe').locator('body')).toContainText('Alex Rivera has accepted this invitation.');
    await expect(going.getByRole('radio', { name: 'Yes' })).toHaveAttribute('aria-checked', 'true');

    // The reply is threaded into the invite, so Sent lists it under the invite's subject.
    await mail.nav.getByRole('link', { name: /^Sent/ }).click();
    await expect(mail.row('Invitation: Design crit')).toContainText('Alex Rivera has accepted this invitation.');

    // A fresh load (the demo mailbox resets) still shows how I answered.
    await openThread(mail, 'inbox/t-design-crit-invite');
    await expect(mail.thread.getByRole('region', { name: 'Design crit' }).getByRole('radio', { name: 'Yes' })).toHaveAttribute('aria-checked', 'true');
  });

  test('RSVP chips on an inbox row send a reply', async ({ mail }) => {
    await mail.open('inbox');
    const row = mail.row('Updated invitation: Pricing research readout');
    await row.getByRole('radiogroup', { name: 'Reply to invitation' }).getByRole('radio', { name: 'Yes' }).click();

    await expect(mail.snackbar).toContainText('Accepted "Pricing research readout". Hannah Kowalczyk will get your reply.');
    // The chip answers without opening the thread.
    await expect(mail.page).toHaveURL(/#inbox$/);

    // Opened afterwards, the reply is the newest message, so it opens expanded.
    await mail.rowBody('Updated invitation: Pricing research readout').click();
    await expect(mail.thread.frameLocator('iframe.msg__frame').last().getByText('Alex Rivera has accepted this invitation.')).toBeVisible();
    await expect(mail.thread.getByRole('region', { name: 'Pricing research readout' }).getByRole('radio', { name: 'Yes' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Purchases gathers packages, bills and receipts', async ({ mail, page }) => {
    await mail.open('purchases');
    await expect(page.getByRole('heading', { level: 1, name: 'Purchases' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Packages' })).toBeVisible();

    // Shipped, out for delivery and delivered are one Oakline package: one tile at its newest status,
    // and no leftover "Out for delivery" tile. The only package still moving is the Stride order.
    const oakline = page.getByRole('article').filter({ hasText: 'Oakline Home' });
    await expect(oakline).toHaveCount(1);
    await expect(oakline).toContainText('Delivered');
    await expect(page.getByRole('article').filter({ hasText: 'Out for delivery' })).toHaveCount(0);
    await expect(page.getByText('1 package on the way.')).toBeVisible();
    // Hollowpine's four emails are one delivered tile; Larkspur's order from last month never wrote again and isn't counted.
    await expect(page.getByRole('article').filter({ hasText: 'Hollowpine Outfitters' })).toContainText('Delivered');
    const quiet = page.getByRole('article').filter({ hasText: 'No news since' });
    await expect(quiet).toHaveCount(1);
    await expect(quiet.getByRole('button', { name: 'Track' })).toHaveCount(0);

    await expect(page.getByRole('heading', { level: 2, name: 'Bills' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Bayline/ })).toContainText('$58.12');

    await expect(page.getByRole('heading', { level: 2, name: 'Receipts' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Reelhouse/ })).toContainText('$15.99');
  });

  test('Spam: the banner explains, and links in the body do nothing', async ({ mail, page, context, browserName }) => {
    await stubSite(context, '**/prize-center.example/**');
    await openThread(mail, 'spam/x-spam-prize');
    await expect(mail.thread.getByRole('note').filter({ hasText: 'Why is this message in spam?' })).toBeVisible();

    let popups = 0;
    page.on('popup', () => popups++);
    // The link is aria-disabled on purpose; click it anyway like a person would.
    const claim = page.frameLocator('iframe.msg__frame').getByRole('link', { name: 'CLAIM NOW' });
    // Centred, so the pinned reply bar can't be what a forced click lands on.
    await claim.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await claim.click({ force: true });

    // WebKit doesn't run the parent's listener inside a script-less sandbox, so only
    // Chromium and Firefox can explain; every engine must still refuse to navigate.
    if (browserName !== 'webkit') await expect(mail.snackbar).toContainText('Links are turned off');
    await expect(page).toHaveURL(/#spam\/x-spam-prize$/);
    expect(popups).toBe(0);
  });

  test('a Japanese message offers a translation', async ({ mail, page, context }) => {
    await stubSite(context, 'https://translate.google.com/**');
    await openThread(mail, 'inbox/t-kenji-tokyo');
    const banner = mail.thread.getByRole('note').filter({ hasText: 'This message is in Japanese.' });
    await expect(banner).toBeVisible();

    const popup = page.waitForEvent('popup');
    await banner.getByRole('button', { name: 'Translate to English' }).click();
    const tab = await popup;
    await tab.waitForLoadState('domcontentloaded');
    const url = new URL(tab.url());
    expect(url.hostname).toBe('translate.google.com');
    expect(url.searchParams.get('tl')).toBe('en');
    expect(url.searchParams.get('text')).toContain('東京');
  });

  /** Opens Block from the newest message's More menu; `how` picks mouse or keyboard. */
  async function chooseBlock(mail: Mail, how: 'mouse' | 'keyboard') {
    const msg = mail.thread.locator('.msg--expanded').last();
    const email = (await msg.locator('.msg__email').innerText()).replace(/[<>]/g, '');
    await msg.getByRole('button', { name: 'More' }).click();
    const item = mail.page.getByRole('menuitem', { name: /^Block / });
    if (how === 'mouse') await item.click();
    else {
      await item.focus();
      await mail.page.keyboard.press('Enter');
    }
    return email;
  }

  test('clicking Block in the message menu asks to confirm', async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-kenji-tokyo');
    const email = await chooseBlock(mail, 'mouse');
    await expect(page.getByRole('dialog', { name: /^Block / })).toContainText(`New messages from ${email} will go to Spam.`, { timeout: 3_000 });
  });

  test('a blocked sender is listed in Settings > Inbox, and Unblock removes them', async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-kenji-tokyo');
    // Keyboard, because a mouse click on the menu item is broken (see the test above).
    const email = await chooseBlock(mail, 'keyboard');
    const confirm = page.getByRole('dialog', { name: /^Block / });
    await expect(confirm).toContainText(`New messages from ${email} will go to Spam.`);
    await confirm.getByRole('button', { name: 'Block', exact: true }).click();
    await expect(mail.snackbar).toContainText(`Blocked ${email}`);

    await page.getByRole('banner').getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Quick settings' }).getByRole('button', { name: 'See all settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Inbox' }).click();
    await expect(settings.getByRole('heading', { name: 'Blocked senders' })).toBeVisible();
    const entry = settings.locator('.settings-list__item').filter({ hasText: email });
    await expect(entry).toBeVisible();

    await entry.getByRole('button', { name: 'Unblock' }).click();

    await expect(entry).toHaveCount(0);
    await expect(settings).toContainText('Nobody is blocked.');
  });

  test('scheduled mail shows at the top of the inbox and Scheduled moves up in the rail', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(page.getByRole('heading', { level: 2, name: 'Scheduled' })).toBeVisible();
    const row = page.getByRole('button', { name: /Sends tomorrow/ });
    await expect(row).toContainText('Weekly design update');
    await expect(page.getByRole('navigation', { name: 'Mailboxes' }).getByRole('link', { name: /^Scheduled/ })).toBeVisible();

    await row.click();
    await expect(page).toHaveURL(/#scheduled\//);
    await expect(page.getByText(/Send scheduled for/)).toBeVisible();
  });

  test('sent nudges: dismissing one keeps it dismissed after a reload', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(page.getByRole('heading', { level: 2, name: 'Follow-ups' })).toBeVisible();
    const nudges = page.getByRole('button', { name: /Follow up\?/ });
    await expect(nudges.first()).toBeVisible();
    const target = nudges.filter({ hasText: 'Weekly design update' });
    await expect(target).toContainText(/Sent \d+ days ago\. Follow up\?/);

    await target.getByRole('button', { name: 'Dismiss this nudge' }).click();

    await expect(target).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 2, name: 'Follow-ups' })).toBeVisible();
    await expect(nudges.first()).toBeVisible();
    await expect(target).toHaveCount(0);
  });

  test('hovering a sender shows a card with their address and actions', async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-design-crit-invite');
    const msg = mail.thread.locator('.msg--expanded').last();
    const email = (await msg.locator('.msg__email').innerText()).replace(/[<>]/g, '');

    await msg.locator('.msg__from').hover();

    const card = page.locator('.sender-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText(email);
    for (const name of ['Email', 'Copy', 'Emails']) await expect(card.getByRole('button', { name, exact: true })).toBeVisible();
  });

  test('clicking a sender opens the same card, without folding the message', async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-design-crit-invite');
    const msg = mail.thread.locator('.msg--expanded').last();
    await msg.locator('.msg__from').click();
    await expect(page.locator('.sender-card')).toBeVisible();
    await expect(msg).toBeVisible();
  });

  test("the message details list each person with their address and what's sent when", async ({ mail, page }) => {
    await openThread(mail, 'inbox/t-design-crit-invite');
    const msg = mail.thread.locator('.msg--expanded').last();
    const email = (await msg.locator('.msg__email').innerText()).replace(/[<>]/g, '');
    await msg.locator('.msg__to').click();
    const details = page.getByRole('dialog', { name: 'Message details' });
    await expect(details.getByRole('region', { name: 'From' })).toContainText(email);
    await expect(details.getByRole('region', { name: 'To' })).toContainText('(you)');
    await expect(details).toContainText('Date');
    await expect(details.getByRole('button', { name: `Copy ${email}` })).toBeAttached();
  });
});

test.describe('pull to refresh @phone', () => {
  test('dragging down at the top of the list refreshes it', async ({ mail, page }) => {
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible();
    const scroller = page.locator('.list-scroll');
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(0);
    const refreshing = page.getByRole('progressbar', { name: 'Refreshing' });
    await expect(refreshing).toHaveCount(0);

    await scroller.evaluate((el) => {
      const fire = (type: string, y: number) => {
        const point = { identifier: 1, target: el, clientX: 180, clientY: y, pageX: 180, pageY: y, screenX: 180, screenY: y };
        let ev: Event;
        try {
          const touch = new Touch(point);
          ev = new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [touch], changedTouches: [touch] });
        } catch {
          // WebKit has no Touch constructor; give a plain event the same shape.
          ev = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [point] });
          Object.defineProperty(ev, 'changedTouches', { value: [point] });
        }
        el.dispatchEvent(ev);
      };
      fire('touchstart', 200);
      for (let y = 240; y <= 420; y += 30) fire('touchmove', y);
      fire('touchmove', 420);
      fire('touchend', 420);
    });

    await expect(refreshing.first()).toBeVisible();
    await expect(refreshing).toHaveCount(0);
    await expect(mail.rows.first()).toBeVisible();
  });
});
