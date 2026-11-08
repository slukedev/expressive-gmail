import { desktopGmailUrl, desktopRule, desktopUserAgent, isPhone } from '../../src/shared/mobile';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15';
const IPAD_SLIDE_OVER = 'Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0';
const FIREFOX_TABLET = 'Mozilla/5.0 (Android 15; Tablet; rv:144.0) Gecko/144.0 Firefox/144.0';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1';
const DESKTOP_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

describe('phones ask Gmail for its desktop client', () => {
  it('counts phones and an iPad in Slide Over, never desktops, desktop-class iPads or Android tablets', () => {
    expect([IPHONE, IPAD_SLIDE_OVER, FIREFOX_ANDROID, CHROME_ANDROID, CHROME_IOS].map(isPhone)).toEqual([true, true, true, true, true]);
    expect([IPAD_DESKTOP, FIREFOX_TABLET, DESKTOP_CHROME].map(isPhone)).toEqual([false, false, false]);
  });

  it('introduces each browser as its own desktop version, so Gmail serves it what that engine runs', () => {
    expect(desktopUserAgent(IPHONE)).toBe(IPAD_DESKTOP);
    expect(desktopUserAgent(FIREFOX_ANDROID)).toBe('Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0');
    expect(desktopUserAgent(CHROME_ANDROID)).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36');
    // Chrome on iOS is WebKit too, and names no Safari version: the system's stands in.
    expect(desktopUserAgent(CHROME_IOS)).toContain('Version/18.4 Safari/605.1.15');
    for (const ua of [IPHONE, FIREFOX_ANDROID, CHROME_ANDROID, CHROME_IOS]) expect(isPhone(desktopUserAgent(ua))).toBe(false);
  });

  it('sends mobile Gmail addresses to the same account in desktop Gmail, and leaves others alone', () => {
    expect(desktopGmailUrl(new URL('https://mail.google.com/mail/mu/mp/123/#tl/priority/%5Esmartlabel_personal'))).toBe('https://mail.google.com/mail/u/0/#inbox');
    expect(desktopGmailUrl(new URL('https://mail.google.com/mail/mu/mp/9/?authuser=2'))).toBe('https://mail.google.com/mail/u/2/#inbox');
    expect(desktopGmailUrl(new URL('https://mail.google.com/mail/mu/?authuser=javascript:x'))).toBe('https://mail.google.com/mail/u/0/#inbox');
    expect(desktopGmailUrl(new URL('https://mail.google.com/mail/u/1/#inbox'))).toBeUndefined();
  });

  it('changes only requests to Gmail, the page and its frames and calls', () => {
    const rule = desktopRule(FIREFOX_ANDROID);
    expect(rule.condition).toEqual({ requestDomains: ['mail.google.com'], resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest'] });
    expect(rule.action.requestHeaders).toEqual([{ header: 'user-agent', operation: 'set', value: desktopUserAgent(FIREFOX_ANDROID) }]);
  });
});
