import { describe, expect, it, vi } from 'vitest';
import { delegatedFromDocument, delegatedUrl, discoverDelegated, parseDelegated } from '../../src/session/delegated';
import { delegatedPath, fitsDelegated, runsApp, takesOver } from '../../src/shared/takeover';

const ME = 'ada@example.com';
const TOKEN = 'AEoRXRSq3x9Kexample_-Z';

describe('which Gmail pages the app takes over', () => {
  const at = (href: string, top = true) => takesOver(new URL(href), top);

  it('takes over an account’s own inbox, at any slot and route', () => {
    expect(at('https://mail.google.com/mail/u/0/#inbox')).toBe(true);
    expect(at('https://mail.google.com/mail/u/3/#label/Work/FMfcgz')).toBe(true);
    expect(at('https://mail.google.com/mail/')).toBe(true);
  });

  it('leaves delegated mailboxes to classic Gmail, in both URL forms', () => {
    expect(at(`https://mail.google.com/mail/u/0/d/${TOKEN}/#inbox`)).toBe(false);
    expect(at(`https://mail.google.com/mail/u/1/d/${TOKEN}`)).toBe(false);
    expect(at('https://mail.google.com/mail/b/391/u/0/#inbox')).toBe(false);
    expect(at('https://mail.google.com/mail/b/AEoRXRS_old/')).toBe(false);
  });

  it('leaves frames, popups and print views alone', () => {
    expect(at('https://mail.google.com/mail/u/0/#inbox', false)).toBe(false);
    expect(at('https://mail.google.com/mail/u/0/?view=cm&fs=1&to=x@example.com')).toBe(false);
    expect(at('https://mail.google.com/mail/u/0/?ui=2&view=pt&search=all')).toBe(false);
  });

  it('does not mistake look-alike paths for delegation', () => {
    expect(delegatedPath('/mail/u/0/')).toBeUndefined();
    expect(delegatedPath('/mail/u/0/d/')).toBeUndefined();
    expect(delegatedPath('/mail/u/0/d/short')).toBeUndefined();
    expect(delegatedPath('/mail/mu/mp/123/')).toBeUndefined();
    expect(delegatedPath(`/mail/u/0/d/${TOKEN}/`)).toBe(`/mail/u/0/d/${TOKEN}`);
  });
});

describe('delegated mailbox links', () => {
  it('normalizes to the mailbox itself on mail.google.com', () => {
    expect(delegatedUrl(`/mail/u/0/d/${TOKEN}/#inbox?compose=new`)).toBe(`https://mail.google.com/mail/u/0/d/${TOKEN}/`);
    expect(delegatedUrl('https://mail.google.com/mail/b/391/u/2/?authuser=2')).toBe('https://mail.google.com/mail/b/391/u/2/');
    expect(delegatedUrl(`https://evil.example.com/mail/u/0/d/${TOKEN}/`)).toBeUndefined();
    expect(delegatedUrl('https://mail.google.com/mail/u/0/')).toBeUndefined();
    expect(delegatedUrl('javascript:alert(1)')).toBeUndefined();
  });
});

