import type { Address, Message, ThreadSummary } from '../../src/app/data/types';
import { createDemoBackend } from '../../src/app/data/demo';
import { fromBase64 } from '../../src/app/data/demo/util';
import {
  analyzeMessage,
  analyzeRow,
  buildIcsReply,
  detectLanguage,
  etaPassed,
  findCode,
  findDeal,
  googleCalendarUrl,
  messageText,
  packageStatus,
  parseIcs,
  phishingSignals,
  type SmartInfo,
} from '../../src/app/smart/extract';
import { collectPackages } from '../../src/app/smart/packages';

/** Thursday, October 8 2026, 10:00 local, the same pin the demo tests use. */
const NOW = new Date(2026, 9, 8, 10, 0, 0, 0).getTime();
const DAY = 86_400_000;
const ME = 'alex.rivera@example.com';

function msg(p: Partial<Message> & { from?: Address }): Message {
  return {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX', 'CATEGORY_UPDATES'],
    from: { name: 'Sender', email: 'noreply@sender.example' },
    to: [{ email: ME }],
    cc: [],
    bcc: [],
    date: NOW - DAY,
    subject: '',
    snippet: '',
    attachments: [],
    headers: {},
    ...p,
  };
}

function row(p: Partial<ThreadSummary>): ThreadSummary {
  return {
    id: 't1',
    subject: '',
    snippet: '',
    labelIds: ['INBOX', 'CATEGORY_UPDATES'],
    participants: [{ name: 'Sender', email: 'noreply@sender.example' }],
    messageCount: 1,
    draftCount: 0,
    lastDate: NOW - DAY,
    hasAttachments: false,
    attachments: [],
    ...p,
  };
}

const kind = <K extends SmartInfo['kind']>(infos: SmartInfo[], k: K) =>
  infos.find((i) => i.kind === k) as Extract<SmartInfo, { kind: K }> | undefined;

/** A notice-style HTML email: heading, body copy, then a two-column facts table. */
function notice(heading: string, body: string[], facts: [string, string][] = [], link?: { text: string; href: string }) {
  return `<html><head><style>td{padding:4px}</style></head><body><table role="presentation"><tr><td>
    <h1>${heading}</h1>${body.map((b) => `<p>${b}</p>`).join('')}
    <table>${facts.map(([k, v]) => `<tr><td>${k}</td><td><b>${v}</b></td></tr>`).join('')}</table>
    ${link ? `<p><a href="${link.href}">${link.text}</a></p>` : ''}
  </td></tr></table></body></html>`;
}

describe('findCode', () => {
  it.each([
    ['Your code is 482 913', '482913', '482 913'],
    ['Your Ledgerly verification code: 482913', '482913', '482913'],
    ['123456 is your Reelhouse login code', '123456', '123456'],
  ])('%s', (text, code, display) => {
    expect(findCode(text)).toEqual({ code, display });
  });

  it('reads "Use 7731 to sign in"', () => {
    expect(findCode('Use 7731 to sign in to Inkwell.')).toEqual({ code: '7731', display: '7731' });
  });

  it('reads Google’s "G-123456" format as the six digits you type', () => {
    expect(findCode('G-123456 is your Google verification code.')?.code).toBe('123456');
  });

  it('picks the code and ignores the expiry, phone number and year around it', () => {
    const body = 'Your verification code is 604 118. It expires in 10 minutes. Questions? Call 555-0134. © 2026 Ledgerly Inc.';
    expect(findCode(body)).toEqual({ code: '604118', display: '604 118' });
  });

  it('prefers an earlier source (subject) over a later one (body)', () => {
    expect(findCode('Your Ledgerly code: 482 913', 'Enter 482 913 to finish. Order #20261008 is unrelated.')?.code).toBe('482913');
  });

  it.each([
    'Order #20261008 has shipped',
    'Your card ending 4421 was charged $58.12',
    'Your Reelhouse receipt: $15.99 charged to card ending 4421',
    '© 2026 Oakline Home, 210 Grain St, Grand Rapids, MI 49503',
    'Call us at 555-0134 if you have questions',
    'This link expires in 10 minutes.',
    'Your statement for Everyday Checking (ending 0912) is ready',
    'Meeting moved to 2:30 on 10/09',
    'Flight AB 218 departs at 0725 from gate 12',
  ])('no code in "%s"', (text) => {
    expect(findCode(text)).toBeNull();
  });

  it('returns null with no usable source', () => {
    expect(findCode(undefined, '')).toBeNull();
  });
});

