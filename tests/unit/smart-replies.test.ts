import { isAutomated, suggestReplies } from '../../src/app/features/thread/SmartReplies';
import type { Message } from '../../src/app/data/types';

const THANKS = ['You’re welcome!', 'Happy to help.', 'Anytime!'];
const REQUEST = ['Sure, I can do that.', 'Let me check and get back to you.', 'Sorry, I can’t this time.'];
const CONFIRM = ['Sounds good!', 'Works for me.', 'Let me think about it.'];
const SCHEDULE = ['Yes, that works.', 'Can we do another time?', 'Let me check my calendar.'];
const GENERIC = ['Yes', 'No', 'Let me check.'];

describe('suggestReplies', () => {
  it.each([
    ['plain thanks', 'Thanks so much for sending the slides.', THANKS],
    ['thank you, any case', 'THANK YOU for covering for me!', THANKS],
    ['appreciation', 'Really appreciate the quick turnaround.', THANKS],
    ['thanks with a question is not just thanks', 'Thanks! Could you also send the notes?', REQUEST],
    ['could you', 'Could you review the PR before Friday?', REQUEST],
    ['availability, even without a question mark', 'Let me know if you are available to help with the move.', REQUEST],
    ['asking for agreement', 'I moved the launch to the 14th, does that work?', CONFIRM],
    ['scheduling question', 'Want to grab coffee next week?', SCHEDULE],
    ['call question', 'What time is best for a quick call?', SCHEDULE],
    ['generic question', 'Is the invoice the final version?', GENERIC],
  ])('%s', (_name, text, expected) => {
    expect(suggestReplies(text)).toEqual(expected);
  });

  it.each([
    ['Here is the draft. Thoughts?'],
    ['I will send it Monday, okay?'],
    ['Moving it to 3pm, ok?'],
  ])('asks for agreement with %j', (text) => {
    expect(suggestReplies(text)).toEqual(CONFIRM);
  });

  it.each([
    ['a statement', 'The build is green and deployed to staging.'],
    ['scheduling words without a question', 'I will call you tomorrow about lunch.'],
    ['a word that only contains "thank"', 'He was thankful for it.'],
    ['empty', ''],
  ])('%s gets no suggestions', (_name, text) => {
    expect(suggestReplies(text)).toEqual([]);
  });
});

describe('isAutomated', () => {
  const msg = (email: string, headers: Message['headers'] = {}) => ({ from: { email }, headers }) as Message;
  it.each(['noreply@example.com', 'no-reply@example.com', 'do-not-reply@example.com', 'notifications@example.com', 'itinerary@albatrossair.example', 'billing@example.com', 'tracking+42@example.com', 'MAILER-DAEMON@example.com'])(
    '%s is automated',
    (email) => expect(isAutomated(msg(email), ['INBOX'])).toBe(true),
  );
  it.each(['priya.natarajan@example.com', 'support.team.lead@example.com', 'noah@example.com'])('%s is a person', (email) =>
    expect(isAutomated(msg(email), ['INBOX'])).toBe(false),
  );
  it('Updates, Promotions and lists count as automated', () => {
    expect(isAutomated(msg('priya@example.com'), ['CATEGORY_UPDATES'])).toBe(true);
    expect(isAutomated(msg('priya@example.com'), ['CATEGORY_PROMOTIONS'])).toBe(true);
    expect(isAutomated(msg('priya@example.com', { listUnsubscribe: '<mailto:u@example.com>' }), ['INBOX'])).toBe(true);
  });
});
