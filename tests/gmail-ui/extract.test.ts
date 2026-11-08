vi.hoisted(() => {
  process.env.TZ = 'America/New_York';
});

import {
  buildIcsReply,
  detectLanguage,
  etaPassed,
  findCode,
  findDeal,
  googleCalendarUrl,
  packageStatus,
  parseIcs,
} from '../../src/app/smart/extract';
import { billRelevance, codeRelevance, inviteRelevance, packageRelevance, parseDay, RANK } from '../../src/app/smart/freshness';
import {
  addEvents,
  budgetLeft,
  currentEvent,
  latestEvent,
  setManual,
  referenceKey,
  searchDue,
  searchQuery,
  SEARCH_LIMITS,
  timeline,
  type TrackingEvent,
  type TrackingRecord,
} from '../../src/app/smart/tracking';

describe('findCode ("Copy code" on verification mail)', () => {
  it.each([
    ['Your Example verification code is 482913', '482913'],
    ['482913 is your Example sign-in code. Don\'t share it.', '482913'],
    ['G-731904 is your verification code.', '731904'],
    ['Your PIN code is 4821', '4821'],
    ['Your one-time passcode: 12345678', '12345678'],
    ['Enter this code to continue:\n\n  590 214  \n\nIt expires in 10 minutes.', '590214'],
    ['Your security code is 590-214.', '590214'],
  ])('%j', (text, code) => {
    expect(findCode(text)?.code).toBe(code);
  });

  it('keeps the sender\'s grouping for display', () => {
    expect(findCode('Your code is 482 913')?.display).toBe('482 913');
    expect(findCode('Your code is 482-913')?.display).toBe('482-913');
  });

  it('finds the code in the body when the subject only names the service', () => {
    expect(findCode('Your Example account', 'Use 662018 to verify your email address.')?.code).toBe('662018');
  });

  it('picks the code, not the support line, footer year or zip code', () => {
    const body = [
      'Your verification code is 739201.',
      'Questions? Call 1-800-555-0199 or (555) 123-4567.',
      '© 2026 Example Inc, 100 Main St, Springfield, IL 62704',
    ].join('\n');
    expect(findCode(body)?.code).toBe('739201');
  });

  it.each([
    ['an order number', 'Order #48291034 confirmed. Thanks for shopping with Example Store!'],
    ['a price', 'Your total is $1,299.00. Payment received.'],
    ['a phone number', 'Call us at 555-123-4567 any time.'],
    ['a year', 'See you at the 2026 offsite. Agenda attached.'],
    ['an address and zip code', 'Example Inc, 1600 Main St, Springfield, IL 62704'],
    ['a date', 'Your appointment is on 10/07/2026 at 3:00 PM.'],
    ['too few digits', 'Your code is 12'],
    ['too many digits', 'Your code is 1234567890'],
    ['a tracking number', 'Your package is on the way. Tracking number: 9400111899223344556677'],
  ])('ignores %s', (_l, text) => {
    expect(findCode(text)).toBeNull();
  });
});

describe('packageStatus', () => {
  it.each([
    ['Your order has been placed. We\'ll email you when it ships.', 'ordered'],
    ['Good news! Your package has shipped.', 'shipped'],
    ['Your order is on the way and will be delivered Thursday.', 'shipped'],
    ['Out for delivery: your Example Store order', 'out-for-delivery'],
    ['Your package is out for delivery today', 'out-for-delivery'],
    ['Delivered: your package was left at the front door.', 'delivered'],
    ['Your package has been delivered', 'delivered'],
    ['Delivery attempted. We were unable to deliver your package.', 'problem'],
    ['Delivery exception: address could not be found', 'problem'],
  ] as const)('%j', (text, status) => {
    expect(packageStatus(text)).toBe(status);
  });

  it('does not treat "will be delivered" as delivered', () => {
    expect(packageStatus('Your package will be delivered tomorrow by 8 PM.')).not.toBe('delivered');
  });

  it('returns null for ordinary mail', () => {
    expect(packageStatus('Want to grab lunch on Tuesday? The new place on 5th looks good.')).toBeNull();
  });
});