describe('packageStatus', () => {
  it.each([
    ['Your package is out for delivery and should arrive by 6 PM', 'out-for-delivery'],
    ['Out for delivery: PP 4419 2086 7731 US', 'out-for-delivery'],
    ['Delivered: your package from Oakline Home', 'delivered'],
    ['Your package was delivered at 2:37 PM and left at the front door', 'delivered'],
    ['Your order has shipped and will be delivered tomorrow', 'shipped'],
    ['Good news: your order is on its way. It will be delivered Friday.', 'shipped'],
  ] as const)('%s -> %s', (text, status) => {
    expect(packageStatus(text)).toBe(status);
  });

  it('has nothing to say about ordinary mail', () => {
    expect(packageStatus('Lunch on Friday? I can do 12:30 near the office.')).toBeNull();
  });
});

describe('analyzeMessage: packages', () => {
  it('reads a UPS 1Z number and carrier', () => {
    const m = msg({
      subject: 'Your Oakline Home order has shipped',
      bodyHtml: notice('Your order is on its way', ['Shipped with UPS Ground. It will be delivered Tuesday.'], [['Tracking number', '1Z999AA10123456784']]),
    });
    const p = kind(analyzeMessage(m), 'package');
    expect(p).toMatchObject({ status: 'shipped', tracking: '1Z999AA10123456784', carrier: 'UPS' });
  });

  it('finds an unlabelled UPS 1Z number in plain text', () => {
    const m = msg({
      subject: 'Shipped: 1 item',
      bodyText: 'Your item has shipped via UPS. Track it with 1Z999AA10123456784.\nEstimated delivery: Tuesday, October 13',
    });
    expect(kind(analyzeMessage(m), 'package')).toMatchObject({
      status: 'shipped',
      tracking: '1Z999AA10123456784',
      carrier: 'UPS',
      eta: 'Tuesday, October 13',
      trackUrl: expect.stringContaining('1Z999AA10123456784'),
    });
  });

  it('finds an unlabelled 22-digit USPS number', () => {
    const m = msg({
      subject: 'Your package is out for delivery',
      bodyText: 'Your USPS package 9400111899223197428490 is out for delivery.\nExpected delivery: by 8:00pm today',
    });
    expect(kind(analyzeMessage(m), 'package')).toMatchObject({ status: 'out-for-delivery', tracking: '9400111899223197428490', carrier: 'USPS' });
  });

  it('recognises a spaced, labelled USPS number as USPS and links the digits', () => {
    const m = msg({ subject: 'Your package is out for delivery', bodyText: 'Tracking number: 9400 1118 9922 3197 4284 90\nExpected delivery by 8:00pm today.' });
    const p = kind(analyzeMessage(m), 'package');
    expect(p).toMatchObject({ status: 'out-for-delivery', tracking: '9400 1118 9922 3197 4284 90', carrier: 'USPS' });
    expect(p?.trackUrl).toContain('9400111899223197428490');
  });

  it('keeps the sender’s labelled tracking number as written and the track link', () => {
    const m = msg({
      subject: 'Your package is on its way',
      bodyHtml: notice(
        'Your package is on its way',
        ['Oakline Home shipped your order.'],
        [
          ['Tracking number', 'PP 4419 2086 7731 US'],
          ['Carrier', 'Parcelpath Freight'],
          ['Estimated delivery', 'Friday, October 9'],
        ],
        { text: 'Track package', href: 'https://parcelpath.example/t/PP441920867731US' },
      ),
    });
    expect(kind(analyzeMessage(m), 'package')).toMatchObject({
      status: 'shipped',
      tracking: 'PP 4419 2086 7731 US',
      carrier: 'Parcelpath Freight',
      eta: 'Friday, October 9',
      trackUrl: 'https://parcelpath.example/t/PP441920867731US',
    });
  });

  it('does not call a newsletter that says "delivered" a package', () => {
    const m = msg({
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
      subject: 'Patch Notes #42: fresh ideas delivered weekly',
      bodyText: 'This week: three tools we liked, one we didn’t. Delivered to 40,000 readers every Friday.',
    });
    expect(kind(analyzeMessage(m), 'package')).toBeUndefined();
  });
});

