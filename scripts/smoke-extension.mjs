// Loads the built Chrome extension against a stubbed mail.google.com and checks the app mounts.
// Run after `npm run build:chrome`: node scripts/smoke-extension.mjs [screenshot.png] [--phone]
// --phone runs it as Chrome on an Android phone: Gmail must be asked for its desktop client,
// mobile Gmail must send the tab there, and the app must fill the phone's screen.
import { chromium } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
const phone = process.argv.includes('--phone');
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const ext = path.resolve('.output/chrome-mv3');
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  // The flag reaches the extension's background too, which is where the phone is recognized.
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, ...(phone ? [`--user-agent=${PHONE_UA}`] : [])],
  ...(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: PHONE_UA } : {}),
});
const asked = [];
await ctx.route('https://mail.google.com/**', (route) => {
  asked.push(new URL(route.request().url()).pathname);
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Gmail</title><body><div id="gmail">Old Gmail UI</div></body>' });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
if (phone) {
  // The background installs its rule when it starts; give it a moment, as a real first launch would have.
  await page.waitForTimeout(1500);
  await page.goto('https://mail.google.com/mail/mu/mp/42/#tl/priority');
  await page.waitForURL(/\/mail\/u\/0\//, { timeout: 5000 }).catch(() => undefined);
} else {
  await page.goto('https://mail.google.com/mail/u/0/#inbox');
}
await page.waitForTimeout(4000);
const root = await page.$('#better-gmail-root iframe');
console.log('iframe mounted:', !!root, 'title:', await page.title());
const frame = root && (await root.contentFrame());
if (frame) console.log('frame url:', frame.url(), '\nframe text:', (await frame.locator('body').innerText()).slice(0, 200));
if (phone) {
  // Playwright sees requests before the extension rewrites their headers, so the rule is read from the extension instead.
  const [worker] = ctx.serviceWorkers();
  console.log('desktop rule:', JSON.stringify(await worker?.evaluate(() => chrome.declarativeNetRequest.getDynamicRules())));
  console.log('pages asked for:', asked);
  console.log('page url:', page.url());
  console.log(
    'layout:',
    await page.evaluate(() => ({
      viewport: [...document.querySelectorAll('meta[name="viewport"]')].map((m) => m.content),
      innerWidth,
      frame: document.querySelector('#better-gmail-root iframe')?.getBoundingClientRect().toJSON(),
      scrollWidth: document.documentElement.scrollWidth,
      gmailSees: navigator.userAgent,
    })),
  );
}
const shotPath = process.argv.find((a) => a.endsWith('.png')) ?? path.join(os.tmpdir(), 'better-gmail-smoke.png');
await page.screenshot({ path: shotPath });
console.log('screenshot:', shotPath);
console.log('errors:', errors);
await ctx.close();
