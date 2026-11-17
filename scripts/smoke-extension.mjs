// Loads the built Chrome extension against a stubbed mail.google.com and fails when:
// - installing it, updating it or starting the browser opens any tab or window (Gmail opens only on a click),
// - the app doesn't mount in Gmail, or the page throws,
// - with --phone (Chrome on an Android phone): Gmail isn't asked for its desktop client, mobile Gmail
//   doesn't send the tab there, or the app doesn't fit the phone's screen.
// Run after `npm run build:chrome`: node scripts/smoke-extension.mjs [--phone] [--ext=<build dir>] [screenshot.png]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const phone = args.includes('--phone');
const ext = path.resolve(args.find((a) => a.startsWith('--ext='))?.slice('--ext='.length) ?? '.output/chrome-mv3');
const shotPath = args.find((a) => a.endsWith('.png')) ?? path.join(os.tmpdir(), `expressive-gmail-smoke${phone ? '-phone' : ''}.png`);
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const GMAIL = 'https://mail.google.com';

if (!fs.existsSync(path.join(ext, 'manifest.json'))) {
  console.error(`No extension build in ${ext}. Run npm run build:chrome first.`);
  process.exit(1);
}

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures.push(message);
};

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'expressive-gmail-smoke-'));
const asked = [];

const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      // Nothing reaches the network: a tab the extension opened before the stub below is in place goes nowhere.
      '--host-resolver-rules=MAP * ~NOTFOUND',
      // The flag reaches the extension's background too, which is where the phone is recognized.
      ...(phone ? [`--user-agent=${PHONE_UA}`] : []),
    ],
  ...(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: PHONE_UA } : {}),
});
await ctx.route(`${GMAIL}/**`, (route) => {
  asked.push(new URL(route.request().url()).pathname);
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Gmail</title><body><div id="gmail">Old Gmail UI</div></body>' });
});
const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 10_000 }));

// The background acts within a moment of an event; a tab it opens shows up in the context as a page.
async function opensNothing(when) {
  await new Promise((r) => setTimeout(r, 2500));
  const pages = ctx.pages();
  const urls = pages.map((p) => p.url());
  check(urls.length <= 1 && urls.every((u) => u === 'about:blank'), `${when} opens no tab or window (pages: ${urls.join(', ') || 'none'})`);
  await Promise.all(pages.slice(1).map((p) => p.close()));
}

// The install is real. Chrome reports every launch of an unpacked extension as an install, so the update
// and the browser start are sent to the background's own listeners the way Chrome would send them.
await opensNothing('installing');
await worker.evaluate(() => chrome.runtime.onInstalled.dispatch({ reason: 'update', previousVersion: '0.0.1' }));
await opensNothing('updating');
await worker.evaluate(() => chrome.runtime.onStartup.dispatch());
await opensNothing('starting the browser');

const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
if (phone) {
  await page.goto(`${GMAIL}/mail/mu/mp/42/#tl/priority`);
  await page.waitForURL(/\/mail\/u\/0\//, { timeout: 5000 }).catch(() => undefined);
  check(/\/mail\/u\/0\//.test(page.url()), `mobile Gmail sends the tab to the desktop client (${page.url()})`);
} else {
  await page.goto(`${GMAIL}/mail/u/0/#inbox`);
}
const root = await page.waitForSelector('#better-gmail-root iframe', { timeout: 10_000 }).catch(() => null);
check(!!root, 'the app mounts in Gmail');
const frame = root && (await root.contentFrame());
if (frame) await frame.waitForLoadState('load').catch(() => undefined);
await page.waitForTimeout(2000);
if (frame) console.log('     frame', frame.url());

// Playwright sees requests before the extension rewrites their headers, so the rule is read from the extension instead.
const rules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
if (phone) {
  const ua = rules.find((r) => r.condition.requestDomains?.includes('mail.google.com'))?.action.requestHeaders?.find((h) => h.header === 'user-agent')?.value;
  check(!!ua && !/Mobile|Android/.test(ua), `Gmail is asked for its desktop client (user agent: ${ua ?? 'not set'})`);
  const layout = await page.evaluate(() => ({
    innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    frameWidth: document.querySelector('#better-gmail-root iframe')?.getBoundingClientRect().width ?? 0,
  }));
  check(layout.scrollWidth <= layout.innerWidth, `nothing scrolls sideways (${layout.scrollWidth} of ${layout.innerWidth}px)`);
  check(Math.round(layout.frameWidth) === layout.innerWidth, `the app fills the screen's width (${layout.frameWidth} of ${layout.innerWidth}px)`);
  console.log('     pages asked for:', asked.join(' '));
} else {
  check(rules.length === 0, `a desktop browser keeps its own user agent (${rules.length} header rules)`);
}

await page.screenshot({ path: shotPath });
check(errors.length === 0, `the page throws nothing${errors.length ? `: ${errors.join(' | ')}` : ''}`);
console.log(`     screenshot ${shotPath}`);
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });

if (failures.length) {
  console.error(`\n${failures.length} smoke check${failures.length === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
