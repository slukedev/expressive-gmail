# Expressive Gmail: notes for agents

Read README.md first. PRODUCT.md holds product truth, DESIGN.md the visual system.

## Rules

- One codebase for Chrome, Firefox and Safari, desktop and phone (Firefox for Android, Safari on iOS via `npm run safari:ios`). Always build with `--mv3`. Safari has no main-world content scripts and no identity API, and neither has Firefox for Android; check both when touching entrypoints or auth. Phones load desktop Gmail through `src/shared/mobile.ts`; `node scripts/smoke-extension.mjs --phone` checks that path.
- Every mail source implements `src/app/data/backend.ts`. UI code never imports a backend directly; it goes through `backend()` in `src/app/data/client.ts`, and gates features on `capabilities`.
- All inboxes and circles run on a merged backend whose ids are `<account key>~<id>` (`src/app/data/accounts/ids.ts`). Anything kept in this browser per thread (pins, notes, reminders, dismissed nudges) is keyed by `rawId()`; never compare a stored id with a list id directly. "Me" is a set of addresses: use `useMe()` / `isMe()`, not `account.email`.
- The installed app's APIs (manifest, install, badge, `mailto:`, launches) belong to the top page: `src/shared/pwa-host.ts` in the content script owns them, and the frame asks through `src/app/lib/appHost.ts`. `preview/frame.html?app=install|standalone` fakes that page for tests.
- Mutations go through `mail.*` in `src/app/data/actions.ts` so they get optimistic updates, undo and error snackbars.
- Design tokens only. Colors are `--md-sys-color-*` roles (Google's web palette by default, Material You dynamic schemes optionally); shape, motion and type come from `src/app/theme/tokens.css`.
- No borders on one side of a container, no em dashes, no bounce easing (UI springs use the 0.8-damped curve), no AI-sounding copy.
- Icons are a subset font. New icon names go in `src/app/ui/icon-names.json`, then `npm run fonts`.
- Demo content is fictional (example.com domains, invented brands). Never add real people or companies.
- Test against the demo mailbox (`npm run preview`, port 5199). Never point automated tests at a real Gmail account.

## Checks before reporting

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

`node scripts/capture.mjs <dir> [filter]` screenshots every major state of the preview for visual review.