describe('finding delegated mailboxes in Gmail’s page', () => {
  it('reads switcher markup: name, address and link, skipping the signed-in account', () => {
    const html = `
      <div class="gb_switcher">
        <a href="https://mail.google.com/mail/u/0/" aria-label="Ada Lovelace (${ME})">Ada Lovelace ${ME}</a>
        <div>Delegated</div>
        <a href="/mail/u/0/d/${TOKEN}/" aria-label="Team Inbox (team@example.com)"><img src="x"><div>Team Inbox</div><div>team@example.com</div><div>Delegated</div></a>
        <a href="https://mail.google.com/mail/b/391/u/0/"><div>Grace Hopper &lt;grace@example.org&gt;</div></a>
      </div>`;
    expect(parseDelegated(html, [ME])).toEqual([
      { email: 'team@example.com', name: 'Team Inbox', url: `https://mail.google.com/mail/u/0/d/${TOKEN}/` },
      { email: 'grace@example.org', name: 'Grace Hopper', url: 'https://mail.google.com/mail/b/391/u/0/' },
    ]);
  });

  it('reads script data with escaped slashes and quotes', () => {
    const js = `_GM_setData({"dlg":[["Team Inbox","team@example.com","https:\\/\\/mail.google.com\\/mail\\/u\\/0\\/d\\/${TOKEN}\\/"],[\\x22Billing\\x22,\\x22billing@example.net\\x22,\\x22\\x2Fmail\\x2Fu\\x2F0\\x2Fd\\x2FAEoRXRSbilling99\\x2F\\x22]]});`;
    expect(parseDelegated(js, [ME])).toEqual([
      { email: 'team@example.com', name: 'Team Inbox', url: `https://mail.google.com/mail/u/0/d/${TOKEN}/` },
      { email: 'billing@example.net', name: 'Billing', url: 'https://mail.google.com/mail/u/0/d/AEoRXRSbilling99/' },
    ]);
  });

  it('pairs each link with its own address, and lists each mailbox once', () => {
    const html = [1, 2, 3]
      .map((n) => `<a href="/mail/u/0/d/AEoRXRStoken000${n}/">box${n}@example.com</a>`)
      .concat(`<a href="/mail/u/0/d/AEoRXRStoken0001/#inbox">box1@example.com</a>`)
      .join('');
    expect(parseDelegated(html).map((d) => [d.email, d.url.slice(-6, -1)])).toEqual([
      ['box1@example.com', 'n0001'],
      ['box2@example.com', 'n0002'],
      ['box3@example.com', 'n0003'],
    ]);
  });

  it('finds nothing in a page without delegation, or a link with no address near it', () => {
    expect(parseDelegated(`<a href="/mail/u/0/#inbox">${ME}</a><a href="/mail/u/1/">bob@example.com</a>`, [ME])).toEqual([]);
    expect(parseDelegated(`<a href="/mail/u/0/d/${TOKEN}/">${ME}</a>`, [ME])).toEqual([]);
    expect(parseDelegated(`<a href="/mail/u/0/d/${TOKEN}/">Team</a>${' '.repeat(1000)}far@example.com`)).toEqual([]);
    expect(parseDelegated('')).toEqual([]);
  });

  it('reads a live document, drawn links before script data, and never throws', () => {
    document.body.innerHTML = `
      <a href="/mail/u/0/d/${TOKEN}/" aria-label="Team Inbox (team@example.com)">Team Inbox</a>
      <script>var d = ["Old Name","team@example.com","/mail/u/0/d/${TOKEN}/"]; var e = ["Ops","ops@example.com","/mail/u/0/d/AEoRXRSops000001/"];</script>`;
    expect(delegatedFromDocument(document, [ME])).toEqual([
      { email: 'team@example.com', name: 'Team Inbox', url: `https://mail.google.com/mail/u/0/d/${TOKEN}/` },
      { email: 'ops@example.com', name: 'Ops', url: 'https://mail.google.com/mail/u/0/d/AEoRXRSops000001/' },
    ]);
    const broken = { querySelectorAll: () => { throw new Error('gone'); } } as unknown as Document;
    expect(delegatedFromDocument(broken)).toEqual([]);
  });

  it('pairs each drawn link with its own label, not the next link’s address', () => {
    document.body.innerHTML = `
      <a href="/mail/u/0/d/AEoRXRSteam00001/" aria-label="Team Inbox (team@example.com)"><div>Team Inbox</div><div>team@example.com</div></a>
      <a href="/mail/u/0/d/AEoRXRSops000001/" aria-label="Ops (ops@example.com)"><div>Ops</div><div>ops@example.com</div></a>
      <a href="/mail/u/0/d/AEoRXRSbill00001/"><div>Billing</div><div>billing@example.net</div><div>Delegated</div></a>`;
    expect(delegatedFromDocument(document, [ME])).toEqual([
      { email: 'team@example.com', name: 'Team Inbox', url: 'https://mail.google.com/mail/u/0/d/AEoRXRSteam00001/' },
      { email: 'ops@example.com', name: 'Ops', url: 'https://mail.google.com/mail/u/0/d/AEoRXRSops000001/' },
      { email: 'billing@example.net', name: 'Billing', url: 'https://mail.google.com/mail/u/0/d/AEoRXRSbill00001/' },
    ]);
  });

  it('keeps script data pairs inside their own record', () => {
    const js = `[["/mail/u/0/d/AEoRXRSfirst0001/"],["Second","second@example.com","/mail/u/0/d/AEoRXRSsecond001/"]]`;
    expect(parseDelegated(js)).toEqual([{ email: 'second@example.com', name: 'Second', url: 'https://mail.google.com/mail/u/0/d/AEoRXRSsecond001/' }]);
  });

  it('ignores another site’s /mail/ path', () => {
    expect(parseDelegated(`<a href="https://evil.example.com/mail/u/0/d/${TOKEN}/">team@example.com</a>`)).toEqual([]);
    expect(parseDelegated(`see evil.example.com/mail/b/AEoRXRS_old/ team@example.com`)).toEqual([]);
    expect(parseDelegated(`"/mail/b/AEoRXRS_old/" team@example.com`)).toHaveLength(1);
  });

  it('lists a mailbox once even when its address is spelled two ways or it has two addresses', () => {
    document.body.innerHTML = `
      <a href="/mail/u/0/d/${TOKEN}/" aria-label="Team (team@example.com)">Team</a>
      <script>var d = ["Team alias","alias@example.com","/mail/u/0/d/${TOKEN}/"];</script>`;
    expect(delegatedFromDocument(document, [ME]).map((d) => d.email)).toEqual(['team@example.com']);
  });

  it('finds links deep in large escaped script data', () => {
    const filler = 'x'.repeat(2_000_000);
    const js = `${filler}["Team Inbox","team\\x40example.com","\\x2Fmail\\x2Fu\\x2F0\\x2Fd\\x2F${TOKEN}\\x2F"]${filler}`;
    // Only a window around the link is unescaped, not megabytes of code.
    let longest = 0;
    const replace = String.prototype.replace;
    const spy = vi.spyOn(String.prototype, 'replace').mockImplementation(function (this: string, ...args: unknown[]) {
      longest = Math.max(longest, this.length);
      return (replace as (...a: unknown[]) => string).apply(this, args);
    });
    try {
      expect(parseDelegated(js)).toEqual([{ email: 'team@example.com', name: 'Team Inbox', url: `https://mail.google.com/mail/u/0/d/${TOKEN}/` }]);
    } finally {
      spy.mockRestore();
    }
    expect(longest).toBeLessThan(10_000);
  });

  it('never takes another signed-in account for a delegated mailbox', async () => {
    document.body.innerHTML = `<a href="/mail/u/0/d/${TOKEN}/"><div>Bo</div><div>bo@example.com</div><div>Team</div><div>team@example.com</div></a>`;
    const found = await discoverDelegated(document, Promise.resolve([ME, 'bo@example.com', undefined]));
    expect(found.map((d) => d.email)).toEqual(['team@example.com']);
  });
});

describe('tabs the extension manages', () => {
  it('reloads and picks only tabs that run the app', () => {
    expect(runsApp('https://mail.google.com/mail/u/0/#inbox')).toBe(true);
    expect(runsApp(`https://mail.google.com/mail/u/0/d/${TOKEN}/#inbox`)).toBe(false);
    expect(runsApp('https://mail.google.com/mail/b/391/u/0/')).toBe(false);
    expect(runsApp('https://mail.google.com/mail/u/0/?view=cm&fs=1')).toBe(false);
    expect(runsApp(undefined)).toBe(false);
  });

  it('fits delegated desktop Gmail to a phone screen only', () => {
    const phone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1';
    const desktop = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const delegated = new URL(`https://mail.google.com/mail/u/0/d/${TOKEN}/#inbox`);
    expect(fitsDelegated(delegated, true, phone)).toBe(true);
    expect(fitsDelegated(delegated, false, phone)).toBe(false);
    expect(fitsDelegated(delegated, true, desktop)).toBe(false);
    expect(fitsDelegated(new URL('https://mail.google.com/mail/u/0/#inbox'), true, phone)).toBe(false);
  });
});
