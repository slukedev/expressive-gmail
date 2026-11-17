# Contributing

Thanks for helping. Bug reports, fixes and small features are all welcome. For anything large (a new backend, a new page, a change to how accounts work), open an issue first so we can agree on the shape before you write it.

Read [README.md](README.md) for how the extension works, [PRODUCT.md](PRODUCT.md) for what it should and shouldn't do, and [DESIGN.md](DESIGN.md) for the visual system.

## Setup

You need Node 22.22.2+, 24.15+ or 26+ and npm. CI runs on all three.

```bash
npm install
```

```bash
npm run preview
```

That serves the UI at http://localhost:5199 against the demo mailbox, with hot reload. Most work happens here. `npm run dev` runs the real extension in a fresh Chrome profile when you need to check something on mail.google.com.

For the Playwright suite, install the browsers once:

```bash
npx playwright install chromium webkit firefox
```

## Test against the demo mailbox only

The demo mailbox (`src/app/data/demo/`) is a synthetic inbox with fictional people and companies. Unit tests, end-to-end tests and screenshots all run against it.

Never point automated tests, scripts or screenshot tools at a real Gmail account, yours or anyone else's. Session backend tests use recorded fixtures in `tests/session/fixtures/`; Gmail API tests use a fake `fetch`. If you need a new Gmail response shape, write a synthetic fixture and strip every real address, name and token from anything you capture by hand.

Demo content stays fictional: `example.com` and `example.org` addresses, invented brands, no real people or companies.

## Checks

Run all three before opening a pull request:

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

`npm run lint` runs ESLint; CI allows no warnings.

On every pull request and every push to `main`, CI runs:

- typecheck, lint and Vitest, with Vitest repeated on Node 22 and 26, in Europe/Berlin in German and in Pacific/Chatham;
- the Chrome, Firefox and Safari builds, the check that no build carries the demo mailbox, and the store zips;
- `scripts/smoke-extension.mjs` on desktop and phone, which also fails if installing, updating or starting the extension opens a tab;
- Playwright on Chromium, Firefox, WebKit and the phone profile on Linux, and WebKit and the phone profile on macOS;
- unsigned builds of the Mac and iPhone apps.

A Playwright test gets one retry in CI, and a test that passes only on its retry still fails the run. Failed runs keep the HTML report, traces and screenshots as artifacts for a week.

Unit tests run in New York time and US English on every machine. Tests that expect US English dates or numbers check `usEnglish` from `tests/locale.ts` and skip in other languages. To reproduce the Berlin job locally: `TEST_TZ=Europe/Berlin TEST_LANG=de_DE.UTF-8 npm test`.

`npm run test:e2e` starts the preview itself, or reuses one already running from this checkout. If something else holds the port (another worktree's preview, another app), it stops with an error instead of testing the wrong code; stop that server or set `PREVIEW_PORT`.

TypeScript stays on 6.x until typescript-eslint supports TypeScript 7.

For visual changes, `node scripts/capture.mjs <dir> [filter]` screenshots the main states of the preview (it expects `npm run preview` to be running). Attach the before and after shots to your pull request.

## How the code is laid out

- All three browsers build from one codebase. Always build with `--mv3` (the npm scripts already do). Safari has no main-world content scripts and no `identity` API, so check Safari whenever you touch an entrypoint or sign-in.
- Every mail source implements `src/app/data/backend.ts`. UI code never imports a backend directly: it calls `backend()` from `src/app/data/client.ts` and checks `capabilities` before offering a feature.
- Ids in the UI look like `<account key>~<id>` because All inboxes and circles run on a merged backend (`src/app/data/accounts/ids.ts`). Anything stored per thread in the browser (pins, notes, reminders, dismissed nudges) is keyed by `rawId()`. "Me" can be several addresses, so use `useMe()` or `isMe()` instead of comparing with `account.email`.
- Mutations go through `mail.*` in `src/app/data/actions.ts`, which gives them optimistic updates, undo and error snackbars.

## Design rules

- Use the design tokens. Colors are `--md-sys-color-*` roles; shape, motion and type come from `src/app/theme/tokens.css`. No hard-coded colors or radii.
- No border on just one side of a container. Separate things with space or surface color instead.
- No bouncing. Springs use the 0.8-damped curve.
- No em dashes in UI text, and keep copy short and plain. Write it the way Gmail would.
- Every action needs a keyboard path, a visible focus ring and an accessible name, and has to respect reduced motion.

## Adding an icon

Icons come from a subset of Material Symbols Rounded, so a new name won't render until you rebuild the font:

1. Add the Material Symbols name to `src/app/ui/icon-names.json`.
2. Run `npm run fonts`. It needs Python 3 with `fonttools` and `brotli` (`pip install fonttools brotli`).
3. Commit the updated `public/fonts/symbols.woff2` and `src/app/ui/icon-codepoints.ts` with your change.

## Pull requests

Keep each pull request to one change, describe what you tested, and include screenshots for anything visible. By contributing you agree that your work is released under the [GNU General Public License v3.0](LICENSE).

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
