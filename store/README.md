# Store submissions

Everything the Chrome Web Store, Firefox Add-ons and the Mac App Store ask for, in one place. Paste the text as is; the limits in brackets are the stores' own.

Images are in [`images/`](images). Rebuild them from the demo mailbox with `npm run store:images` after the UI changes.

| Store | Images |
| --- | --- |
| Chrome Web Store | `images/web/1` to `5` (1280 x 800, five max), `images/promo/promo-small-440x280.png`, `images/promo/promo-marquee-1400x560.png` |
| Firefox Add-ons | `images/web/1` to `6` (1280 x 800) |
| Mac App Store | `images/app-store/1` to `6` (2560 x 1600) |

Privacy policy URL, for all three: the published [`PRIVACY.md`](../PRIVACY.md), for example `https://github.com/slukedev/expressive-gmail/blob/main/PRIVACY.md`.

## Before any submission

- [ ] Bump `version` in `package.json`. Every store refuses a version it has already seen. (0.1.0 is fine for the very first upload.)
- [ ] `npm run typecheck`, `npm test`, `npm run test:e2e`.
- [ ] Turn on private vulnerability reporting in the repository's Security settings; SECURITY.md and PRIVACY.md point there.
- [ ] **The name.** Chrome and Apple both turn down listings that put someone else's trademark first. "Expressive Gmail" may be rejected as implying it's a Google product; the usual way through is "Expressive for Gmail". If a reviewer asks, change `name` and `short_name` in `wxt.config.ts` and the app name in `scripts/package-safari.sh`.

## Shared listing text

**Name** [45, App Store 30]: Expressive Gmail

**Short description** [Chrome 132, Firefox 250]: Gmail rebuilt in Material 3 Expressive, with the features Gmail is missing.

**Description** [Chrome 16,000, Firefox 15,000, App Store 4,000]:

```
Expressive Gmail redraws Gmail on the web in Material You Expressive, Google's official design language.

YOUR MORNING, SORTED
Open Gmail and important things are pinned to the side: the sign-in code that you were waiting for (with a Copy button), the package that you ordered a few days ago, the invite that you forgot to answer, the bill that's due.

MAKE IT YOURS
Use one of Google's palettes or pick any color and let Material You Expressive theme the whole inbox. There's also support for system light/dark mode.

⌘K (OR CTRL K), DONE
A command palette that can search anything Gmail related. Type "snooze fri 9am", "label work" or "theme dark" the way you'd say it.

LESS TAB HOPPING
Track packages, RSVP to invites, copy codes, see flight and hotel details, all inside the message. It's plain text matching in your browser, no AI!

ALSO
- Every signed-in account together in All inboxes, or grouped into circles
- Reply later stack, pinned threads, private notes and follow-up reminders
- Subscriptions page with one-click unsubscribe
- Every attachment that you've ever received, in one gallery
- Pause inbox, Splits (saved searches as tabs), templates with /shortcuts
- Dark theme that darkens emails too
- Tracking pixels stripped out of every message
- Gmail's keyboard shortcuts, plus a few new ones

NOTHING LOST
Labels, categories, search operators, threads, compose with formatting and attachments, drafts, undo send, schedule send, snooze, mute and spam all still work. Classic Gmail is always one click away. Everything works just as well as it does it the original website, it just looks a little more modern.

PRIVATE BY DEFAULT
No servers, no analytics, no tracking. I'm too lazy to track you and Google already does that.

Expressive Gmail is an independent project made by me. AI (Opus 5.5) was used to assist me in the development of this extensions. It isn't made by, affiliated with or endorsed by Google. Gmail is a trademark of Google LLC.
```

## Chrome Web Store

**Steps**:

1. Sign in at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the Google account that should own the listing, pay the one-time registration fee and verify the contact email. The account needs 2-Step Verification.
2. `npm run zip`.
3. Click **New item** and upload `.output/expressive-gmail-<version>-chrome.zip`.
4. **Store listing**: the description, category and language below, the icon (taken from the zip), screenshots `images/web/1` to `5`, the small promo tile and the marquee.
5. **Privacy practices**: the single purpose, each permission's justification, remote code and data usage below, and the privacy policy URL.
6. **Distribution**: Public, all regions. Then **Submit for review**. Broad host permissions mean an in-depth review; expect days, sometimes a few weeks.
7. Updates: bump the version, `npm run zip` again, then **Package > Upload new package** on the same item.

