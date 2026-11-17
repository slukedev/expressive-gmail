import type { Account } from '../../src/app/data/types';
import { accountKey, qualify } from '../../src/app/data/accounts/ids';
import { parseIcs } from '../../src/app/smart/extract';

vi.mock('../../src/app/ui/Snackbar', () => ({ snack: () => 0 }));
const { attendeeFor } = await import('../../src/app/smart/rsvp');

const WORK = 'alex@riverastudio.example.net';
const HOME = 'alex.rivera@example.com';

const invite = (...attendees: string[]) =>
  parseIcs(
    ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:u1', 'SUMMARY:Crit', 'DTSTART:20261009T180000Z', 'ORGANIZER:mailto:priya@example.com', ...attendees, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
  )!;

const merged: Account = {
  email: HOME,
  name: 'Alex Rivera',
  index: 0,
  members: [
    { key: accountKey(HOME), email: HOME, name: 'Alex Rivera', index: 0 },
    { key: accountKey(WORK), email: WORK, name: 'Alex (Studio)', index: 1, sendAs: [{ email: 'hello@riverastudio.example.net' }] },
  ],
};

describe('answering an invitation', () => {
  it('replies as the invited address of the account that owns the conversation, not the first account', () => {
    const ev = invite('ATTENDEE;CN=Priya:mailto:priya@example.com', 'ATTENDEE;CN=Alex at the studio:mailto:alex@riverastudio.example.net');
    expect(attendeeFor(ev, merged, qualify(accountKey(WORK), 't1'))).toEqual({ email: WORK, name: 'Alex at the studio' });
  });

  it('replies as an invited send-as alias', () => {
    const ev = invite('ATTENDEE:mailto:hello@riverastudio.example.net');
    expect(attendeeFor(ev, merged, qualify(accountKey(WORK), 't1'))).toEqual({ email: 'hello@riverastudio.example.net', name: 'Alex (Studio)' });
  });

  it('falls back to the owning account when the invite lists only a group', () => {
    const ev = invite('ATTENDEE:mailto:design-team@example.com');
    expect(attendeeFor(ev, merged, qualify(accountKey(WORK), 't1'))).toEqual({ email: WORK, name: 'Alex (Studio)' });
  });
});
