// Renders the toolbar icon PNGs from an SVG: node scripts/build-icons.mjs public/icon/icon.svg public/icon
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const svg = fs.readFileSync(process.argv[2], 'utf8');
const out = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const s of [16, 32, 48, 96, 128]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`);
  await page.screenshot({ path: `${out}/${s}.png`, omitBackground: true });
}
await browser.close();