- **Category**: Productivity > Communication (or Workflow & planning).
- **Language**: English.
- **Upload**: `npm run zip` (it builds both stores' zips), then `.output/expressive-gmail-<version>-chrome.zip`.

**Single purpose**:

```
Replaces the Gmail web interface on mail.google.com with a Material 3 Expressive redesign of the same mailbox.
```

**Permission justifications**:

| Permission | Justification |
| --- | --- |
| `storage` | Keeps the user's settings, notes, templates, reminders and a small inbox cache on their device. |
| `alarms` | Wakes snoozed conversations and due follow-up reminders once a minute. |
| `identity` | Optional "Gmail API" connection: signs the user in with Google through the browser's OAuth flow, with a client ID they provide. |
| `notifications` | Desktop notifications for new mail, which the user turns on in Settings. |
| Host `mail.google.com` | The extension runs on Gmail and reads the signed-in user's mail through Gmail's own endpoints to draw the new interface. |
| Host `accounts.google.com` | Lists the Google accounts signed in to the browser for the account switcher. |
| Hosts `gmail.googleapis.com`, `people.googleapis.com` | The optional Gmail API connection and contact names and photos. |
| Hosts `lh3.google.com`, `*.googleusercontent.com` | Profile photos and attachment thumbnails that only load with the user's Google session. |
| Host `*.gstatic.com` | Google's favicon service, for company logos beside their mail. |
| Host `dns.google` | Reads the verified-logo (BIMI) record a company publishes in DNS, so its logo shows beside its mail as it does in Gmail. |

**Remote code**: No, I am not using remote code. Everything is bundled in the package.

**Data usage** (Privacy practices tab): tick **Personally identifiable information**, **Personal communications** and **Authentication information** (the extension handles them to show the user's own mail), then all three certifications: not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending.

## Firefox Add-ons

**Steps**:

1. Sign in at the [Add-on Developer Hub](https://addons.mozilla.org/developers/) with a Firefox account (free).
2. `npm run zip`.
3. **Submit a New Add-on**, choose **On this site** (listed on AMO), and upload `.output/expressive-gmail-<version>-firefox.zip`. The validator should show no errors.
4. When asked whether it uses minified or bundled code, say yes and upload `.output/expressive-gmail-<version>-sources.zip`, then paste the reviewer notes below.
5. Fill in the listing (name, summary, description, categories, license, privacy policy, support site), add screenshots `images/web/1` to `6`, and submit. Listed add-ons go live after the automated check and are reviewed by a person afterwards.
6. Updates: bump the version, `npm run zip`, then **Upload New Version** on the add-on's page, with the new source zip.

- **Add-on ID**: `expressive-gmail@sluke.dev`, set in `wxt.config.ts`. It can never change after the first upload, and it fixes the OAuth redirect URI in [docs/gmail-api-setup.md](../docs/gmail-api-setup.md).
- **Upload**: `npm run zip`, then `.output/expressive-gmail-<version>-firefox.zip`, and `.output/expressive-gmail-<version>-sources.zip` when asked for source code.
- **Categories**: Appearance, Productivity. **License**: GPL-3.0. **Support site**: the GitHub repository.
- `npx web-ext lint -s .output/firefox-mv3` passes with no errors. Its warnings are `innerHTML` in React and DOMPurify, and pdf.js's worker; the notes below explain them.

**Notes to reviewer**:

```
Build: Node 24, `npm ci`, then `npm run build:firefox`. Output is .output/firefox-mv3. The sources zip is the full repository minus tests and screenshots.

The add-on replaces Gmail's web UI on mail.google.com. To try it without a Google account, run `npm run preview` from the sources and open http://localhost:5199 for the demo mailbox (fictional people and companies).

innerHTML warnings: email HTML is sanitized with DOMPurify before it is inserted. The remaining ones come from React and from pdf.js (attachment previews). No remote code is loaded and nothing is sent anywhere but Google.
```

## Mac App Store

The App Store build is the Safari extension in its Mac app, without the Chromium extension the Homebrew build carries.

1. Join the Apple Developer Program (yearly fee) and sign in to Xcode with that Apple ID (Xcode > Settings > Accounts).
2. In [App Store Connect](https://appstoreconnect.apple.com), **Apps > + > New App**: platform macOS, your name for it, primary language English, your bundle ID (`BUNDLE_ID`, for example `dev.luke.bettergmail`; register it under Certificates, Identifiers & Profiles if it isn't listed, along with `<bundle id>.Extension`) and SKU `expressive-gmail`.
3. `TEAM_ID=... BUNDLE_ID=... npm run release:appstore` archives, signs and uploads. `EXPORT_ONLY=1` writes a `.pkg` for Transporter instead. The build appears under TestFlight once Apple has processed it, usually within the hour.
4. On the app's macOS version page, fill in the fields below, add the screenshots from `images/app-store/` (2560 x 1600), choose the build, answer App Privacy and the age rating, set the price under Pricing and Availability, and click **Add for Review**, then **Submit**.
5. Updates: bump the version, run `npm run release:appstore` again, and create a new version in App Store Connect.

- **Subtitle** [30]: Gmail in Material 3 Expressive
- **Promotional text** [170]: Your inbox, expressive. A whole new look for Gmail in Safari, plus At a glance, Material You themes and a command palette. Same account, same mail.
- **Keywords** [100]: `email,mail,inbox,material you,theme,dark mode,safari extension,productivity,redesign,command palette`
- **Category**: Productivity (secondary: Utilities).
- **Price**: Free.
- **Age rating**: 4+ (no objectionable content; it shows the user's own mail).
- **Copyright**: `2026 <your name>`.
- **Support URL**: the GitHub repository's issues page. **Marketing URL**: the repository.
- **Export compliance**: already answered in the app (`ITSAppUsesNonExemptEncryption = NO`); it only uses HTTPS through the system.

**App Privacy** ("nutrition label"): **Data Not Collected**. The developer receives nothing; mail goes between Safari and Google only.

**App Review notes**:

```
Expressive Gmail is a Safari web extension that redraws Gmail on mail.google.com. The app's window shows whether the extension is on, links to Safari Settings, and has a switch that opens Gmail with the new look on or off. It lists the browsers installed on the Mac; in browsers other than Safari the switch only works if the user also installed the extension there from that browser's own store.

To review:
1. Open the app, click Safari Settings and turn on Expressive Gmail. Allow it on mail.google.com.
2. Open https://mail.google.com in Safari and sign in with any Google account. The new interface replaces Gmail's.
3. The toolbar button turns it on and off; "Switch to classic Gmail" is in the account menu.

No account is needed for the app itself. The extension has no server and collects nothing. It is an independent project and isn't affiliated with Google.
```
