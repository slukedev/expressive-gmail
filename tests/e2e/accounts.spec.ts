import { expect, test } from './fixtures';

test.describe('brand-new account', () => {
  test.use({ query: 'latency=0&empty' });

  test('inbox holds only the welcome message and Starred shows its empty state', async ({ mail, page }) => {
    await mail.open('inbox');

    await expect(mail.rows).toHaveCount(1);
    await expect(mail.row('Welcome to your new inbox')).toBeVisible();

    await mail.nav.getByRole('link', { name: 'Starred' }).click();

    await expect(page).toHaveURL(/#starred$/);
    await expect(page.getByRole('heading', { name: 'No starred messages' })).toBeVisible();
    await expect(mail.list).toHaveCount(0);
  });
});

test.describe('flaky backend', () => {
  test.use({ query: 'latency=0&chaos' });

  test('the app never goes blank, and a failed archive explains itself and rolls back', async ({ mail, page }) => {
    test.setTimeout(60_000);
    await mail.open('inbox');

    // Either the list or an error state with a way out, never an empty page.
    const retry = page.getByRole('button', { name: /try again|retry/i });
    await expect(mail.list.or(retry).first()).toBeVisible();
    for (let i = 0; i < 10 && !(await mail.list.isVisible()); i++) {
      await retry.first().click();
      await expect(mail.list.or(retry).first()).toBeVisible();
    }
    await expect(mail.list).toBeVisible();
    await expect(page.getByRole('main')).not.toBeEmpty();

    // Archive the top row until the backend drops one; the 30% fail rate makes that quick.
    let failed = false;
    for (let attempt = 0; attempt < 20 && !failed; attempt++) {
      const row = mail.rows.first();
      const label = (await row.locator('[data-row-index]').getAttribute('aria-label'))!;
      // A section above (Scheduled) can arrive late on this backend and move the row out from under the pointer: hover again.
      await expect(async () => {
        await row.hover();
        await row.getByRole('button', { name: 'Archive', exact: true }).click({ timeout: 2000 });
      }).toPass();

      // The newest one: the last archive's message may still be on its way out.
      const toast = mail.snackbar.getByText(/archived|Couldn't archive/).last();
      await expect(toast).toBeVisible();
      const said = await toast.innerText();
      if (/Couldn.t archive/.test(said)) {
        failed = true;
        await expect(mail.snackbar).toContainText("Couldn't archive.");
        // The optimistic removal is rolled back: the row is back in the list.
        await expect(page.getByLabel(label, { exact: true })).toBeVisible();
        // Retry runs the same archive again; at a 30% fail rate a few tries land it.
        for (let tries = 0; tries < 8; tries++) {
          await mail.snackbar.getByRole('button', { name: 'Retry', includeHidden: true }).last().click();
          const landed = await expect(mail.snackbar.getByText(/archived/).last())
            .toBeVisible({ timeout: 3000 })
            .then(() => true)
            .catch(() => false);
          if (landed) break;
        }
        await expect(mail.snackbar).toContainText('archived');
        await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
      } else {
        await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
      }
      // Base UI marks the close button aria-hidden while the toast is collapsed; it is still on screen.
      // A click retried on a slow machine can archive twice, so clear every message this round left.
      for (const dismiss of await mail.snackbar.getByRole('button', { name: 'Dismiss', includeHidden: true }).all()) await dismiss.click().catch(() => undefined);
      await expect(mail.snackbar.getByText(/archived|Couldn't archive/)).toHaveCount(0);
    }
    expect(failed, 'a 30% fail rate should drop one of 20 archives').toBe(true);

    // The UI recovers: the next attempts eventually go through.
    await expect(async () => {
      // A failure's snackbar (with Retry) waits 8s; clear it so it can't sit over the row.
      const dismiss = mail.snackbar.getByRole('button', { name: 'Dismiss', includeHidden: true });
      if (await dismiss.count()) await dismiss.last().click();
      // Row actions appear on pointer enter; a refetched row under a resting pointer never gets one.
      await page.mouse.move(0, 0);
      const row = mail.rows.first();
      const label = (await row.locator('[data-row-index]').getAttribute('aria-label'))!;
      await row.hover();
      await row.getByRole('button', { name: 'Archive', exact: true }).click({ timeout: 3_000 });
      await expect(mail.snackbar).toContainText('Conversation archived', { timeout: 2_000 });
      await expect(page.getByLabel(label, { exact: true })).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(mail.list).toBeVisible();
  });

  test('every view shows mail, an empty state, or an error with Try again that recovers', async ({ mail, page }) => {
    test.setTimeout(60_000);
    const views: [string, RegExp][] = [
      ['inbox', /Inbox/],
      ['starred', /Starred/],
      ['label/Work', /Work/],
      ['search/photos', /Search results/],
      ['inbox/t-lease-renewal', /Lease renewal/],
    ];
    for (const [hash, title] of views) {
      await mail.open(hash);
      const content = page.getByRole('heading', { level: 1, name: title });
      const failure = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Try again' }) });
      await expect(content.or(failure).first(), `#${hash} rendered something`).toBeVisible();
      await expect(async () => {
        if (await failure.isVisible()) await failure.getByRole('button', { name: 'Try again' }).click();
        await expect(content).toBeVisible({ timeout: 1_000 });
        await expect(failure).toBeHidden({ timeout: 1_000 });
      }, `#${hash} recovers`).toPass({ timeout: 15_000 });
    }
  });
});
