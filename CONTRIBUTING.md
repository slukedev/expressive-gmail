# Contributing

Thanks for helping. Bug reports, fixes and small features are all welcome. For anything large (a new backend, a new page, a change to how accounts work), open an issue first so we can agree on the shape before you write it.

Read [README.md](README.md) for how the extension works, [PRODUCT.md](PRODUCT.md) for what it should and shouldn't do, and [DESIGN.md](DESIGN.md) for the visual system.

## Setup

You need Node 22.22.2+, 24.15+ or 26+ (CI uses Node 24) and npm.

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

`npm run lint` runs ESLint. CI runs typecheck, lint, Vitest and the Chromium and WebKit Playwright projects on every pull request.

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