describe('findDeal', () => {
  it('reads "Up to 30% off through Monday"', () => {
    const d = findDeal('Up to 30% off lamps, pendants and candles through Monday.');
    expect(d?.discount).toMatch(/30% off/);
    expect(d?.expires).toMatch(/Monday/);
  });

  it('reads a promo code', () => {
    expect(findDeal('Take 20% off your order. Use code FALL20 at checkout.')).toMatchObject({ code: 'FALL20' });
  });

  it('reads a dollar discount', () => {
    expect(findDeal('Here’s $15 off your next order, just for you.')?.discount).toMatch(/\$15 off/);
  });

  it.each([
    'Your Bayline Energy bill is ready: $58.12 due October 25',
    'Battery at 30%. Plug in soon.',
    'Can you send me the deck by Monday?',
  ])('no deal in "%s"', (text) => {
    expect(findDeal(text)).toBeNull();
  });
});

describe('messageText', () => {
  it('turns a facts table into lowercased key/value facts and keeps links', () => {
    const t = messageText({
      subject: 'Your receipt',
      snippet: '',
      bodyHtml: notice('Thanks for your order', ['We’re getting it ready.'], [['Order number', 'OH-55120'], ['Total', '$249.00']], {
        text: 'View order',
        href: 'https://oaklinehome.example/orders/OH-55120',
      }),
    });
    expect(t.facts.get('order number')).toBe('OH-55120');
    expect(t.facts.get('total')).toBe('$249.00');
    expect(t.links).toContainEqual({ text: 'View order', href: 'https://oaklinehome.example/orders/OH-55120' });
    expect(t.text).not.toContain('padding');
  });

  it('reads "Key: Value" lines from plain text', () => {
    const t = messageText({ subject: '', snippet: '', bodyText: 'Hi Alex,\nConfirmation: K7XQ2M\nSeat: 24A' });
    expect(t.facts.get('confirmation')).toBe('K7XQ2M');
  });

  it('drops hidden preheader text', () => {
    const t = messageText({ subject: '', snippet: '', bodyHtml: '<div style="display:none">SECRET PREHEADER</div><p>Visible</p>' });
    expect(t.text).toContain('Visible');
    expect(t.text).not.toContain('SECRET PREHEADER');
  });
});

describe('analyzeMessage', () => {
  it('reads a receipt’s order number and total', () => {
    const m = msg({
      from: { name: 'Oakline Home', email: 'orders@oaklinehome.example' },
      subject: 'Your Oakline Home order OH-55120',
      bodyHtml: notice('Thanks for your order', ['We’ll email you when it ships.'], [
        ['Order number', 'OH-55120'],
        ['Walnut floor lamp', '$229.00'],
        ['Tax', '$20.00'],
        ['Total', '$249.00'],
      ]),
    });
    expect(kind(analyzeMessage(m), 'receipt')).toMatchObject({ orderNo: 'OH-55120', total: '$249.00' });
  });

  it('reads a bill’s amount, due date and autopay', () => {
    const m = msg({
      from: { name: 'Bayline Energy', email: 'billing@baylineenergy.example' },
      subject: 'Your Bayline Energy bill is ready: $58.12',
      bodyHtml: notice('Your bill is ready', ['You used 182 kWh this month.'], [
        ['Amount due', '$58.12'],
        ['Due date', 'October 25, 2026'],
        ['Autopay', 'On, Card ending 4421'],
      ]),
    });
    const b = kind(analyzeMessage(m), 'bill');
    expect(b).toMatchObject({ amount: '$58.12', due: 'October 25, 2026' });
    expect(b?.autopay).toMatch(/4421/);
    // A bill is not a one-time code just because it has "ending 4421" in it.
    expect(kind(analyzeMessage(m), 'code')).toBeUndefined();
  });

  it('reads a verification code with the service name', () => {
    const m = msg({
      from: { name: 'Ledgerly', email: 'security@ledgerly.example' },
      subject: 'Your Ledgerly verification code',
      bodyText: 'Enter this code to finish signing in:\n\n604 118\n\nThe code expires in 10 minutes.',
    });
    expect(kind(analyzeMessage(m), 'code')).toMatchObject({ code: '604118', display: '604 118', service: 'Ledgerly' });
  });

  it('finds no code in a note between people full of numbers', () => {
    const m = msg({
      labelIds: ['INBOX', 'CATEGORY_PERSONAL'],
      from: { name: 'Sam Okafor', email: 'sam@example.com' },
      subject: 'Re: lease',
      bodyText: 'Rent is $2,450 starting 11/01. My card ending 4421 is on file. Call me at 555-0134 any time after 2026-01-01.',
    });
    expect(analyzeMessage(m)).toEqual([]);
  });

  it('finds no code in a coworker asking for a code review', () => {
    const r = row({ labelIds: ['INBOX', 'CATEGORY_PERSONAL'], subject: 'Code review for PR 4410?', snippet: 'Could you look before Friday? It touches the onboarding flow.' });
    expect(analyzeRow(r, ME, NOW)).toBeNull();
  });

  it('only offers deals on promotional mail', () => {
    const text = 'Take 20% off everything this weekend. Use code FALL20.';
    const promo = msg({ labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], subject: 'Members only: 20% off', bodyText: text });
    expect(kind(analyzeMessage(promo), 'deal')).toMatchObject({ code: 'FALL20' });
    const personal = msg({ labelIds: ['INBOX', 'CATEGORY_PERSONAL'], subject: 'saw this', bodyText: text });
    expect(kind(analyzeMessage(personal), 'deal')).toBeUndefined();
  });
});

