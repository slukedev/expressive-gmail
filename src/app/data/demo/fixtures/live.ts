/** Mail that arrives while the preview is open, about every 90 seconds: replies to threads still around, or new threads. */
import { FORUMS, L, PRIMARY, SOCIAL, UPDATES, type MessageSpec, type ThreadSpec } from './model';
import { P } from './people';
import { devNote, notice } from './templates';

export interface LiveItem {
  replyTo?: string;
  message?: (at: number) => MessageSpec;
  /** Used for new threads, and as the fallback when `replyTo` is gone. */
  thread: (at: number) => Omit<ThreadSpec, 'id'>;
}

const { alex } = P;

export const LIVE_ITEMS: LiveItem[] = [
  {
    replyTo: 't-onboarding-v4',
    message: (at) => ({
      from: P.marcus,
      to: [P.priya, alex, P.tomas, P.hannah, P.yuki],
      at,
      text: `Tickets are up, 9 of them, tagged onboarding-v4. Tomás and I are pairing on the name check first thing tomorrow.`,
    }),
    thread: (at) => ({
      subject: 'Onboarding v4 tickets are up',
      labels: [...PRIMARY, L.work],
      messages: [{ from: P.marcus, to: [alex], at, text: `Tickets are up, 9 of them, tagged onboarding-v4.` }],
    }),
  },
  {
    thread: (at) => ({
      subject: 'quick sync tomorrow?',
      labels: [...PRIMARY, L.work],
      messages: [
        {
          from: P.hannah,
          to: [alex],
          at,
          text: `Do you have 15 minutes tomorrow morning? Want to talk about how we present the pricing findings to Ben. Coffee's on me.`,
        },
      ],
    }),
  },
  {
    replyTo: 't-no-subject',
    message: (at) => ({
      from: P.chris,
      to: [alex],
      at,
      text: `also the stairwell is narrow so bring gloves. and patience. mostly patience`,
    }),
    thread: (at) => ({
      subject: '',
      labels: [...PRIMARY],
      messages: [{ from: P.chris, to: [alex], at, text: `you around saturday? couch emergency` }],
    }),
  },
  {
    thread: (at) => ({
      subject: '[fernwork/web-app] Marcus Oyelaran approved PR #2841',
      labels: [...UPDATES, L.work],
      messages: [
        {
          from: { name: 'Marcus Oyelaran', email: P.codehub.email },
          to: [{ name: 'fernwork/web-app', email: 'web-app@noreply.codehub.example' }],
          cc: [alex],
          at,
          html: devNote({
            repo: 'fernwork/web-app',
            body: '<p><b>@marcuso</b> approved these changes.</p><blockquote style="border-left:3px solid #d1d9e0;margin:0;padding-left:10px;color:#59636e">Nice and tidy. One nit on the debounce timing, otherwise ship it.</blockquote>',
            link: 'https://codehub.example/fernwork/web-app/pull/2841',
            reason: 'you are subscribed to this thread',
          }),
          headers: { listId: 'fernwork/web-app <web-app.fernwork.codehub.example>' },
        },
      ],
    }),
  },
  {
    thread: (at) => ({
      subject: 'Theo Brandt and 4 others liked your photo',
      labels: [...SOCIAL],
      messages: [
        {
          from: { name: 'Circlet', email: P.circlet.email },
          at,
          html: notice(
            { name: 'Circlet', color: '#ff4f79', mark: 'c', address: '1 Loop Rd, Brooklyn, NY' },
            { heading: '5 new likes', body: ['<b>Theo Brandt</b>, <b>Mira Castillo</b> and 3 others liked your photo from the lake loop.'] },
          ),
          headers: { listUnsubscribe: '<https://circlet.example/email/off?u=ar-7731>', listUnsubscribePost: 'List-Unsubscribe=One-Click' },
        },
      ],
    }),
  },
  {
    thread: (at) => ({
      subject: 'did you eat?',
      labels: [...PRIMARY, L.family],
      messages: [
        {
          from: P.mom,
          to: [alex],
          at,
          text: `Just checking. Your sister says you work too late. There's leftover arroz con pollo here if you want to come by tomorrow.`,
        },
      ],
    }),
  },
  {
    thread: (at) => ({
      subject: 'Tomás Ferreira commented on Growth / Onboarding',
      labels: [...UPDATES, L.work, L.designReviews],
      messages: [
        {
          from: { name: 'Tomás Ferreira (via Sketchloop)', email: P.sketchloop.email },
          at,
          html: notice(
            { name: 'Sketchloop', color: '#6d4aff', mark: 'S', address: '88 Mission Row, Suite 5, San Francisco, CA' },
            {
              heading: 'Tomás Ferreira commented on v4 / final, Naming step',
              body: ['<div style="background:#f1edff;border-radius:12px;padding:8px 12px">Built the chips, they look great. Should they animate in or just appear?</div>'],
              button: { label: 'Reply in Sketchloop', href: 'https://sketchloop.example/file/growth' },
            },
          ),
          headers: { listUnsubscribe: '<https://sketchloop.example/u/notify>', listUnsubscribePost: 'List-Unsubscribe=One-Click' },
        },
      ],
    }),
  },
  {
    replyTo: 'f-a11y-dialogs',
    message: (at) => ({
      from: { name: 'Lena Park', email: 'lena.park@example.org' },
      to: [P.a11yList],
      at,
      text: `Late to this, but one more: if the dialog has a lot of text, put focus on the dialog itself (tabindex -1) so screen readers start reading from the top.`,
      headers: { listId: 'a11y-practitioners <a11y-practitioners.lists.example.org>' },
    }),
    thread: (at) => ({
      subject: '[a11y] Focus on dialog open',
      labels: [...FORUMS],
      messages: [{ from: { name: 'Lena Park', email: 'lena.park@example.org' }, to: [P.a11yList], at, text: `Put focus on the dialog itself when it has a lot of text.` }],
    }),
  },
  {
    thread: (at) => ({
      subject: 'Your Low Tide box ships tomorrow',
      labels: [...UPDATES],
      messages: [
        {
          from: P.lowtide,
          at,
          html: notice(
            { name: 'Low Tide Coffee', color: '#3b2a1e', mark: 'LT', address: '22 Wharf St, Santa Cruz, CA' },
            { heading: 'Your box ships tomorrow', body: ['This month: <b>Huila Sunrise</b>, 12 oz, whole bean.', 'Want to swap or skip? You have until midnight.'], button: { label: 'Manage subscription', href: 'https://lowtidecoffee.example/box' } },
          ),
        },
      ],
    }),
  },
  {
    replyTo: 't-climbing',
    message: (at) => ({
      from: P.theo,
      to: [P.jordan, alex],
      at,
      text: `update: I bought chalk. I have no idea how to use chalk. see you saturday`,
    }),
    thread: (at) => ({
      subject: 'climbing',
      labels: [...PRIMARY],
      messages: [{ from: P.theo, to: [alex], at, text: `I bought chalk. see you saturday` }],
    }),
  },
];
