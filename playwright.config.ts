import { defineConfig, devices } from '@playwright/test';

const PHONE = /@phone/;
const PORT = Number(process.env.PREVIEW_PORT) || 5199;
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // GitHub's 2-core runners run these several times slower than a laptop: more time, one more try.
  retries: process.env.CI ? 2 : 0,
  timeout: process.env.CI ? 60_000 : 30_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  expect: { timeout: process.env.CI ? 15_000 : 7_000 },
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
    reuseExistingServer: true,
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
