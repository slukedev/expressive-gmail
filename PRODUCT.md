# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated. WXT (one codebase built for Chrome, Firefox and Safari, Manifest V3), React 19, Base UI primitives with custom Material 3 Expressive components, TanStack Query for mail data, Zustand for UI state, Vitest and Playwright for tests. Safari ships through the Xcode wrapper that `xcrun safari-web-extension-packager` generates.

## Users

People who live in Gmail on a desktop browser every day and want it to look and feel like the Material 3 Expressive Gmail that Google ships on Android, without changing how they use email. The core user is a power user who reads on a laptop or a big monitor, uses keyboard shortcuts, and notices every pixel.

## Product Purpose

A browser extension that replaces Gmail's web interface on mail.google.com with a complete Material 3 Expressive rebuild, plus the features people keep asking Google for. Success means opening Gmail and feeling that Google redesigned it, with nothing lost from the old UI and a few things gained.

## Positioning

It is Gmail, not a third-party mail client: same URL, same account, same session, no separate sign-in by default. The interface is a faithful desktop translation of Google's own M3 Expressive Gmail on Android, built to Google's published tokens.

## Operating Context

- Runs on `https://mail.google.com/*` and covers the whole viewport. Gmail still loads underneath (hidden) so the session stays valid.
- Mail data comes through a backend adapter:
  - **Session** (default): Gmail's own internal sync endpoints, using the signed-in session. Zero setup, but undocumented and can break when Google changes Gmail.
  - **Gmail API** (optional): Google sign-in with the official REST API. Needs a Google Cloud OAuth client.
  - **Demo**: a realistic synthetic mailbox for previews, development builds and tests. Not in release builds.
- A one-click way back to classic Gmail must always exist.

## Capabilities and Constraints

- Everything Gmail web does for daily mail must keep working: inbox categories, labels, search with operators, threads, compose/reply/forward with formatting and attachments, drafts, archive, delete, spam, star, important, snooze, mute, move, multi-select, keyboard shortcuts, settings that matter.
- The public Gmail API has no snooze or schedule send; snooze is emulated, schedule send isn't offered there. In session mode schedule send is Gmail's own (Google's servers send it), driven through Gmail's own buttons since no sync request for it is documented. Never send scheduled mail from the browser.
- No server. Everything runs in the browser.
- The extension must never use Google's logos as its own branding.

## Brand Commitments

Pinned by the user: Material 3 Expressive, "exactly like Google designed it", with production-ready polish and no overlay feel. Google Sans Flex (OFL) and Material Symbols Rounded (Apache 2.0) are the type and icon faces.

## Evidence on Hand

No real mailbox data is available to this build. Demo content is synthetic and must be labelled as demo wherever it could be mistaken for real mail.

## Product Principles

1. Indistinguishable from a Google product: every token, shape and motion comes from Google's own M3 Expressive values.
2. Lose nothing: a redesign that drops a Gmail capability is a regression.
3. Fast for experts: every action has a shortcut, and the command palette reaches everything.
4. Honest about the data source: when something can't work with the current backend, say so plainly and offer the way that does.
5. Private by default: nothing leaves the browser except requests to Google.

## Accessibility & Inclusion

WCAG 2.2 AA: full keyboard operation, visible focus rings, screen reader names, reduced motion, forced colors, and contrast from the M3 color roles.
