import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The installed app's API belongs to the page hosting the frame (src/shared/pwa-host.ts).
// preview/frame.html fakes that page: `?app=install` offers to install, `?app=standalone` is the app.
test.use({ viewport: { width: 1366, height: 768 } });

async function openApp(page: Page, mode: 'install' | 'standalone', hash = 'inbox') {
  await page.goto(`/preview/frame.html?latency=0&app=${mode}#${hash}`);
  const app = page.frameLocator('iframe');
  await expect(app.getByRole('list', { name: 'Conversations' }).getByRole('listitem').first()).toBeVisible();
  return app;
}

async function openSettings(app: FrameLocator, section: string) {
  await app.locator('.account-btn').click();
  await app.getByRole('menu').getByRole('menuitem', { name: 'All settings' }).click();
  const dialog = app.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click();
  await expect(dialog.getByRole('heading', { name: section, level: 2, exact: true })).toBeVisible();
  return dialog;
}

const hostValue = <T>(page: Page, key: string) => page.evaluate((k) => (window as unknown as Record<string, unknown>)[k], key) as Promise<T>;

test('Settings > App installs, then sets what the icon badge shows', async ({ mail, page }) => {
  void mail;
  const app = await openApp(page, 'install');
  // The badge follows the inbox's unread count from the start.
  const unread = Number(/(\d+)/.exec(await app.getByRole('navigation', { name: 'Mailboxes' }).getByRole('link', { name: /^Inbox/ }).innerText())?.[1]);
  expect(unread).toBeGreaterThan(0);
  await expect.poll(() => hostValue(page, '__appBadge')).toBe(unread);

  const dialog = await openSettings(app, 'App');
  await dialog.getByRole('button', { name: 'Install' }).click();
  await expect.poll(() => hostValue<string[]>(page, '__appCalls')).toContain('app-install');
  // Installed: the offer goes, the badge choice stays.
  await expect(dialog.getByRole('button', { name: 'Install' })).toHaveCount(0);

  const badge = dialog.getByRole('combobox', { name: 'Icon badge' });
  await expect(badge).toContainText('Unread count');
  await badge.click();
  await app.getByRole('option', { name: 'Dot' }).click();
  await expect.poll(() => hostValue(page, '__appBadge')).toBe('dot');
  await badge.click();
  await app.getByRole('option', { name: 'Off' }).click();
  await expect.poll(() => hostValue(page, '__appBadge')).toBeNull();

  await dialog.getByRole('button', { name: 'Allow' }).click();
  await expect(app.getByRole('region', { name: 'Notifications' })).toContainText('Confirm in your browser to finish.');
});

test('without an app host, Settings has no App section', async ({ mail, page }) => {
  await mail.open('inbox');
  await expect(mail.rows.first()).toBeVisible();
  await page.locator('.account-btn').click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'All settings' }).click();
  const nav = page.getByRole('dialog', { name: 'Settings' }).getByRole('navigation', { name: 'Settings sections' });
  await expect(nav.getByRole('button', { name: 'Connection' })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'App', exact: true })).toHaveCount(0);
});

test('launches open what they ask for: an email link, a share, files and a shortcut', async ({ mail, page }) => {
  void mail;
  const app = await openApp(page, 'standalone');
  const composer = app.getByRole('region').filter({ has: app.getByRole('combobox', { name: 'To' }) });

  // Settings open over the mail steps aside.
  await app.locator('.account-btn').click();
  await app.getByRole('menu').getByRole('menuitem', { name: 'All settings' }).click();
  await expect(app.getByRole('dialog', { name: 'Settings' })).toBeVisible();

  await page.evaluate(() => (window as unknown as { __launch(l: unknown): void }).__launch({ kind: 'mailto', href: 'mailto:sam.okafor@example.com?subject=Lunch%20Friday&body=Noon%20works.' }));
  await expect(app.getByRole('dialog', { name: 'Settings' })).toBeHidden();
  await expect(composer).toHaveAccessibleName('Lunch Friday');
  await expect(composer.getByRole('button', { name: /Remove .*sam\.okafor@example\.com|Remove Sam/i })).toBeVisible();
  await expect(composer.getByRole('textbox', { name: 'Message body' })).toContainText('Noon works.');
  await composer.getByRole('button', { name: /Discard|Close/ }).first().click();

  await page.evaluate(() =>
    (window as unknown as { __launch(l: unknown): void }).__launch({ kind: 'share', title: 'Trail map', text: 'For Saturday', url: 'https://example.com/trails' }),
  );
  const shared = app.getByRole('region', { name: 'Trail map' });
  await expect(shared.getByRole('textbox', { name: 'Message body' })).toContainText('For Saturday');
  await expect(shared.getByRole('textbox', { name: 'Message body' })).toContainText('https://example.com/trails');

  await page.evaluate(() =>
    (window as unknown as { __launch(l: unknown): void }).__launch({ kind: 'files', files: [new File(['Packing list'], 'packing.txt', { type: 'text/plain' })] }),
  );
  await expect(app.getByText('packing.txt')).toBeVisible();

  await page.evaluate(() => (window as unknown as { __launch(l: unknown): void }).__launch({ kind: 'route', hash: '#starred' }));
  await expect(app.getByRole('navigation', { name: 'Mailboxes' }).getByRole('link', { name: /^Starred/ })).toHaveAttribute('aria-current', 'page');
});
