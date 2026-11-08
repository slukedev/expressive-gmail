import { FRAME_STYLE } from '../../src/shared/frame';
import { DEFAULT_SEED, expect, test } from './fixtures';

// Inside Gmail the app runs in an extension iframe. This host page embeds the
// preview the same way, so the system-theme contract is tested where it broke.
const HOST = `http://localhost:${process.env.PREVIEW_PORT || 5199}/__host`;

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket((url) => url.searchParams.has('token'), () => {});
  await page.addInitScript((value) => {
    if (!window.localStorage.getItem('bg.settings.v1')) window.localStorage.setItem('bg.settings.v1', value);
  }, JSON.stringify({ ...DEFAULT_SEED, themeMode: 'system' }));
  await page.route(HOST, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html style="color-scheme:normal"><body style="margin:0;height:100vh">
        <iframe title="Gmail" src="/?latency=0#inbox" style="${FRAME_STYLE}"></iframe></body></html>`,
    }),
  );
});

function appRoot(page: import('@playwright/test').Page) {
  return page.frameLocator('iframe[title="Gmail"]').locator('html');
}

test('system theme: the embedded app opens in the system scheme, dark or light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(HOST);
  await expect(appRoot(page)).toHaveAttribute('data-theme-mode', 'dark');

  // Live changes reach the frame through the Gmail page's relay (next test);
  // Chromium doesn't reliably fire a frame's own change event under load.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(appRoot(page)).toHaveAttribute('data-theme-mode', 'light');
});

test('system theme: a scheme relayed by the Gmail page wins over the frame', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(HOST);
  await expect(appRoot(page)).toHaveAttribute('data-theme-mode', 'light');

  const relay = (dark: boolean) =>
    page.evaluate((d) => {
      const frame = document.querySelector('iframe')!;
      frame.contentWindow!.postMessage({ source: 'better-gmail/content', type: 'scheme', dark: d }, '*');
    }, dark);
  await relay(true);
  await expect(appRoot(page)).toHaveAttribute('data-theme-mode', 'dark');
  await relay(false);
  await expect(appRoot(page)).toHaveAttribute('data-theme-mode', 'light');
});