describe('findDeal', () => {
  it('reads discount, code and expiry from a promo', () => {
    const d = findDeal('Fall sale: save 20% on everything. Use code FALL20 at checkout. Offer ends October 15.');
    expect(d?.discount).toMatch(/20%/);
    expect(d?.code).toBe('FALL20');
    expect(d?.expires).toMatch(/Oct(ober)? 15/);
  });

  it('reads a money-off discount', () => {
    expect(findDeal('Take $10 off your next order of $50 or more.')?.discount).toMatch(/\$10/);
  });

  it('returns null for a plain receipt', () => {
    expect(findDeal('Thanks for your order. Order total: $45.00. Paid with Visa.')).toBeNull();
  });
});

// A Google Calendar invite as it arrives: VTIMEZONE first, folded lines, escapes, an alarm.
const INVITE = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:STANDARD',
  'DTSTART:19701101T020000',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=America/New_York:20261020T140000',
  'DTEND;TZID=America/New_York:20261020T150000',
  'DTSTAMP:20261013T120000Z',
  'ORGANIZER;CN=Ana Lopez:mailto:ana@example.com',
  'UID:7kukuqrfedlm2f9t0vkqj0b8d1@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN=Ana Lopez;X-NUM-GUESTS=0:mailto:ana@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=me@',
  ' example.com;X-NUM-GUESTS=0:mailto:me@example.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=TENTATIVE;CN="Pike, Jordan";X-NUM-GUESTS=0:mailto:jordan@example.net',
  'CREATED:20261013T115900Z',
  'DESCRIPTION:Agenda: roadmap\\, hiring\\; budget.\\nBring the Q4 numbers. This line',
  '  is folded.',
  'LAST-MODIFIED:20261013T120000Z',
  'LOCATION:Room 4\\, Floor 2',
  'SEQUENCE:2',
  'STATUS:CONFIRMED',
  'SUMMARY:Q4 planning',
  'TRANSP:OPAQUE',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H10M0S',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

const ALL_DAY = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'BEGIN:VEVENT',
  'UID:allday-1@example.com',
  'DTSTART;VALUE=DATE:20261024',
  'DTEND;VALUE=DATE:20261025',
  'SUMMARY:Team offsite',
  'ORGANIZER:mailto:ana@example.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\n'); // some senders use bare LF

describe('parseIcs', () => {
  const ev = parseIcs(INVITE)!;

  it('reads the event, not the time zone block', () => {
    expect(ev.uid).toBe('7kukuqrfedlm2f9t0vkqj0b8d1@google.com');
    expect(ev.method).toBe('REQUEST');
    expect(ev.title).toBe('Q4 planning');
    expect(ev.sequence).toBe(2);
    expect(ev.allDay).toBe(false);
  });

  it('applies TZID: 2 PM New York in October is 18:00 UTC', () => {
    expect(new Date(ev.start).toISOString()).toBe('2026-10-20T18:00:00.000Z');
    expect(new Date(ev.end!).toISOString()).toBe('2026-10-20T19:00:00.000Z');
  });

  it('unfolds lines and unescapes text (RFC 5545 3.1, 3.3.11)', () => {
    expect(ev.location).toBe('Room 4, Floor 2');
    expect(ev.description).toBe('Agenda: roadmap, hiring; budget.\nBring the Q4 numbers. This line is folded.');
  });

  it('reads organizer and attendees, including a folded attendee line', () => {
    expect(ev.organizer).toMatchObject({ name: 'Ana Lopez', email: 'ana@example.com' });
    const byEmail = Object.fromEntries(ev.attendees.map((a) => [a.email.toLowerCase(), a]));
    expect(Object.keys(byEmail).sort()).toEqual(['ana@example.com', 'jordan@example.net', 'me@example.com']);
    expect(byEmail['me@example.com'].status).toBe('NEEDS-ACTION');
    expect(byEmail['jordan@example.net'].name).toBe('Pike, Jordan');
  });

  it('reads all-day events with VALUE=DATE', () => {
    const d = parseIcs(ALL_DAY)!;
    expect(d.allDay).toBe(true);
    expect(d.title).toBe('Team offsite');
    const s = new Date(d.start);
    expect([s.getFullYear(), s.getMonth() + 1, s.getDate()]).toEqual([2026, 10, 24]);
  });

  it('returns null without a VEVENT', () => {
    expect(parseIcs('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')).toBeNull();
    expect(parseIcs('not a calendar')).toBeNull();
  });
});

