// Renders the store screenshots and promo tiles into store/images/ from the demo mailbox:
//   node scripts/store-images.mjs [filter]
// Captures real UI from the preview (started here if it isn't running on 5199), then composes each
// slide from store/images/slides.html with Material shapes and Google Sans Flex.
//   store/images/web/        1280 x 800 PNG: Chrome Web Store (first five) and Firefox Add-ons
//   store/images/app-store/  2560 x 1600 PNG: Mac App Store
//   store/images/promo/      440 x 280 and 1400 x 560 Chrome Web Store promo tiles
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MaterialShapes, roundedPolygonToPath } from 'material-shapes-ts';

const only = process.argv[2];
const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'store/images');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'store-images-'));
const BASE = 'http://localhost:5199/';

async function up() {
  try {
    return (await fetch(BASE)).ok;
  } catch {
    return false;
  }
}
let server;
if (!(await up())) {
  server = spawn('npx', ['vite', '--config', 'vite.preview.config.ts', '--port', '5199', '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch();

// The grid every slide is laid out on (CSS px at 1280 x 800). Tiles are 48px squircles; anything shown in
// one sits `inset` from its edges with 28px corners, so inner and outer corners share a centre (48 = 28 + 20).
const grid = { M: 24, gap: 16, R: 48, inset: 20, ui: 28, pad: 40, W: 1280, H: 800, left: 480 };
grid.right = grid.W - 2 * grid.M - grid.left - grid.gap; // 736
grid.colH = grid.H - 2 * grid.M; // 752
const wide = grid.right - 2 * grid.inset; // 696: a card or pane filling a right-column tile
const narrow = grid.left - 2 * grid.inset; // 440: one filling a left-column tile

// 1. Captures: the real app at 2x, so the App Store set stays sharp.
// Each slide takes one Material You scheme; its captures share it, and the slide's own colours are
// read from the app (roles below), so the UI and the tiles around it are one tonal family.
// Cards and panes are captured at the exact size they're shown (`size`), on a transparent page,
// so their own 28px corners come through untouched instead of being scaled or cropped.
const green = { themeSource: 'dynamic', seed: '#386a20' };
const amber = { themeSource: 'dynamic', seed: '#8b5000' };
const dims = {};
const captures = {
  inbox: { hash: '#inbox' },
  glancePane: { settings: green, hash: '#inbox', element: '.detail-pane', size: () => [wide, grid.colH - 2 * grid.inset] },
  code: { settings: green, hash: '#category/updates/u-ledgerly-2fa', element: '.smart-card', size: () => [narrow] },
  teal: { settings: { themeSource: 'dynamic', seed: '#006a6a' } },
  purple: { settings: { themeSource: 'dynamic', seed: '#6750a4' } },
  pinkDark: { dark: true, settings: { themeSource: 'dynamic', seed: '#984061' } },
  palette: {
    dark: true,
    hash: '#inbox/t-onboarding-v4',
    boxes: ['.palette'],
    act: async (p) => {
      await p.keyboard.press('Control+k');
      await p.keyboard.type('sno');
    },
  },
  // Scrolled down to the newsletter itself, darkened.
  promoDark: {
    dark: true,
    hash: '#category/promotions/p-stride-2',
    element: '.detail-pane',
    size: () => [wide, grid.colH - 2 * grid.inset],
    act: async (p, box) => {
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.mouse.wheel(0, 380);
    },
  },
  amber: { settings: amber, hash: '#inbox' },
  // The tracker and the linked updates tell the story; the tracking number row and buttons would push the invite off the slide.
  package: {
    settings: amber,
    hash: '#category/updates/u-parcel-out',
    element: '.smart-card',
    size: () => [wide],
    act: (p) => hide(p, '.smart-card > .smart-card__row, .smart-card > .smart-card__actions, .pkg-updates > :nth-child(n + 3)'),
  },
  // Fills what the package card leaves of the column, so both tiles end on the grid.
  invite: {
    settings: amber,
    hash: '#inbox/t-design-crit-invite',
    element: '.smart-card',
    size: () => [wide, grid.colH - (dims.package.h + 2 * grid.inset) - grid.gap - 2 * grid.inset],
    act: (p) => hide(p, '.smart-card > .smart-card__row ~ .smart-card__row'),
  },
  deal: { settings: amber, hash: '#category/promotions/p-stride-2', element: '.smart-card', size: () => [narrow] },
};
const roles = {};
// Every capture is taken at the same morning hour, so the greeting matches "Your morning, sorted"
// and the list's times read like a real start to the day whenever the script runs.
const morning = new Date();
morning.setHours(9, 12, 0, 0);
const hide = (p, sel) => p.addStyleTag({ content: `${sel} { display: none !important; }` });

for (const [name, c] of Object.entries(captures)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: c.dark ? 'dark' : 'light', deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => localStorage.setItem('bg.settings.v1', JSON.stringify({ onboarded: true, ...s })), c.settings ?? {});
  const page = await ctx.newPage();
  await page.clock.setFixedTime(morning);
  await page.goto(`${BASE}?latency=0${c.hash}`);
  await page.waitForSelector('.app', { timeout: 15000 });
  await page.waitForTimeout(1400);
  roles[name] = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const r of ['primary', 'on-primary', 'primary-container', 'on-primary-container', 'secondary-container', 'on-secondary-container', 'tertiary', 'tertiary-container', 'on-tertiary-container', 'surface', 'on-surface', 'on-surface-variant', 'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest'])
      out[r] = cs.getPropertyValue(`--md-sys-color-${r}`).trim();
    return out;
  });
  const file = path.join(work, `${name}.png`);
  if (c.element) {
    const [w, h] = c.size();
    await page.evaluate(
      ({ sel, w, h }) => {
        const el = document.querySelector(sel);
        Object.assign(el.style, { width: `${w}px`, maxWidth: 'none', minWidth: '0', flex: 'none' });
        if (h) Object.assign(el.style, { height: `${h}px`, minHeight: '0', maxHeight: 'none', overflow: 'hidden' });
        // Clear everything behind it, so what's outside its corners stays transparent.
        for (let a = el.parentElement; a; a = a.parentElement) {
          a.style.setProperty('background', 'transparent', 'important');
          a.classList.add('store-clear');
        }
        const s = document.createElement('style');
        s.textContent = '.store-clear::before, .store-clear::after { background: transparent !important; }';
        document.head.append(s);
      },
      { sel: c.element, w, h },
    );
    await page.waitForTimeout(500);
    const el = page.locator(c.element).first();
    if (c.act) await c.act(page, await el.boundingBox());
    await page.waitForTimeout(800);
    const box = await el.boundingBox();
    dims[name] = { w: Math.round(box.width), h: Math.round(box.height) };
    await el.screenshot({ path: file, omitBackground: true });
  } else {
    if (c.act) await c.act(page);
    await page.waitForTimeout(800);
    // Where things sit in the capture, so a slide can frame them exactly.
    for (const sel of c.boxes ?? []) dims[`${name} ${sel}`] = await page.locator(sel).first().boundingBox();
    await page.screenshot({ path: file });
  }
  await ctx.close();
}

