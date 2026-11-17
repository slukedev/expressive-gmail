import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// Expected dates and numbers are written for New York in en-US, whatever the machine runs.
// CI repeats the suite with TEST_TZ and TEST_LANG set to catch bugs that only show elsewhere.
// Test workers are separate processes that read these when they start, so ICU picks them up.
process.env.TZ = process.env.TEST_TZ || 'America/New_York';
process.env.LANG = process.env.LC_ALL = process.env.TEST_LANG || 'en_US.UTF-8';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    globals: true,
    environment: 'jsdom',
    pool: 'forks',
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**'],
    server: { deps: { inline: ['@material/material-color-utilities'] } },
  },
});
