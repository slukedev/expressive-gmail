import type { Filter } from '../../types';
import { deliveryThreads } from './deliveries';
import { L, PRIMARY, type Ctx, type Person, type ThreadSpec } from './model';
import { miscThreads } from './misc';
import { promoThreads } from './newsletters';
import { P } from './people';
import { personalThreads } from './personal';
import { socialThreads } from './social';
import { updateThreads } from './updates';
import { workThreads } from './work';

export interface Mailbox {
  threads: ThreadSpec[];
  people: Person[];
  filters: Omit<Filter, 'id'>[];
}

export function loadMailbox(c: Ctx): Mailbox {
  const threads = [
    ...workThreads(c),
    ...personalThreads(c),
    ...updateThreads(c),
    ...deliveryThreads(c),
    ...promoThreads(c),
    ...socialThreads(c),
    ...miscThreads(c),
  ];
  return {
    threads,
    people: Object.values(P),
    filters: [
      {
        criteria: { from: `${P.forkful.email} OR ${P.hailway.email}` },
        action: { addLabelIds: [L.receipts], removeLabelIds: ['INBOX'] },
      },
      {
        criteria: { from: P.codehub.email },
        action: { addLabelIds: [L.work] },
      },
    ],
  };
}

const DEMO_SENDER: Person = { name: 'Demo Mailbox', email: 'welcome@demo.example' };

/** The only mail in a brand new account (`empty: true`). */
export function welcomeThread(c: Ctx): ThreadSpec {
  return {
    id: 't-welcome',
    subject: 'Welcome to your new inbox',
    labels: [...PRIMARY],
    unread: true,
    messages: [
      {
        from: DEMO_SENDER,
        to: [P.alex],
        at: c.m(2),
        text: `Hi Alex,

This is a brand new demo account, so it's a little quiet in here. A few things to try:

- Write a message to yourself and watch it land in your inbox
- Create a label and give it a color
- Snooze this message until later and see it come back

Everything in this mailbox is fictional and lives only in memory. Nothing is sent anywhere.

Have fun,
The demo mailbox`,
      },
    ],
  };
}