describe('analyzeRow', () => {
  it('shows a code on a row from its subject or snippet', () => {
    expect(analyzeRow(row({ subject: 'Your Ledgerly verification code: 482 913', snippet: 'Enter this code to finish signing in.' }), ME, NOW)).toEqual({
      kind: 'code',
      code: '482913',
      display: '482 913',
    });
  });

  it.each(['SPAM', 'TRASH'])('shows nothing for a row in %s', (label) => {
    const r = row({ labelIds: [label, 'CATEGORY_UPDATES'], subject: 'Your verification code is 482 913', snippet: 'Your package is out for delivery' });
    expect(analyzeRow(r, ME, NOW)).toBeNull();
  });

  it('shows the package status from the subject', () => {
    expect(analyzeRow(row({ subject: 'Out for delivery: PP 4419 2086 7731 US' }), ME, NOW)).toEqual({ kind: 'package', status: 'out-for-delivery' });
  });

  it('marks calendar invitations', () => {
    const r = row({ labelIds: ['INBOX', 'CATEGORY_PERSONAL'], subject: 'Invitation: Design crit @ Fri Oct 9, 2pm to 3pm', hasAttachments: true });
    expect(analyzeRow(r, ME, NOW)?.kind).toBe('invite');
  });

  const question = row({
    labelIds: ['INBOX', 'CATEGORY_PERSONAL'],
    subject: 'Question about the lease renewal',
    snippet: 'Hi Alex, could you confirm whether you want the parking spot again?',
    participants: [{ name: 'Morgan Lee', email: 'morgan@example.com' }],
    recipients: [{ name: 'Alex Rivera', email: ME }],
    lastDate: NOW - 5 * DAY,
  });

  it('nudges a read question to me that has waited a few days', () => {
    expect(analyzeRow(question, ME, NOW)).toEqual({ kind: 'nudge', days: 5 });
  });

  it.each([
    ['still unread', { labelIds: ['INBOX', 'CATEGORY_PERSONAL', 'UNREAD'] }],
    ['only a day old', { lastDate: NOW - DAY }],
    ['a month old', { lastDate: NOW - 30 * DAY }],
    ['I had the last word', { recipients: [{ email: 'morgan@example.com' }], participants: [{ email: 'morgan@example.com' }, { email: ME }] }],
    ['not a question', { snippet: 'Hi Alex, the parking spot is yours again. Nothing to do.' }],
    ['from a newsletter', { labelIds: ['INBOX', 'CATEGORY_UPDATES'] }],
  ])('does not nudge when %s', (_, patch) => {
    expect(analyzeRow({ ...question, ...patch }, ME, NOW)).toBeNull();
  });
});

// Calendar

const CRLF = (lines: string[]) => lines.join('\r\n') + '\r\n';

