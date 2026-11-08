/** The Mac app switches the new Gmail by opening this link; it works whatever ID the browser gave the extension. */
export const switchLink = (on: boolean) => `https://mail.google.com/mail/u/0/#better-gmail=${on ? 'on' : 'off'}`;

/** Only a page opened from outside the browser (no referrer) counts, so a website's link can't flip the switch. */
export function switchRequest(hash: string, referrer: string): boolean | null {
  if (referrer) return null;
  const m = /^#better-gmail=(on|off)$/.exec(hash);
  return m ? m[1] === 'on' : null;
}
