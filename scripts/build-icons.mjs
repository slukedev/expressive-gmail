// Renders the toolbar and app icon PNGs from an SVG: node scripts/build-icons.mjs public/icon/icon.svg public/icon
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const svg = fs.readFileSync(process.argv[2], 'utf8');
const out = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const sized = (s) => svg.replace('<svg ', `<svg width="${s}" height="${s}" `);
for (const s of [16, 32, 48, 96, 128, 192, 512]) {
  await page.setViewportSize({ width: s, height: s });
  await page.setContent(`<html><body style="margin:0;background:transparent">${sized(s)}</body></html>`);
  await page.screenshot({ path: `${out}/${s}.png`, omitBackground: true });
}
// Maskable: the launcher crops to its own shape, so the envelope alone sits well inside its safe zone, on its own blue.
const s = 512;
const mark = s;
await page.setViewportSize({ width: s, height: s });
await page.setContent(
  `<html><body style="margin:0;width:${s}px;height:${s}px;background:#0b57d0;display:grid;place-items:center">${svg
    .replace('<svg ', `<svg width="${mark}" height="${mark}" `)
    .replace(/<g transform="translate\(4 4\) scale\(120\)">[\s\S]*?<\/g>/, '')}</body></html>`,
);
await page.screenshot({ path: `${out}/maskable-512.png` });
await browser.close();
