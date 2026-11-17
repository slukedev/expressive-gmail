import { defineConfig, devices } from '@playwright/test';
import { ownPreview } from './scripts/preview-checkout.mjs';

const PHONE = /@phone/;
const PORT = Number(process.env.PREVIEW_PORT) || 5199;
const ORIGIN = `http://localhost:${PORT}`;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: CI,
  // GitHub's 2-core runners run these several times slower than a laptop: more time and one more try,
  // but a test that only passes on the retry still fails the run.
  retries: CI ? 1 : 0,
  failOnFlakyTests: CI,
  timeout: CI ? 60_000 : 30_000,
  reporter: [...(CI ? [['github'] as const] : []), ['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  expect: { timeout: CI ? 15_000 : 7_000 },
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },
  webServer: {
    command: 'npx vite --config vite.preview.config.ts',
    url: ORIGIN,
    // A preview already running from this checkout is reused; one from anywhere else stops the run.
    reuseExistingServer: await ownPreview(ORIGIN, import.meta.dirname),
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: PHONE },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grepInvert: PHONE },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, grepInvert: PHONE },
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit', hasTouch: true },
      grep: PHONE,
    },
  ],
});
