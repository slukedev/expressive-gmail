# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for anything that could expose someone's mail, session or tokens.

Include the browser and version, the mail source (session, Gmail API or demo), what an attacker could do, and steps to reproduce. If you can, reproduce it against the demo mailbox (`npm run preview`) rather than a real account, and leave real addresses, message content and tokens out of the report.

You should hear back within a week. Fixes go out in the next release, and reporters are credited unless they'd rather not be.

## What the extension touches

Expressive Gmail has no server. It runs entirely in your browser.

- It runs on `https://mail.google.com/*`, hides Gmail's page and draws its own interface on top.
- In session mode (the default) it uses the Google session you're already signed in with. A main-world script copies the request headers and tokens Gmail's own requests carry, so the extension can call the same endpoints. They're kept in extension storage on this device, per account, and never sent anywhere except back to Google.
- In Gmail API mode it signs in through the browser's `identity` API with an OAuth client ID you create yourself (see [docs/gmail-api-setup.md](docs/gmail-api-setup.md)). The client ID and your address are kept in extension storage; access tokens are kept in session storage, which the browser clears when it quits.
- Settings, notes, templates, pins, reminders, the contact index, cached photos and a small cache of the first inbox page are stored locally in this browser. Switching to classic Gmail, turning the extension off or signing out clears the inbox cache.

Nothing leaves the browser except requests to Google: `mail.google.com`, `accounts.google.com`, the Gmail and People APIs, Google's contact autocomplete, `googleusercontent.com` and `lh3.google.com` for photos and attachments, `gstatic.com` for sender logos, and `dns.google` for verified company logos (BIMI), whose image then loads from the address the company published. Clicking Unsubscribe sends the sender's one-click unsubscribe request (no cookies), and images in messages load from senders only when your settings allow it. There is no analytics, telemetry or third-party service.

Some things you click open other sites in a new tab, as Gmail does: links in messages, a Google search for the tracking number from **Track package**, and Google Translate (with the message text in the URL) from **Translate**. Images from senders load only when your **Images from senders** setting allows it.

## Scope

In scope: anything that lets a web page, an email or another extension read mail, tokens or stored data through Expressive Gmail; HTML in messages escaping the sanitizer (DOMPurify) or running script; data going to a host not listed above.

Out of scope: problems in Gmail itself or Google's endpoints (report those to Google), and attacks that need someone who already controls your browser profile.
