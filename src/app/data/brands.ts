/** Which senders get a brand logo instead of initials. Logos come from Google's favicon service, never the sender's own domain (that would tell senders the user's IP address and when they read their mail). */

/** Labels that sit under a country code, e.g. example.co.uk. */
const MULTI_PART = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'net.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp',
  'co.kr', 'or.kr',
  'co.in', 'net.in', 'org.in',
  'co.za', 'org.za',
  'com.br', 'net.br', 'org.br',
  'com.mx', 'com.ar', 'com.co', 'com.tr', 'com.sg', 'com.my', 'com.hk', 'com.tw', 'com.cn', 'com.ph', 'com.pl',
  'co.il', 'co.id', 'co.th',
]);

/** Mailbox providers: their logo says nothing about who wrote. */
const CONSUMER_NAMES = new Set([
  'gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'msn', 'passport', 'yahoo', 'ymail', 'rocketmail', 'aol', 'aim',
  'icloud', 'me', 'mac', 'proton', 'protonmail', 'pm', 'zoho', 'zohomail', 'fastmail', 'hey', 'tutanota', 'tuta',
  'hushmail', 'mailfence', 'posteo', 'mailbox', 'runbox', 'gmx', 'yandex', 'rambler', 'ukr', 'mail', 'email', 'inbox',
  'qq', 'foxmail', '163', '126', 'yeah', 'sina', 'sohu', 'aliyun', 'web', 't-online', 'freenet', 'naver', 'daum',
  'hanmail', 'nate', 'seznam', 'wp', 'o2', 'onet', 'interia', 'libero', 'virgilio', 'tiscali', 'alice', 'laposte',
  'orange', 'wanadoo', 'free', 'sfr', 'bigpond', 'optusnet', 'xtra', 'rediffmail', 'uol', 'bol', 'terra', 'comcast',
  'verizon', 'att', 'sbcglobal', 'bellsouth', 'cox', 'charter', 'earthlink', 'optonline', 'juno', 'netzero', 'btinternet',
  'virginmedia', 'ntlworld', 'shaw', 'rogers', 'sympatico', 'telus', 'lycos', 'mailinator',
]);

/** RFC 2606, RFC 6761: never looked up. */
const RESERVED = /(^|\.)(example(\.(com|org|net))?|test|invalid|localhost|local)$/;

/** Local parts organisations send from. A person's own address ("ana.lopez@") never gets a logo. */
const ROLE = /^(no-?reply|do-?not-?reply|donotreply|noreply-[\w-]+|mailer|news(letter)?s?|info|hello|hi|support|help|team|notifications?|notify|alerts?|updates?|marketing|offers?|deals|promo(tions)?|orders?|billing|invoices?|receipts?|payments?|accounts?|account-?security|security|service|customer-?service|care|contact|feedback|digest|community|events?|store|shop|sales|press|jobs|careers|admin|bounces?|reply|mail|email|members?|membership|rewards?|welcome|confirm(ation)?|verify|auth|statements?|shipping|delivery|tracking)([+._-].*)?$/;

/** "news.mail.example.co.uk" → "example.co.uk"; undefined for anything that isn't a domain name. */
export function registrableDomain(host: string): string | undefined {
  const labels = host.trim().toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9-]+$/.test(l) || l.startsWith('-') || l.endsWith('-'))) return undefined;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return undefined;
  const lastTwo = labels.slice(-2).join('.');
  const take = MULTI_PART.has(lastTwo) ? 3 : 2;
  return labels.length >= take ? labels.slice(-take).join('.') : undefined;
}

const letters = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Undefined when the sender is a person, uses a mailbox provider, or shares the user's own domain. */
export function brandDomain(
  email: string,
  name: string | undefined,
  ownEmail: string | undefined,
  /** The demo's invented brands, allowed even on reserved test domains. */
  known?: (domain: string) => boolean,
): string | undefined {
  const at = email.lastIndexOf('@');
  if (at < 1) return undefined;
  const local = email.slice(0, at).toLowerCase();
  const domain = registrableDomain(email.slice(at + 1));
  if (!domain || (RESERVED.test(domain) && !known?.(domain))) return undefined;
  const brand = domain.split('.')[0]!;
  if (CONSUMER_NAMES.has(brand)) return undefined;
  const own = ownEmail ? registrableDomain(ownEmail.slice(ownEmail.lastIndexOf('@') + 1)) : undefined;
  if (own && own === domain) return undefined;
  if (ROLE.test(local)) return domain;
  // "Maya Ortiz" <maya@mayaortiz.com>: a person on a domain that is their whole name. Only the whole name: "Pharmaco ExtraCare" <extracare@e.pharmaco.io> is a brand.
  const words = (name ?? '').split(/\s+/).map(letters).filter(Boolean);
  if (words.length >= 2 && words.join('') === letters(brand)) return undefined;
  // "Stripe Billing" <x7f2@stripe.com>: the display name is the brand.
  if (name && brand.length >= 3 && letters(name).includes(letters(brand))) return domain;
  return undefined;
}

/** Worth asking about a verified (BIMI) logo whoever the sender looks like: a domain that publishes one is a brand ("The New York Times" <nytdirect@nytimes.com>). */
export function orgDomain(email: string, ownEmail: string | undefined): string | undefined {
  const domain = registrableDomain(email.slice(email.lastIndexOf('@') + 1));
  if (!domain || RESERVED.test(domain) || CONSUMER_NAMES.has(domain.split('.')[0]!)) return undefined;
  const own = ownEmail ? registrableDomain(ownEmail.slice(ownEmail.lastIndexOf('@') + 1)) : undefined;
  return own === domain ? undefined : domain;
}

/** "v=BIMI1; s=nyt" -> "nyt", unless it's the default. */
export function bimiSelectorOf(header: string | undefined): string | undefined {
  const s = header && /(?:^|;)\s*s=([a-z0-9_-]{1,63})\s*(?:;|$)/i.exec(header)?.[1]?.toLowerCase();
  return s && s !== 'default' ? s : undefined;
}

/** Only an https SVG. */
export function bimiLogo(record: string): string | undefined {
  if (!/^\s*v=BIMI1\s*;/i.test(record)) return undefined;
  const l = /(?:^|;)\s*l=([^;\s]+)/i.exec(record)?.[1];
  return l && /^https:\/\/[^\s]+\.svg(\?[^\s]*)?$/i.test(l) ? l : undefined;
}

/** Best first: the sender's own host when it's a subdomain with its own site (pharmacy.cvs.com), then the registrable domain, where mail subdomains (e.cvs.com) lead. */
export function logoHosts(email: string): string[] {
  const host = email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const domain = registrableDomain(host);
  if (!domain) return [];
  return host === domain ? [domain] : [host, domain];
}

/** Asked directly on gstatic (where google.com/s2 redirects) so the extension may read its pixels. TYPE allows a site's touch icon, often 128px where the favicon is 32; an unknown domain gets a 404 with a 16px globe. */
export function faviconUrl(domain: string): string {
  const params = new URLSearchParams({ client: 'SOCIAL', type: 'FAVICON', fallback_opts: 'TYPE,SIZE,URL', url: `https://${domain}`, size: '128' });
  return `https://t1.gstatic.com/faviconV2?${params}`;
}

/** Below this a logo is the generic globe (16px). Plenty of companies (CVS, UPS, DoorDash) only publish a 32px favicon. */
export const MIN_LOGO_PX = 32;

/** 0 when it fails. */
export function imageWidth(url: string): Promise<number> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(0);
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth);
    img.onerror = () => resolve(0);
    img.src = url;
  });
}
