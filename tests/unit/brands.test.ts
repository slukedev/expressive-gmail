import { brandDomain, faviconUrl, logoHosts, registrableDomain } from '../../src/app/data/brands';

describe('registrableDomain', () => {
  it.each([
    ['stripe.com', 'stripe.com'],
    ['news.stripe.com', 'stripe.com'],
    ['em.mail.ledgerly.io', 'ledgerly.io'],
    ['email.shop.example.co.uk', 'example.co.uk'],
    ['bank.com.au', 'bank.com.au'],
    ['info.bank.com.au', 'bank.com.au'],
    ['STRIPE.COM.', 'stripe.com'],
    ['co.uk', undefined],
    ['localhost', undefined],
    ['192.168.0.1', undefined],
    ['bad_host.com', undefined],
  ])('%s → %s', (host, domain) => {
    expect(registrableDomain(host)).toBe(domain);
  });
});

describe('brandDomain', () => {
  const me = 'ada@lovelace.dev';
  it.each<[string, string | undefined, string | undefined]>([
    // Organisations, by role address or by a display name that is the brand.
    ['no-reply@news.stripe.com', undefined, 'stripe.com'],
    ['receipts+acct_9@stripe.com', undefined, 'stripe.com'],
    ['x7f2@mail.stripe.com', 'Stripe Billing', 'stripe.com'],
    ['stripe@stripe.com', 'Stripe', 'stripe.com'],
    ['orders@shop.example.co.uk', undefined, 'example.co.uk'],
    // People, even at companies.
    ['ana.lopez@stripe.com', 'Ana Lopez', undefined],
    ['patrick@stripe.com', undefined, undefined],
    // Someone on their own domain is a person too.
    ['maya@mayaortiz.dev', 'Maya Ortiz', undefined],
    ['ana.ruiz@anaruiz.studio', 'Ana Ruiz', undefined],
    // Mailbox providers, whatever the country domain.
    ['news@gmail.com', undefined, undefined],
    ['no-reply@yahoo.co.uk', undefined, undefined],
    ['info@gmx.de', undefined, undefined],
    ['team@hotmail.co.uk', 'Hotmail Team', undefined],
    ['hello@proton.me', undefined, undefined],
    ['support@icloud.com', undefined, undefined],
    ['news@outlook.com', 'Outlook', undefined],
    ['info@yandex.ru', undefined, undefined],
    ['team@mail.ru', undefined, undefined],
    ['service@t-online.de', undefined, undefined],
    ['hello@zoho.com', 'Zoho', undefined],
    ['alerts@aol.com', undefined, undefined],
    // A company that sends from a named address on a mail subdomain.
    ['CVSPharmacy@pharmacy.pharmaco.io', 'Pharmaco Pharmacy', 'pharmaco.io'],
    // A brand whose address repeats a word of its name is still a brand.
    ['ExtraCare@e.pharmaco.io', 'Pharmaco ExtraCare', 'pharmaco.io'],
    ['jane@janesmith.dev', 'Jane', undefined],
    // The user's own organisation, and reserved test domains.
    ['notifications@lovelace.dev', undefined, undefined],
    ['no-reply@ledgerly.example', undefined, undefined],
    ['news@example.com', undefined, undefined],
  ])('%s (%s) → %s', (email, name, domain) => {
    expect(brandDomain(email, name, me)).toBe(domain);
  });
});

describe('brand logos on test domains', () => {
  it("are allowed only for domains that have a logo of the source's own", () => {
    const known = (d: string) => d === 'junipersavings.example';
    expect(brandDomain('alerts@junipersavings.example', 'Juniper Savings', 'me@example.com', known)).toBe('junipersavings.example');
    expect(brandDomain('orders@oaklinehome.example', 'Oakline Home', 'me@example.com', known)).toBeUndefined();
  });
});

describe('faviconUrl', () => {
  it("asks Google's favicon service for a 128px icon, touch icons included, over https", () => {
    const url = new URL(faviconUrl('pharmaco.io'));
    expect(url.origin).toBe('https://t1.gstatic.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client: 'SOCIAL',
      type: 'FAVICON',
      fallback_opts: 'TYPE,SIZE,URL',
      url: 'https://pharmaco.io',
      size: '128',
    });
  });
});

describe('logoHosts', () => {
  it.each<[string, string[]]>([
    ['ExtraCare@e.pharmaco.io', ['e.pharmaco.io', 'pharmaco.io']],
    ['orders@pharmaco.io', ['pharmaco.io']],
    ['news@www.pharmaco.io', ['pharmaco.io']],
    ['info@mail.shop.example.co.uk', ['mail.shop.example.co.uk', 'example.co.uk']],
    ['hello@bank.com.au', ['bank.com.au']],
    ['nobody@localhost', []],
  ])('%s → %j', (email, hosts) => {
    expect(logoHosts(email)).toEqual(hosts);
  });
});