// 2. Slides: the template reads the captures, the shape paths and the font from here.
const shapes = Object.fromEntries(
  ['Cookie4Sided', 'Cookie9Sided', 'Cookie12Sided', 'Clover4Leaf', 'Clover8Leaf', 'Sunny', 'VerySunny', 'SoftBurst', 'Puffy', 'Flower', 'Pill', 'Square', 'Burst', 'Arch', 'Gem', 'Circle'].map((n) => [
    n,
    String(roundedPolygonToPath(MaterialShapes[n])),
  ]),
);
// Fonts go in as data URLs: Chromium won't apply a font file:// page loads from another folder.
const dataUrl = (file) => `data:font/woff2;base64,${fs.readFileSync(path.join(root, file)).toString('base64')}`;
const font = dataUrl('node_modules/@fontsource-variable/google-sans-flex/files/google-sans-flex-latin-full-normal.woff2');
const symbols = dataUrl('public/fonts/symbols.woff2');
// The icon subset is addressed by codepoint, not ligature (scripts/build_fonts.py).
const icons = Object.fromEntries(
  [...fs.readFileSync(path.join(root, 'src/app/ui/icon-codepoints.ts'), 'utf8').matchAll(/^\s+(\w+): (0x[0-9a-f]+),/gm)].map((m) => [m[1], Number(m[2])]),
);
const caps = Object.fromEntries(Object.keys(captures).map((n) => [n, pathToFileURL(path.join(work, `${n}.png`)).href]));
const html = fs
  .readFileSync(path.join(outDir, 'slides.html'), 'utf8')
  .replace('/*DATA*/', `window.DATA = ${JSON.stringify({ shapes, font, symbols, icons, caps, roles, dims, grid })};`);
const page = path.join(work, 'slides.html');
fs.writeFileSync(page, html);

const slides = [
  ['web', 1280, 800, 1, ''],
  ['app-store', 1280, 800, 2, '?mac'],
];
const ids = ['1-expressive', '2-at-a-glance', '3-themes', '4-command-palette', '5-smart-cards', '6-dark-theme'];
const tiles = [
  ['promo-small', 440, 280],
  ['promo-marquee', 1400, 560],
];

async function render(id, w, h, scale, file, query = '') {
  if (only && !id.includes(only)) return;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  const p = await ctx.newPage();
  await p.goto(`${pathToFileURL(page).href}${query}#${id}`);
  await p.waitForFunction(() => document.body.dataset.ready === '1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await p.screenshot({ path: file });
  await ctx.close();
  console.log(path.relative(root, file));
}

for (const [dir, w, h, scale, query] of slides) for (const id of ids) await render(id, w, h, scale, path.join(outDir, dir, `${id}.png`), query);
for (const [id, w, h] of tiles) await render(id, w, h, 1, path.join(outDir, 'promo', `${id}-${w}x${h}.png`));

await browser.close();
server?.kill();
fs.rmSync(work, { recursive: true, force: true });
