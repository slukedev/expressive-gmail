/** The Mac app switches the new Gmail by opening this link; it works whatever ID the browser gave the extension. */
export const switchLink = (on: boolean) => `https://mail.google.com/mail/u/0/#better-gmail=${on ? 'on' : 'off'}`;

/** What the link asks for. Any page can open it (a referrer is easy to drop), so the content script asks the person before applying it. */
export function switchRequest(hash: string): boolean | null {
  const m = /^#better-gmail=(on|off)$/.exec(hash);
  return m ? m[1] === 'on' : null;
}
