# Gmail API backend setup

Expressive Gmail works out of the box with your Gmail session. The Gmail API backend is the official alternative: it signs in with Google and talks to the documented Gmail REST API. It needs a Google Cloud OAuth client that you create once. This takes about ten minutes.

Works in Chrome and Firefox. Safari has no extension sign-in API, so Safari stays on the session backend.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/>.
2. Click the project picker at the top, then **New project**.
3. Name it something like `Expressive Gmail` and click **Create**. Make sure it is selected afterwards.

## 2. Enable the APIs

1. Go to **APIs & Services > Library**.
2. Search for **Gmail API**, open it, click **Enable**.
3. Search for **People API**, open it, click **Enable**. This powers contact suggestions in the To field. Without it, Expressive Gmail suggests people you recently emailed instead.

## 3. Configure the OAuth consent screen

1. Go to **APIs & Services > OAuth consent screen** (in newer consoles: **Google Auth Platform > Branding / Audience / Data access**).
2. User type: **External**. Click **Create**.
3. App name: `Expressive Gmail (personal)`. Support email and developer contact: your own address. Save.
4. Under **Data access** (or **Scopes**), add these scopes:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.labels`
   - `https://www.googleapis.com/auth/gmail.settings.basic`
   - `https://www.googleapis.com/auth/contacts.readonly`
   - `https://www.googleapis.com/auth/contacts.other.readonly`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `openid`
5. Under **Audience**, leave the publishing status on **Testing** and add your Gmail address under **Test users**.

In Testing mode only the listed test users can sign in, and Google shows an "unverified app" warning on first sign-in. Click **Continue**. That is expected for a personal client.

## 4. Find your redirect URIs

Google only redirects to URIs you register, so you need the exact one for each browser.

**Chrome**

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Find Expressive Gmail and copy its **ID** (32 letters, for example `abcdefghijklmnopabcdefghijklmnop`).
3. Your redirect URI is `https://<ID>.chromiumapp.org/` including the trailing slash, for example:
   `https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/`

An unpacked extension's ID depends on the folder it was loaded from. If you load it from a different folder, the ID and the redirect URI change. A Chrome Web Store install has a fixed ID.

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. Find Expressive Gmail and click **Inspect** to open its console.
3. Run `browser.identity.getRedirectURL()`. It returns something like `https://2c127fa4f0e7f1a1d5ab8b2b3f1e2a6c55d8e4ab.extensions.allizom.org/`.
4. Take the first part of the host name (the long hash) and build the loopback URI:
   `http://127.0.0.1/mozoauth2/2c127fa4f0e7f1a1d5ab8b2b3f1e2a6c55d8e4ab`

Expressive Gmail uses this loopback form in Firefox. The hash comes from the add-on ID, so it stays the same across reinstalls. The ID is `expressive-gmail@sluke.dev`, set in `wxt.config.ts`; a fork that changes it gets a different hash and redirect URI.

## 5. Create the OAuth client

1. Go to **APIs & Services > Credentials** (or **Google Auth Platform > Clients**).
2. Click **Create credentials > OAuth client ID**.
3. Application type: **Web application**. Not "Chrome extension": that type only works with Chrome's `getAuthToken`, which Expressive Gmail does not use so the same client also works in Firefox.
4. Name: `Expressive Gmail`.
5. Leave **Authorized JavaScript origins** empty.
6. Under **Authorized redirect URIs**, add every URI from step 4, one per line, exactly as written (Chrome needs the trailing slash, Firefox must not have one).
7. Click **Create** and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). You do not need the client secret. Do not paste it anywhere.

## 6. Connect Expressive Gmail

1. Open Gmail with Expressive Gmail running and go to Expressive Gmail's settings.
2. Find the mail source option and paste the client ID into the Google OAuth client ID field.
3. Choose **Gmail API** and sign in with Google.
4. Pick your account, accept the warning for the unverified app, and allow the requested access.

Developers can instead set the client ID at build time with `WXT_GOOGLE_CLIENT_ID=... npm run build`. A client ID saved in Settings takes priority.

## What changes with the Gmail API backend

- **Snooze** is emulated. Snoozed threads leave the inbox and get a hidden label named `Snoozed (Better Gmail)`. The browser brings them back when the time comes, so the browser needs to be running then. Threads snoozed in Gmail's own interface do not show up under Snoozed.
- **Mute** is emulated with a hidden label `Muted (Better Gmail)`. New replies are moved out of the inbox while Expressive Gmail is open.
- **Schedule send** is not available: the public API has no send time, and Expressive Gmail doesn't send from the browser instead. Use the Your Gmail session connection to schedule.
- **Delete forever** is not available, because it needs full mailbox access (`https://mail.google.com/`), which Expressive Gmail does not request. Emptying the trash in Gmail still works.
- Filters that forward mail need an extra scope and will fail to save.

## Troubleshooting

- **`redirect_uri_mismatch`**: the URI in step 6 of section 5 does not match. Compare it character by character with step 4, including the trailing slash.
- **`access_denied` or "app has not completed verification"**: your address is not listed as a test user (section 3, step 5).
- **Contact suggestions only show people you emailed**: the People API is not enabled, or you unticked the contacts permissions when signing in.
- **Signed out after about a week**: Google expires grants for apps in Testing mode after seven days. Sign in again.
