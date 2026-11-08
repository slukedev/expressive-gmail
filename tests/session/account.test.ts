import { accountIndexFromPath, composeFallbackUrl, htmlToPlainText, parseAccountLabel } from '../../src/session/account';

it.each([
  ['/sync/u/0', 0],
  ['/sync/u/3', 3],
  ['/mail/u/12/#inbox', 12],
  ['/mail/', 0],
])('account index of %s is %i', (path, index) => {
  expect(accountIndexFromPath(path)).toBe(index);
});

describe('parseAccountLabel', () => {
  it.each([
    ['Google Account: Ada Lovelace  \n(ada@example.com)', { name: 'Ada Lovelace', email: 'ada@example.com' }],
    ['Compte Google : Zoë Ünal (zoe@example.fr)', { name: 'Zoë Ünal', email: 'zoe@example.fr' }],
    ['Google 帐号: 李雷 (lilei@example.cn)', { name: '李雷', email: 'lilei@example.cn' }],
    ['Google Account: (no-name@example.com)', { email: 'no-name@example.com' }],
  ])('reads %j', (label, expected) => {
    expect(parseAccountLabel(label)).toEqual(expected);
  });

  it.each([null, '', 'Google apps', 'Account: Ada (not an address)'])('gives up on %j', (label) => {
    expect(parseAccountLabel(label)).toEqual({});
  });
});

describe('composeFallbackUrl', () => {
  it('opens Gmail\'s own compose with every field encoded', () => {
    const url = new URL(
      composeFallbackUrl(
        {
          to: [{ email: 'grace@example.org', name: 'Grace' }, { email: 'linus+git@example.net' }],
          cc: [],
          bcc: [{ email: 'boss@example.com' }],
          subject: 'Q3 & Q4 plans 📈',
          html: '<div dir="ltr">Hi Grace,<br>See <b>attached</b> &amp; reply.</div><div>Ada</div>',
        },
        2,
      ),
    );
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/u/2/');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: 'cm',
      fs: '1',
      to: 'grace@example.org,linus+git@example.net',
      bcc: 'boss@example.com',
      su: 'Q3 & Q4 plans 📈',
      body: 'Hi Grace,\nSee attached & reply.\nAda',
    });
  });
});

describe('htmlToPlainText', () => {
  it('drops scripts and styles and decodes entities, without touching the DOM', () => {
    expect(htmlToPlainText('<style>p{}</style><p>5 &lt; 6 &#x1F600; &#8364;</p><script>alert(1)</script><p>&bogus; end</p>')).toBe(
      '5 < 6 😀 €\n&bogus; end',
    );
  });
});