const OUTLOOK_INVITE = CRLF([
  'BEGIN:VCALENDAR',
  'PRODID:-//Example Corp//Calendar 16.0//EN',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:Pacific Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T020000',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0800',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E008@example.com',
  'SEQUENCE:2',
  'ORGANIZER;CN="Natarajan, Priya":mailto:priya@example.com',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Leila Haddad:mailto:leila@example.com',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Alex Rivera:MAILTO:alex.rivera@example.com',
  'ATTENDEE;ROLE=OPT-PARTICIPANT;PARTSTAT=DECLINED:mailto:jonas@example.com',
  'SUMMARY:Design crit\\, round 2',
  'LOCATION:Lighthouse\\, 3rd floor',
  'DESCRIPTION:This week: Alex (onboarding v4)\\, Leila (error messages)\\, Jonas',
  '  (brand illustrations).\\nBring work in progress.',
  'DTSTART:20261009T180000Z',
  'DTEND:20261009T190000Z',
  'END:VEVENT',
  'END:VCALENDAR',
]);

describe('parseIcs', () => {
  it('reads an Outlook-style invite: folded lines, escapes, UTC times, organizer and attendees', () => {
    const ev = parseIcs(OUTLOOK_INVITE)!;
    expect(ev).toMatchObject({
      uid: '040000008200E00074C5B7101A82E008@example.com',
      method: 'REQUEST',
      title: 'Design crit, round 2',
      location: 'Lighthouse, 3rd floor',
      description: 'This week: Alex (onboarding v4), Leila (error messages), Jonas (brand illustrations).\nBring work in progress.',
      start: Date.UTC(2026, 9, 9, 18, 0),
      end: Date.UTC(2026, 9, 9, 19, 0),
      allDay: false,
      sequence: 2,
      organizer: { name: 'Natarajan, Priya', email: 'priya@example.com' },
    });
    expect(ev.attendees).toEqual([
      { name: 'Leila Haddad', email: 'leila@example.com', status: 'ACCEPTED' },
      { name: 'Alex Rivera', email: 'alex.rivera@example.com', status: 'NEEDS-ACTION' },
      { name: undefined, email: 'jonas@example.com', status: 'DECLINED' },
    ]);
  });

  it('ignores the DTSTART inside VTIMEZONE', () => {
    expect(parseIcs(OUTLOOK_INVITE)!.start).toBe(Date.UTC(2026, 9, 9, 18, 0));
  });

  it('treats a time without Z as floating local time', () => {
    const ev = parseIcs(CRLF(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', 'SUMMARY:Dentist', 'DTSTART:20261012T083000', 'DTEND:20261012T090000', 'END:VEVENT', 'END:VCALENDAR']))!;
    expect(ev.start).toBe(new Date(2026, 9, 12, 8, 30).getTime());
    expect(ev.end).toBe(new Date(2026, 9, 12, 9, 0).getTime());
    expect(ev.allDay).toBe(false);
  });

  // Outlook and Apple Calendar send TZID-qualified local times. Lisbon is UTC+1 on Oct 9.
  it('honours TZID on DTSTART', () => {
    const ev = parseIcs(CRLF(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:tz', 'SUMMARY:Check-in', 'DTSTART;TZID=Europe/Lisbon:20261009T150000', 'END:VEVENT', 'END:VCALENDAR']))!;
    // Only meaningful when the test machine is not on Lisbon time.
    expect(new Date(2026, 9, 9, 15).getTime()).not.toBe(Date.UTC(2026, 9, 9, 14));
    expect(ev.start).toBe(Date.UTC(2026, 9, 9, 14, 0));
  });

  it('reads an all-day event from VALUE=DATE', () => {
    const ev = parseIcs(
      CRLF(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Lisbon offsite', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261015', 'END:VEVENT', 'END:VCALENDAR']),
    )!;
    expect(ev).toMatchObject({ allDay: true, start: new Date(2026, 9, 12).getTime(), end: new Date(2026, 9, 15).getTime(), title: 'Lisbon offsite' });
  });

  it('accepts LF-only files', () => {
    const ev = parseIcs(OUTLOOK_INVITE.replace(/\r\n/g, '\n'))!;
    expect(ev.title).toBe('Design crit, round 2');
    expect(ev.description).toContain('Jonas (brand illustrations)');
  });

  it('returns null for something that is not a calendar', () => {
    expect(parseIcs('Hello, this is not a calendar file.')).toBeNull();
    expect(parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')).toBeNull();
  });
});

describe('buildIcsReply', () => {
  const me = { name: 'Alex Rivera', email: 'alex.rivera@example.com' };

  it.each(['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const)('%s round-trips through parseIcs as a REPLY from me', (answer) => {
    const ev = parseIcs(OUTLOOK_INVITE)!;
    const reply = buildIcsReply(ev, me, answer, NOW);
    expect(reply).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(reply.split('\r\n')).toContain('METHOD:REPLY');

    const back = parseIcs(reply)!;
    expect(back).toMatchObject({ method: 'REPLY', uid: ev.uid, title: ev.title, start: ev.start, end: ev.end, sequence: 2 });
    expect(back.organizer?.email).toBe('priya@example.com');
    expect(back.attendees).toEqual([{ email: me.email, name: me.name, status: answer }]);
  });

  it('keeps lines within 75 octets as RFC 5545 asks', () => {
    const ev = parseIcs(OUTLOOK_INVITE)!;
    const long = { ...ev, title: 'Quarterly planning: onboarding v4, error messages, brand illustrations and the Lisbon offsite agenda' };
    const reply = buildIcsReply(long, me, 'ACCEPTED', NOW);
    const enc = new TextEncoder();
    for (const line of reply.split('\r\n')) expect(enc.encode(line).length).toBeLessThanOrEqual(75);
    expect(parseIcs(reply)!.title).toBe(long.title);
  });
});

describe('googleCalendarUrl', () => {
  it('builds a TEMPLATE link with UTC dates, title and location', () => {
    const url = new URL(googleCalendarUrl(parseIcs(OUTLOOK_INVITE)!));
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Design crit, round 2');
    expect(url.searchParams.get('location')).toBe('Lighthouse, 3rd floor');
    expect(url.searchParams.get('dates')).toBe('20261009T180000Z/20261009T190000Z');
  });

  it('uses date-only values for an all-day event', () => {
    const ev = parseIcs(
      CRLF(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:b', 'SUMMARY:Offsite', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261015', 'END:VEVENT', 'END:VCALENDAR']),
    )!;
    expect(new URL(googleCalendarUrl(ev)).searchParams.get('dates')).toBe('20261012/20261015');
  });
});

describe('detectLanguage', () => {
  it('Portuguese', () => {
    const text =
      'Olá Alex, tudo bem? Recebemos o seu pedido e a reserva está confirmada para o dia 12 de outubro. O check-in é a partir das 15h e o pequeno-almoço é servido no jardim. Se precisar de alguma coisa, é só responder a este email. Até breve!';
    expect(detectLanguage(text)).toBe('Portuguese');
  });

  it.each([
    ['Japanese', 'アレックスさん、来週の東京出張の件で連絡しました。ホテルは新宿の近くに予約してあります。よろしくお願いします。'],
    ['Arabic', 'مرحبا أليكس، شكرا على رسالتك. سأرسل لك التفاصيل غدا إن شاء الله.'],
    ['German', 'Hallo Alex, vielen Dank für deine Nachricht. Ich schicke dir die Unterlagen morgen, sobald ich wieder im Büro bin. Viele Grüße'],
  ])('%s', (lang, text) => {
    expect(detectLanguage(text)).toBe(lang);
  });

  it('English with one German word is English', () => {
    expect(
      detectLanguage('Hi Alex, the kids loved the kindergarten tour. We had a real Gemütlichkeit moment at the café afterwards. See you Saturday for the run club?'),
    ).toBeNull();
  });

  it('a short English note is English', () => {
    expect(detectLanguage('Sounds good, see you then!')).toBeNull();
  });

  it('English mail with a Portuguese sign-off is English', () => {
    expect(detectLanguage('Your room is confirmed. Breakfast is served in the garden from 7:30 to 10:30. Check-in is from 3 PM. Bem-vindo a Lisboa!')).toBeNull();
  });
});

describe('phishingSignals', () => {
  const paypalish = msg({
    from: { name: 'PayPal', email: 'service@paypal.example.com' },
    subject: 'Your account has been limited',
  });

  it('flags a link that shows one host and goes to another', () => {
    const html = '<p>Please confirm your details at <a href="https://paypa1.example.net/login?id=88">https://paypal.example.com/signin</a></p>';
    expect(phishingSignals(paypalish, html).length).toBeGreaterThan(0);
  });

  it('flags link text that is a bare host', () => {
    const html = '<p>Sign in at <a href="http://paypa1.example.net/">paypal.example.com</a></p>';
    expect(phishingSignals(paypalish, html).length).toBeGreaterThan(0);
  });

  it.each([
    ['button text that is not a host', '<a href="https://parcelpath.example/t/PP441920867731US">Track package</a>'],
    ['text and href on the same host', '<a href="https://parcelpath.example/t/PP441920867731US">parcelpath.example/t/PP441920867731US</a>'],
    ['www on one side only', '<a href="https://paypal.example.com/activity">www.paypal.example.com</a>'],
  ])('does not flag %s', (_, html) => {
    expect(phishingSignals(paypalish, html)).toEqual([]);
  });

  it('flags a Reply-To on another domain when the mail asks for credentials', () => {
    const m = msg({
      from: { name: 'Juniper Savings', email: 'alerts@junipersavings.example' },
      replyTo: [{ email: 'juniper.verify@freemail.example' }],
      subject: 'Action required',
      bodyText: 'We noticed unusual activity. Reply with your password and card number to verify your account.',
    });
    expect(phishingSignals(m, undefined).length).toBeGreaterThan(0);
  });

  it('does not flag a Reply-To mismatch on its own (mailing lists, help desks)', () => {
    const m = msg({
      from: { name: 'Fernwork Events', email: 'events@fernwork.example' },
      replyTo: [{ email: 'rsvp@eventdesk.example' }],
      subject: 'Holiday party',
      bodyText: 'Reply to let us know if you can make it. Plus-ones welcome.',
    });
    expect(phishingSignals(m, undefined)).toEqual([]);
  });

  it('flags a display name that is a different address', () => {
    const m = msg({ from: { name: 'security@paypal.example.com', email: 'x92kd@bulkmail.example' }, subject: 'Security alert', bodyText: 'Review this sign-in.' });
    expect(phishingSignals(m, undefined).length).toBeGreaterThan(0);
  });

  it('does not flag a display name that is the sender’s own address', () => {
    const m = msg({ from: { name: 'noreply@sender.example', email: 'noreply@sender.example' }, subject: 'Weekly digest', bodyText: 'Here is your digest.' });
    expect(phishingSignals(m, undefined)).toEqual([]);
  });
});

describe('the demo mailbox', () => {
  const b = createDemoBackend({ now: () => NOW, liveMail: false });

  async function all() {
    const page = await b.listThreads({ q: 'in:anywhere', pageSize: 1000 });
    expect(page.nextPageToken).toBeUndefined();
    return page.threads;
  }

  async function infos(id: string) {
    const t = await b.getThread(id);
    return t.messages.flatMap((m) => analyzeMessage(m));
  }

  it('finds the Ledgerly code', async () => {
    expect(kind(await infos('u-ledgerly-2fa'), 'code')).toMatchObject({ code: '482913', display: '482 913', service: expect.stringMatching(/Ledgerly/) });
    const s = (await all()).find((t) => t.id === 'u-ledgerly-2fa')!;
    expect(analyzeRow(s, ME, NOW)).toEqual({ kind: 'code', code: '482913', display: '482 913' });
  });

  it('follows the Oakline package from shipped to delivered', async () => {
    expect(kind(await infos('u-parcel-shipped'), 'package')).toMatchObject({
      status: 'shipped',
      tracking: 'PP 4419 2086 7731 US',
      carrier: 'Parcelpath Freight',
      trackUrl: 'https://parcelpath.example/t/PP441920867731US',
    });
    expect(kind(await infos('u-parcel-out'), 'package')).toMatchObject({ status: 'out-for-delivery', tracking: 'PP 4419 2086 7731 US' });
    expect(kind(await infos('u-parcel-delivered'), 'package')).toMatchObject({ status: 'delivered', tracking: 'PP 4419 2086 7731 US' });
  });

  it('reads the Bayline bill', async () => {
    const bill = kind(await infos('u-bayline'), 'bill');
    expect(bill?.amount).toBe('$58.12');
    expect(bill?.due).toBeTruthy();
    expect(bill?.autopay).toMatch(/4421/);
  });

  it('reads the Albatross flight', async () => {
    expect(kind(await infos('u-albatross'), 'flight')).toMatchObject({ confirmation: 'K7XQ2M', route: { from: 'SFO', to: 'LIS' } });
  });

  it('reads the Casa Lumiar stay and the library pickup', async () => {
    expect(kind(await infos('u-lumiar'), 'stay')).toMatchObject({ confirmation: 'CL-20931-FW' });
    expect(kind(await infos('u-library'), 'pickup')).toMatchObject({ what: expect.stringMatching(/ready for pickup/), by: expect.any(String) });
  });

  it('reads a Forkful food receipt as a receipt, not a delivered package', async () => {
    const found = await infos('u-forkful-1');
    expect(kind(found, 'package')).toBeUndefined();
    expect(kind(found, 'receipt')).toMatchObject({ orderNo: 'FK-1180-7729' });
  });

  it('reads the Stride deal', async () => {
    const t = await b.getThread('p-stride-2');
    expect(kind(t.messages.flatMap((m) => analyzeMessage(m)), 'deal')?.discount).toMatch(/20% off/);
    expect(analyzeRow(t, ME, NOW)).toMatchObject({ kind: 'deal', discount: expect.stringMatching(/20% off/) });
  });

  it('marks the design crit as an invite whose .ics parses', async () => {
    const t = await b.getThread('t-design-crit-invite');
    expect(analyzeRow(t, ME, NOW)).toEqual({ kind: 'invite' });
    const att = t.messages.flatMap((m) => m.attachments).find((a) => a.mimeType === 'text/calendar')!;
    const res = await b.getAttachment(att.messageId, att.id);
    const ev = parseIcs(new TextDecoder().decode(fromBase64(res.data)))!;
    expect(ev).toMatchObject({
      title: 'Design crit',
      location: 'Lighthouse, 3rd floor',
      start: new Date(2026, 9, 9, 14, 0).getTime(),
      end: new Date(2026, 9, 9, 15, 0).getTime(),
      allDay: false,
      organizer: { email: expect.stringContaining('priya') },
    });
    expect(ev.attendees.map((a) => a.email)).toContain(ME);
  });

  it('never annotates a row in Spam or Trash', async () => {
    const hidden = (await all()).filter((t) => t.labelIds.includes('SPAM') || t.labelIds.includes('TRASH'));
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.map((t) => [t.id, analyzeRow(t, ME, NOW)]).filter(([, r]) => r)).toEqual([]);
  });

  it('shows codes only on real code emails', async () => {
    const coded = (await all())
      .filter((t) => !t.labelIds.includes('SPAM') && !t.labelIds.includes('TRASH'))
      .filter((t) => analyzeRow(t, ME, NOW)?.kind === 'code')
      .map((t) => t.id);
    expect(coded).toEqual(['u-ledgerly-2fa']);
  });

  it('finds no codes in any message body outside verification mail', async () => {
    const hits: string[] = [];
    for (const s of await all()) {
      const t = await b.getThread(s.id);
      for (const m of t.messages) if (kind(analyzeMessage(m), 'code')) hits.push(s.id);
    }
    expect([...new Set(hits)]).toEqual(['u-ledgerly-2fa']);
    // Reads every demo thread; slow when the whole suite runs in parallel.
  }, 20_000);
});

describe('collectPackages', () => {
  it('treats emails with one tracking number as one package and keeps the newest status', async () => {
    const b = createDemoBackend({ now: () => NOW, liveMail: false });
    const ids = ['u-parcel-shipped', 'u-parcel-out', 'u-parcel-delivered', 'x-stride-shipped'];
    const threads = await Promise.all(ids.map((id) => b.getThread(id)));
    const found = collectPackages(threads, NOW);
    // Oakline's three Parcelpath emails are one delivered package; Stride's is still on its way, listed first.
    expect(found.map((p) => [p.info.merchant, p.info.status, p.late])).toEqual([
      ['Stride & Co.', 'shipped', false],
      ['Oakline Home', 'delivered', false],
    ]);
    // The same order read a week later is overdue.
    expect(collectPackages(threads, NOW + 7 * DAY)[0]).toMatchObject({ late: true });
  });
});

describe('etaPassed', () => {
  // Sunday, October 11 2026, 2 PM local.
  const NOW = new Date(2026, 9, 11, 14, 0).getTime();
  it.each([
    ['yesterday', 'Saturday, October 10', true],
    ['today is not late yet', 'Sunday, October 11', false],
    ['later this week', 'Tuesday, October 13', false],
    ['an explicit past year', 'Oct 3, 2025', true],
    ['a time range has no date', '12 PM to 6 PM', false],
    ['nothing to read', undefined, false],
  ])('%s', (_, eta, expected) => {
    expect(etaPassed(eta, NOW)).toBe(expected);
  });

  it('reads January as next year in late December and December as last year in early January', () => {
    expect(etaPassed('January 3', new Date(2026, 11, 28).getTime())).toBe(false);
    expect(etaPassed('December 30', new Date(2027, 0, 2).getTime())).toBe(true);
  });
});
