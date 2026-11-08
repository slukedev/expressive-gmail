---
version: 1
slug: "src-app-app-tsx"
primary_target: "src/app/App.tsx"
related_targets: ["src/app/features"]
---

# Surface brief: Gmail app shell (inbox, thread, compose)

Scope: the whole replacement UI rendered over mail.google.com. Mode: Operate.
Audience and job: daily Gmail users on desktop browsers triaging, reading and writing mail fast. Success: it reads as Google's own M3 Expressive Gmail, better than the Android app, with nothing lost.
Constraints: brief-pinned world (Material 3 Expressive, "exactly like Google designed it"), so no concept roll; Google Sans Flex, Material Symbols Rounded, Google's web palette by default with Material You dynamic color as an option. No bounce easing (a standing project rule): springs use the 0.8 damping curve for UI.

## Direction contract

THESIS: Gmail as Google would ship it if web Gmail got the full M3 Expressive treatment; refuses the stock Gmail web chrome of hairline rows and right-rounded drawer tabs.
OWN-WORLD: Tinted surface-container frame, segmented list rows (16 outer, 4 inner corners, 2px gaps) with unread rows lifted to the lowest container, pill nav indicators, large rounded Google Sans Flex titles (ROND 100), shape-morphing presses, MaterialShapes art for empty states and the loading indicator.
STORY: The visitor sees their inbox instantly, recognises Gmail, and acts with hover actions, keyboard, palette or swipe; reading happens in a 28px-radius pane; writing in a docked compose with undo send.
FIRST VIEWPORT: Top bar (menu, mark + "Gmail", 48px pill search, help/settings/avatar). Left: Compose FAB over the nav rail. Center: big "Inbox" title with unread count, category bundles or tabs, segmented rows. Right: reading pane card or empty state with a cookie-shaped mark.
FORM: Brief-pinned canon (Google M3 Expressive Gmail), position 1, seed key: none (pinned world, roll not run).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
