// Fails when a release build still carries the demo mailbox: node scripts/check-no-demo.mjs [.output/chrome-mv3 ...]
// Run it after `npm run build:chrome` (or any build). The demo is for the preview and dev builds only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['.output/chrome-mv3'];
// Strings only the demo's code and fixtures contain.
const MARKERS = ['createDemoBackend', 'createDemoDirectory', 'riverastudio.example.net', 'alexr.makes@example.org', 'Thimble & Oak', 'Showing the demo mailbox', 'Explore the demo'];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(m?js|html|json)$/.test(name)) yield path;
  }
}

let found = 0;
for (const dir of dirs) {
  for (const file of files(dir)) {
    const text = readFileSync(file, 'utf8');
    for (const marker of MARKERS) {
      if (text.includes(marker)) {
        console.error(`${file}: contains "${marker}"`);
        found++;
      }
    }
  }
}
if (found) {
  console.error(`The demo mailbox is in the build (${found} hits). Guard it with import.meta.env.DEV.`);
  process.exit(1);
}
console.log(`No demo mailbox in ${dirs.join(', ')}`);
