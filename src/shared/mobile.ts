/** Gmail serves phones its mobile web app (/mail/mu/), which has none of the endpoints the extension uses. Asked as a desktop browser ("Request desktop website") it serves the full client. */

/** A phone (or an iPad in Slide Over), by its user agent. */
export function isPhone(ua: string): boolean {
  return /\bMobile\b/.test(ua) && /Android|iPhone|iPad|iPod/.test(ua);
}

/** The same browser, introducing itself as its desktop version. */
export function desktopUserAgent(ua: string): string {
  const firefox = /\bFirefox\/(\d+(?:\.\d+)?)/.exec(ua)?.[1];
  if (firefox) return `Mozilla/5.0 (X11; Linux x86_64; rv:${firefox}) Gecko/20100101 Firefox/${firefox}`;
  // Every iOS browser is WebKit underneath; this is the string an iPad sends.
  if (/iPhone|iPad|iPod/.test(ua)) {
    const version = /\bVersion\/(\d+(?:\.\d+)?)/.exec(ua)?.[1] ?? /\bOS (\d+)_(\d+)/.exec(ua)?.slice(1, 3).join('.') ?? '18.0';
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`;
  }
  const chrome = /\bChrome\/(\d+)/.exec(ua)?.[1] ?? '130';
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`;
}

export function desktopGmailUrl(url: URL): string | undefined {
  if (!/^\/mail\/mu\//.test(url.pathname)) return undefined;
  const user = /^\d{1,2}$/.test(url.searchParams.get('authuser') ?? '') ? url.searchParams.get('authuser') : '0';
  return `${url.origin}/mail/u/${user}/#inbox`;
}

/** The one rule that asks for desktop Gmail, for declarativeNetRequest. */
export const DESKTOP_RULE_ID = 1;

export function desktopRule(ua: string) {
  return {
    id: DESKTOP_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders' as const,
      requestHeaders: [{ header: 'user-agent', operation: 'set' as const, value: desktopUserAgent(ua) }],
    },
    condition: {
      requestDomains: ['mail.google.com'],
      resourceTypes: ['main_frame' as const, 'sub_frame' as const, 'xmlhttprequest' as const],
    },
  };
}
