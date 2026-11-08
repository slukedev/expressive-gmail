import { expect, test } from './fixtures';

// Every demo call takes 2.4 to 5.6 s, like a Gmail tab that is still loading its session.
test.use({ query: 'latency=4000' });

test.describe('reload with a slow backend', () => {
  test('the last-seen inbox paints at once and refreshes; an archive made meanwhile sticks', async ({ mail, page }) => {
    test.slow();
    await mail.open('inbox');
    await expect(mail.rows.first()).toBeVisible({ timeout: 15_000 });
    // The cache is written shortly after fresh data lands.
    await expect.poll(() => page.evaluate(() => !!localStorage.getItem('bg.bootCache.v1')), { timeout: 10_000 }).toBe(true);

    await page.reload();
    // Before the backend's first answer (2.4 s at the earliest), so from the cache.
    await expect(mail.rows.first()).toBeVisible({ timeout: 2_300 });
    await expect(page.getByRole('progressbar', { name: 'Refreshing' })).toBeVisible();

    const subject = (await mail.rows.first().locator('[data-row-index]').getAttribute('aria-label'))!;
    const row = page.getByLabel(subject, { exact: true });
    await mail.rows.first().hover();
    await mail.rows.first().getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(row).toHaveCount(0);

    // Fresh data arrives, the archive goes through, and the row stays gone.
    await expect(page.getByRole('progressbar', { name: 'Refreshing' })).toBeHidden({ timeout: 15_000 });
    await expect(mail.snackbar).toContainText('Conversation archived', { timeout: 15_000 });
    await expect(row).toHaveCount(0);
  });
});