describe('buildIcsReply (iTIP REPLY, RFC 5546 3.2.3)', () => {
  const ev = parseIcs(INVITE)!;
  const me = { name: 'Luke Example', email: 'me@example.com' };
  const now = Date.UTC(2026, 9, 13, 16, 5, 0);
  const reply = buildIcsReply(ev, me, 'ACCEPTED', now);
  const unfolded = reply.replace(/\r\n[ \t]/g, '');
  const lines = unfolded.split('\r\n').filter(Boolean);

  it('uses CRLF line endings and folds at 75 octets', () => {
    expect(reply.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of reply.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it('is a REPLY for the same UID and SEQUENCE', () => {
    expect(lines).toContain('METHOD:REPLY');
    expect(lines).toContain('UID:7kukuqrfedlm2f9t0vkqj0b8d1@google.com');
    expect(lines).toContain('SEQUENCE:2');
    expect(lines.filter((l) => l === 'BEGIN:VEVENT')).toHaveLength(1);
  });

  it('carries exactly one ATTENDEE: you, with your answer', () => {
    const attendees = lines.filter((l) => /^ATTENDEE[;:]/i.test(l));
    expect(attendees).toHaveLength(1);
    expect(attendees[0]).toMatch(/PARTSTAT=ACCEPTED/);
    expect(attendees[0].toLowerCase()).toMatch(/:mailto:me@example\.com$/);
  });

  it('keeps the organizer and stamps the reply in UTC', () => {
    expect(lines.some((l) => /^ORGANIZER[;:].*mailto:ana@example\.com$/i.test(l))).toBe(true);
    expect(lines).toContain('DTSTAMP:20261013T160500Z');
  });

  it.each(['TENTATIVE', 'DECLINED'] as const)('writes PARTSTAT=%s', (answer) => {
    expect(buildIcsReply(ev, me, answer, now).replace(/\r\n[ \t]/g, '')).toMatch(new RegExp(`PARTSTAT=${answer}`));
  });
});

describe('googleCalendarUrl', () => {
  it('builds a TEMPLATE link with UTC times, title and location', () => {
    const url = new URL(googleCalendarUrl(parseIcs(INVITE)!));
    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Q4 planning');
    expect(url.searchParams.get('dates')).toBe('20261020T180000Z/20261020T190000Z');
    expect(url.searchParams.get('location')).toBe('Room 4, Floor 2');
  });

  it('uses date-only dates with an exclusive end for all-day events', () => {
    const url = new URL(googleCalendarUrl(parseIcs(ALL_DAY)!));
    expect(url.searchParams.get('dates')).toBe('20261024/20261025');
  });
});

describe('detectLanguage ("Translate message")', () => {
  it.each([
    'Hi Ana, thanks for sending the slides over. Can we move our call to Thursday afternoon? I have a conflict.',
    'We had a real déjà vu moment at the café, but the croissants were great. See you Monday.',
  ])('offers nothing for English: %j', (text) => {
    expect(detectLanguage(text)).toBeNull();
  });

  it('tells Spanish, French and German apart', () => {
    const es = detectLanguage('Hola Ana, gracias por enviarme las diapositivas. ¿Podemos cambiar nuestra llamada al jueves por la tarde? Tengo un conflicto con otra reunión.');
    const fr = detectLanguage('Bonjour Ana, merci pour les diapositives. Est-ce que nous pouvons déplacer notre appel à jeudi après-midi ? J\'ai un autre rendez-vous.');
    const de = detectLanguage('Hallo Ana, danke für die Folien. Können wir unser Gespräch auf Donnerstagnachmittag verschieben? Ich habe leider einen anderen Termin.');
    expect(es).not.toBeNull();
    expect(fr).not.toBeNull();
    expect(de).not.toBeNull();
    expect(new Set([es, fr, de]).size).toBe(3);
  });

  it('detects Japanese', () => {
    expect(detectLanguage('お世話になっております。来週の打ち合わせの件でご連絡いたしました。ご確認のほどよろしくお願いいたします。')).not.toBeNull();
  });
});

describe('etaPassed', () => {
  const now = new Date(2026, 9, 13, 12).getTime(); // Tue Oct 13 2026, noon

  it.each([
    ['Tuesday, October 6', true],
    ['October 12', true],
    ['Today', false],
    ['October 13', false],
    ['Thursday, October 15', false],
    ['by 8 PM', false],
    ['between 2 PM and 6 PM', false],
  ])('%j', (eta, passed) => {
    expect(etaPassed(eta, now)).toBe(passed);
  });

  it('is false with no estimate', () => {
    expect(etaPassed(undefined, now)).toBe(false);
  });

  it('reads a late-December estimate in early January as last year', () => {
    expect(etaPassed('Tuesday, December 29', new Date(2027, 0, 3, 12).getTime())).toBe(true);
  });

  it('reads an early-January estimate in late December as next year', () => {
    expect(etaPassed('Monday, January 4', new Date(2026, 11, 30, 12).getTime())).toBe(false);
  });
});

describe('freshness: what drops off At a glance', () => {
  // Wednesday, October 14 2026, 9 AM: a weekday morning.
  const now = new Date(2026, 9, 14, 9).getTime();
  const at = (month: number, day: number, hour = 10) => new Date(2026, month, day, hour).getTime();
  const MIN = 60_000;

  describe('packages', () => {
    it.each([
      ['a delivery from September 8, still saying shipped', { status: 'shipped', updatedAt: at(8, 8), eta: 'Thursday, September 10' }],
      ['an order delivered September 8', { status: 'delivered', updatedAt: at(8, 8) }],
      ['a package delivered yesterday', { status: 'delivered', updatedAt: at(9, 13, 15) }],
      ['an estimate four days gone with no news', { status: 'shipped', updatedAt: at(9, 6), eta: 'Saturday, October 10' }],
      ['a shipment with no estimate and no news for 11 days', { status: 'shipped', updatedAt: at(9, 3) }],
      ['out for delivery two days ago', { status: 'out-for-delivery', updatedAt: at(9, 12, 7) }],
      ['a delivery problem from three weeks back', { status: 'problem', updatedAt: at(8, 23) }],
    ] as const)('drops %s', (_, facts) => {
      expect(packageRelevance(facts, now)).toBeNull();
    });

    it('keeps a package delivered this morning, below everything that needs you', () => {
      expect(packageRelevance({ status: 'delivered', updatedAt: at(9, 14, 8) }, now)).toEqual({ rank: RANK.deliveredToday, late: false });
    });

    it('puts out for delivery today near the top', () => {
      expect(packageRelevance({ status: 'out-for-delivery', updatedAt: at(9, 14, 7) }, now)?.rank).toBe(RANK.arriving);
    });

    it('reads a shipped package due today as arriving, and one a day overdue as late', () => {
      expect(packageRelevance({ status: 'shipped', updatedAt: at(9, 11), eta: 'Wednesday, October 14' }, now)?.rank).toBe(RANK.arriving);
      expect(packageRelevance({ status: 'shipped', updatedAt: at(9, 9), eta: 'Tuesday, October 13' }, now)).toEqual({ rank: RANK.late, late: true });
    });

    it('keeps a shipment due later this week', () => {
      expect(packageRelevance({ status: 'shipped', updatedAt: at(9, 12), eta: 'Friday, October 16' }, now)).toEqual({ rank: RANK.inTransit, late: false });
    });
  });

  describe('codes', () => {
    it('drops a code after 20 minutes, or sooner when the email says so', () => {
      expect(codeRelevance({ receivedAt: now - 25 * MIN }, now)).toBeNull();
      expect(codeRelevance({ receivedAt: now - 6 * MIN, text: 'Your code is 482913. It expires in 5 minutes.' }, now)).toBeNull();
    });

    it('keeps a fresh code first', () => {
      expect(codeRelevance({ receivedAt: now - 2 * MIN }, now)).toEqual({ rank: RANK.code });
    });
  });

  describe('bills', () => {
    it.each([
      ['a payment confirmation', { receivedAt: now - MIN, text: 'Thanks for your payment of $58.12' }],
      ['an autopay bill from last week', { receivedAt: at(9, 7), text: 'Your bill is ready. Autopay is on.' }],
      ['a bill due two weeks ago', { receivedAt: at(8, 20), text: 'Amount due $58.12', due: 'September 30' }],
      ['a bill from a month ago with no due date', { receivedAt: at(8, 12), text: 'Your bill is ready' }],
    ] as const)('drops %s', (_, facts) => {
      expect(billRelevance(facts, now)).toBeNull();
    });

    it('raises a bill due tomorrow or just past due', () => {
      expect(billRelevance({ receivedAt: at(9, 5), text: 'Payment due Oct 15' }, now)?.rank).toBe(RANK.billUrgent);
      expect(billRelevance({ receivedAt: at(9, 1), text: 'Amount due $40', due: 'October 12' }, now)?.rank).toBe(RANK.billUrgent);
    });

    it('keeps a new bill due later at its due date', () => {
      expect(billRelevance({ receivedAt: at(9, 13), text: 'Your bill is ready', due: 'October 31, 2026' }, now)).toEqual({ rank: RANK.bill, dueDay: new Date(2026, 9, 31).getTime() });
    });
  });

  describe('invites', () => {
    it('drops an invite for an event that already happened', () => {
      expect(inviteRelevance({ receivedAt: at(9, 5), subject: 'Invitation: Design crit @ Monday, October 12, 2pm to 3pm', snippet: '', unread: true }, now)).toBeNull();
    });

    it('drops an invite you have already opened', () => {
      expect(inviteRelevance({ receivedAt: at(9, 13), subject: 'Invitation: Design crit @ Friday, October 16', snippet: '', unread: false }, now)).toBeNull();
    });

    it('raises one for today or tomorrow and keeps one for next week', () => {
      expect(inviteRelevance({ receivedAt: at(9, 13), subject: 'Invitation: Design crit @ Thursday, October 15, 2pm to 3pm', snippet: '', unread: true }, now)?.rank).toBe(RANK.inviteSoon);
      expect(inviteRelevance({ receivedAt: at(9, 13), subject: 'Updated invitation: Readout', snippet: 'Wednesday, October 21, 11:00 am', unread: true }, now)?.rank).toBe(RANK.invite);
    });
  });

  describe('parseDay', () => {
    it.each([
      ['Tuesday, October 6', new Date(2026, 9, 6)],
      ['Oct 20, 2026', new Date(2026, 9, 20)],
      ['10/20/2026', new Date(2026, 9, 20)],
      ['2026-10-20', new Date(2026, 9, 20)],
      ['tomorrow by 8 PM', new Date(2026, 9, 15)],
    ])('%j', (text, day) => {
      expect(parseDay(text, now)).toBe(day.getTime());
    });

    it('finds no date in times, ranges or words that start like a month', () => {
      expect(parseDay('12 PM to 6 PM', now)).toBeNull();
      expect(parseDay('Farmers market 12 stalls', now)).toBeNull();
      expect(parseDay('Someone may need to sign', now)).toBeNull();
    });
  });
});

describe('tracking: one package across emails', () => {
  const now = new Date(2026, 9, 14, 9).getTime();
  const HOUR = 3_600_000;
  const ev = (status: TrackingEvent['status'], hoursAgo: number, threadId: string): TrackingEvent => ({ status, at: now - hoursAgo * HOUR, threadId });
  const rec = (events: TrackingEvent[], extra: Partial<TrackingRecord> = {}): TrackingRecord => ({ key: 'T:SL7702441890236', kind: 'tracking', ref: 'SL 7702 4418 9023 6', events, ...extra });

  describe('latestEvent', () => {
    it('never lets a late retailer "Shipped" undo the carrier\'s "Delivered"', () => {
      expect(latestEvent([ev('delivered', 5, 'carrier'), ev('shipped', 1, 'retailer')])?.status).toBe('delivered');
    });

    it('does not move "Out for delivery" back to "Shipped"', () => {
      expect(latestEvent([ev('out-for-delivery', 3, 'a'), ev('shipped', 2, 'b')])?.status).toBe('out-for-delivery');
    });

    it('takes a problem whenever it comes, and whatever follows it', () => {
      expect(latestEvent([ev('out-for-delivery', 5, 'a'), ev('problem', 3, 'b')])?.status).toBe('problem');
      expect(latestEvent([ev('problem', 5, 'b'), ev('delivered', 1, 'c')])?.status).toBe('delivered');
    });

    it('is undefined with nothing known', () => {
      expect(latestEvent([])).toBeUndefined();
    });
  });

  describe('a status set by hand', () => {
    const manual = (status: TrackingEvent['status'], hoursAgo: number) => ({ status, at: now - hoursAgo * HOUR });

    it('beats every email from before it, even one further along', () => {
      expect(currentEvent(rec([ev('out-for-delivery', 5, 'a')], { manual: manual('delivered', 1) }))).toMatchObject({ status: 'delivered', manual: true });
      expect(currentEvent(rec([ev('delivered', 5, 'a')], { manual: manual('shipped', 1) }))?.status).toBe('shipped');
    });

    it('gives way to a newer email that moves the package on, but not to one that lags behind', () => {
      expect(currentEvent(rec([ev('delivered', 1, 'carrier')], { manual: manual('shipped', 5) }))?.status).toBe('delivered');
      expect(currentEvent(rec([ev('shipped', 1, 'retailer')], { manual: manual('delivered', 5) }))).toMatchObject({ status: 'delivered', manual: true });
    });

    it('goes back to what the emails say when reset', () => {
      const set = setManual(rec([ev('out-for-delivery', 5, 'a')]), 'delivered', now);
      expect(currentEvent(set)?.status).toBe('delivered');
      const reset = setManual(set, null, now);
      expect(reset.manual).toBeUndefined();
      expect(currentEvent(reset)?.status).toBe('out-for-delivery');
    });

    it('stands in the timeline for its own step and hides older claims past it', () => {
      const steps = timeline([ev('shipped', 48, 'a'), ev('delivered', 5, 'b')], manual('out-for-delivery', 1));
      expect(steps.map((e) => [e.status, !!e.manual])).toEqual([
        ['out-for-delivery', true],
        ['shipped', false],
      ]);
    });

    it('gives a package marked delivered at most its one history search, and never searches an email-only package', () => {
      expect(searchDue(rec([ev('shipped', 30, 'a')], { manual: manual('delivered', 1) }), now, true)).toBe(true);
      expect(searchDue(rec([ev('shipped', 30, 'a')], { manual: manual('delivered', 1), checkedAt: now - 1 }), now, true)).toBe(false);
      expect(searchDue(rec([ev('shipped', 30, 'a')], { kind: 'email' }), now)).toBe(false);
    });
  });

  describe('timeline', () => {
    it('lists each step once, current first, at the first email that said it', () => {
      const steps = timeline([ev('shipped', 72, 'retailer'), ev('shipped', 48, 'carrier'), ev('out-for-delivery', 4, 'app'), ev('delivered', 1, 'carrier2'), ev('shipped', 0.5, 'late-retailer')]);
      expect(steps.map((e) => [e.status, e.threadId])).toEqual([
        ['delivered', 'carrier2'],
        ['out-for-delivery', 'app'],
        ['shipped', 'retailer'],
      ]);
    });
  });

  describe('addEvents', () => {
    it('keeps one event per email and status, at the first time it was seen', () => {
      const r = addEvents(rec([ev('shipped', 10, 't1')]), [ev('shipped', 2, 't1'), ev('delivered', 1, 't2')]);
      expect(r.events.map((e) => [e.threadId, e.status, e.at])).toEqual([
        ['t2', 'delivered', now - HOUR],
        ['t1', 'shipped', now - 10 * HOUR],
      ]);
    });

    it('returns the same record when nothing is new, so nothing re-renders', () => {
      const r = rec([ev('shipped', 10, 't1')]);
      expect(addEvents(r, [ev('shipped', 10, 't1')])).toBe(r);
    });
  });

  describe('searchDue', () => {
    it.each([
      ['a delivered package', rec([ev('delivered', 1, 'a')])],
      ['a package nobody has written about in 31 days', rec([ev('shipped', 31 * 24, 'a')])],
      ['out for delivery, searched 10 minutes ago', rec([ev('out-for-delivery', 2, 'a')], { checkedAt: now - 10 * 60_000 })],
      ['in transit, searched an hour ago', rec([ev('shipped', 30, 'a')], { checkedAt: now - HOUR })],
      ['nothing known', rec([])],
    ])('never searches for %s', (_, r) => {
      expect(searchDue(r, now)).toBe(false);
    });

    it('gives a delivered package one search for its history when its card is open, then none', () => {
      expect(searchDue(rec([ev('delivered', 1, 'a')]), now, true)).toBe(true);
      expect(searchDue(rec([ev('delivered', 1, 'a')], { checkedAt: now - 30 * 24 * HOUR }), now, true)).toBe(false);
    });

    it('searches a new package once, and again when its status ages out', () => {
      expect(searchDue(rec([ev('shipped', 30, 'a')]), now)).toBe(true);
      expect(searchDue(rec([ev('shipped', 30, 'a')], { checkedAt: now - 5 * HOUR }), now)).toBe(true);
      expect(searchDue(rec([ev('out-for-delivery', 2, 'a')], { checkedAt: now - 25 * 60_000 }), now)).toBe(true);
    });
  });

  describe('budgetLeft', () => {
    it('stops at the hourly cap shared by tabs and at the per-session cap', () => {
      const recent = Array.from({ length: SEARCH_LIMITS.perHour }, (_, i) => now - i * 60_000);
      expect(budgetLeft(recent, 0, now)).toBe(false);
      expect(budgetLeft([], SEARCH_LIMITS.perSession, now)).toBe(false);
    });

    it('lets searches older than an hour go', () => {
      const old = Array.from({ length: SEARCH_LIMITS.perHour }, () => now - 2 * HOUR);
      expect(budgetLeft(old, 0, now)).toBe(true);
    });
  });

  describe('referenceKey and searchQuery', () => {
    it('files spaced and compact forms of a number together, and ignores short order numbers', () => {
      expect(referenceKey({ tracking: 'SL 7702 4418 9023 6' })).toBe(referenceKey({ tracking: 'sl7702441890236' }));
      expect(referenceKey({ orderNo: '1234' })).toBeUndefined();
      expect(referenceKey({ orderNo: 'LM-4471902' })).toBe('O:LM4471902');
    });

    it('searches the exact number, quoted, as written and without spaces', () => {
      expect(searchQuery(rec([]))).toBe('"SL 7702 4418 9023 6" OR "SL7702441890236"');
    });
  });
});
