# Privacy policy

Expressive Gmail is a browser extension that redraws Gmail on `mail.google.com`. It has no server, and its developer never receives your data.

Last updated: November 8, 2026.

## What it reads

To show your mail, the extension reads the Gmail account you're signed in to in that browser: messages, labels, contacts' names and photos, and the settings that change how Gmail behaves. It does this one of two ways, chosen in Settings > Connection:

- **Your Gmail session** (default). The extension calls the same Google endpoints Gmail's own page uses, with the session you're already signed in with.
- **Gmail API** (optional). You sign in with Google through the browser and the extension calls the official Gmail and People APIs with an OAuth client ID you create yourself.

## Where it goes

Your mail and account data go only to Google: `mail.google.com`, `accounts.google.com`, `peoplestack-pa.clients6.google.com` (contact suggestions and photos, as Gmail's own compose asks for them), `gmail.googleapis.com`, `people.googleapis.com`, `oauth2.googleapis.com` (signing out of the Gmail API connection), `googleusercontent.com`, `lh3.google.com`, `gstatic.com` and `dns.google`.

On a phone, requests to `mail.google.com` name the browser as its desktop version (as "Request desktop website" does), so Gmail serves the page the extension works with. Nothing else about the requests changes, and other sites are left alone.

One exception, the same one Gmail makes: a company that publishes a verified logo (BIMI) names an address for it in its DNS records, which the extension reads through Google's resolver at `dns.google`. That logo image is then loaded from the address the company published (often `vmc.digicert.com` or the company's own server), once per company, as a plain image request with no referrer. It carries nothing about you or your mail.

Two things reach a sender, both the same as in Gmail:

- **Images in messages** load from the sender's servers only when your **Images from senders** setting (or **Show images** on one message) allows it. Tracking pixels are removed first unless you turn tracker blocking off.
- **Unsubscribe**, when you click it, sends the sender's one-click unsubscribe request to the address in the message's own `List-Unsubscribe` header, without cookies, or opens the sender's unsubscribe page in a new tab.

There is no analytics, no telemetry, no ads and no third-party service. Nothing is sold, shared or transferred to anyone.

## What's kept on your device

These stay in your browser's extension storage, on this device only:

- Your settings, theme and layout choices.
- Notes, templates, pins, follow-up reminders, Reply later and dismissed suggestions.
- A small cache of your first inbox page so Gmail opens fast, and cached contact photos.
- Session tokens copied from Gmail's own requests (session mode) or a short-lived access token (Gmail API mode, cleared when the browser quits).
- A picture you choose for At a glance, if you add one.

Your interface size is also kept in `mail.google.com`'s own site storage in this browser, so a new Gmail tab opens at that size.

Switching back to classic Gmail, turning the extension off or signing out clears the inbox cache. Uninstalling the extension removes everything it stored.

## Smart features

Package tracking, verification codes, invites, bills and the other smart cards are found by plain text matching in your browser. No message is sent to an AI service or any other server to do this.

## Gemini

If your Google account includes Gemini in Gmail, the extension can use it: summaries, Help me write, Proofread, suggested replies, answers to questions about your mail and AI Inbox. It does this through Gmail's own page and your own account, the same way Gmail does when you use Gemini there, so Google's Gemini terms for your account apply. The extension never sends your mail to any other AI service. Turn it off under Settings > Gemini, and nothing more goes to Gemini from the extension.

Some things you click open another site in a new tab, the same way Gmail does: links in messages, a Google search for the tracking number from **Track package**, Google Calendar from **Add to Google Calendar**, and Google Translate (with the message text in the address) from **Translate**.

## Google API Services

When you use the Gmail API connection, Expressive Gmail's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Data from Google APIs is used only to show and manage your own mail in the extension's interface, is never transferred to anyone, is never used for ads, and is never read by a person.

## Children

The extension isn't directed at children and collects nothing from anyone.

## Changes and contact

Changes to this policy are made in this file, with the date above updated. Questions go to the project's GitHub issues, or privately through the repository's Security tab.

Expressive Gmail is an independent project. It isn't made by, affiliated with or endorsed by Google. Gmail is a trademark of Google LLC.
