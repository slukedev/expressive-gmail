/** Everything that isn't a fresh inbox thread: spam, trash, sent, drafts, snoozed, scheduled and archived mail. */
import { formatLongDate, formatWeekdayDate, tripName } from '../util';
import { landscape } from './images';
import { L, PRIMARY, UPDATES, type Ctx, type Person, type ThreadSpec } from './model';
import { P } from './people';
import { notice, receipt, type Brand } from './templates';

const { alex, priya, hannah, yuki, dana, sam, jordan, theo, mira, nadia, chris, mom, dad, sofia, tomas } = P;
const accountant: Person = { name: 'Beatrice Okonkwo, CPA', email: 'beatrice@okonkwotax.example' };
const neighbor: Person = { name: 'Walt Kim', email: 'walt.kim@example.net' };

const JUNIPER: Brand = { name: 'Juniper Savings', color: '#1d4d3a', mark: 'J', address: 'Member FDIC (fictional), 500 Cedar Ave, Portland, OR' };
const PARCEL: Brand = { name: 'Parcelpath', color: '#0f766e', mark: 'P', address: '1 Depot Way, Reno, NV' };
const FORKFUL: Brand = { name: 'Forkful', color: '#e8590c', mark: 'F', address: '45 Market Lane, Oakland, CA' };
const TICKETS: Brand = { name: 'Boxline Tickets', color: '#222222', mark: 'B', address: '9 Marquee St, Oakland, CA' };

export function miscThreads(c: Ctx): ThreadSpec[] {
  const year = new Date(c.now).getFullYear();
  const toMonday = (8 - new Date(c.now).getDay()) % 7 || 7;
  const readout = c.ahead(toMonday, '11:00');
  return [
    // Spam
    {
      id: 'x-spam-prize',
      subject: 'Congratulations Alex!! Your $1,000 reward is waiting',
      labels: ['SPAM'],
      unread: true,
      messages: [
        {
          from: P.spamPrize,
          at: c.h(14),
          html: `<div style="font-family:Arial;font-size:16px;text-align:center"><h1 style="color:#d00">CONGRATULATIONS!!!</h1><p>You have been SELECTED as this week's lucky winner of a <b>$1,000 shopping reward</b>.</p><p>To claim, simply confirm your shipping details within 24 HOURS.</p><p><a href="https://prize-center.example/claim?id=88231" style="background:#d00;color:#fff;padding:14px 30px;text-decoration:none;font-weight:bold">CLAIM NOW</a></p><p style="font-size:10px;color:#999">This is not spam. You received this because you are awesome.</p></div>`,
        },
      ],
    },
    {
      id: 'x-spam-crypto',
      subject: 'Re: our conversation about guaranteed 18% monthly returns',
      labels: ['SPAM'],
      messages: [
        {
          from: P.spamCrypto,
          at: c.d(2, '03:12'),
          text: `Dear friend,

Following up on our conversation. As discussed, my desk has 4 places left in the yield program with guaranteed 18% monthly returns. Minimum deposit is small.

Reply with your phone number and I will call you personally.

Regards,
Desmond K.
Senior Wealth Desk`,
        },
      ],
    },
    {
      id: 'x-spam-delivery',
      subject: 'Action required: your parcel is on hold (fee unpaid)',
      labels: ['SPAM'],
      unread: true,
      messages: [
        {
          from: P.spamDelivery,
          at: c.d(1, '04:40'),
          html: `<div style="font-family:Arial;font-size:14px"><p>Dear customer,</p><p>Your parcel could not be delivered because a redelivery fee of $1.99 is unpaid. Pay within 48 hours or the parcel will be returned to sender.</p><p><a href="https://parcel-redelivery.example/pay">Pay redelivery fee</a></p><p>Delivery Service</p></div>`,
        },
      ],
    },

    // Trash
    {
      id: 'x-trash-survey',
      subject: 'How was your order from Little Bánh Mì?',
      labels: ['TRASH', 'CATEGORY_UPDATES', 'INBOX'],
      messages: [
        {
          from: P.forkful,
          at: c.d(8, '13:30'),
          html: notice(FORKFUL, { heading: 'Rate your order', body: ['Tap a star to tell us how it went. It takes 5 seconds, we promise.'], button: { label: '★★★★★', href: 'https://forkful.example/rate' } }),
        },
      ],
    },
    {
      id: 'x-trash-cancelled',
      subject: 'Cancelled: Coffee chat with Imogen',
      labels: ['TRASH', 'CATEGORY_PERSONAL'],
      messages: [
        {
          from: P.calendar,
          at: c.d(10, '18:00'),
          text: `This event has been cancelled.

Coffee chat with Imogen
Imogen Hart cancelled this event.`,
        },
      ],
    },
    {
      id: 'x-trash-parking',
      subject: 'parking spot this weekend?',
      labels: ['TRASH', ...PRIMARY],
      messages: [
        {
          from: neighbor,
          to: [alex],
          at: c.d(13, '17:10'),
          text: `Hey Alex, it's Walt from 2A. My sister's visiting this weekend, any chance she could use your parking spot Saturday night? Totally fine if not.`,
        },
        {
          from: alex,
          to: [neighbor],
          at: c.d(13, '19:00'),
          text: `Of course! It's spot 7. I'm not using the car this weekend.`,
        },
      ],
    },
    {
      id: 'x-trash-promo',
      subject: 'Last chance: free socks with any shoe',
      labels: ['TRASH', 'CATEGORY_PROMOTIONS'],
      messages: [
        {
          from: P.stride,
          at: c.d(18, '10:00'),
          html: `<div style="font-family:Helvetica,Arial,sans-serif;padding:24px;background:#111;color:#fff;text-align:center"><div style="font-size:28px;font-weight:900">FREE SOCKS.</div><p>With any pair of shoes, through Sunday.</p></div>`,
          headers: {
            listUnsubscribe: '<https://strideandco.example/unsubscribe?u=ar-7731>',
            listUnsubscribePost: 'List-Unsubscribe=One-Click',
          },
        },
      ],
    },

    // Sent only
    {
      id: 'x-sent-jordan-bday',
      subject: 'happy birthday!!',
      labels: [],
      messages: [
        {
          from: alex,
          to: [jordan],
          at: c.d(25, '08:05'),
          text: `HAPPY BIRTHDAY JORDAN 🎂

thirty-something looks great on you. dinner's on me next week, you pick the place (not the ramen place, you always pick the ramen place)`,
        },
      ],
    },
    {
      id: 'x-sent-pricing-notes',
      subject: 'Notes from today’s pricing interviews',
      labels: [L.work],
      messages: [
        {
          from: alex,
          to: [hannah, yuki],
          at: c.d(2, '17:45'),
          text: `Hi both,

Quick notes from the four interviews today while they're fresh:

- Three of four compared us to "the spreadsheet we already have", not to competitors. Our real competitor is free.
- Nobody understood the difference between Team and Business until we explained it out loud.
- Annual billing was a non-issue. Seat minimums were a big issue.

I'll fold these into the readout. Yuki, can you double check my read on the third interview? I think I heard what I wanted to hear.

Alex`,
        },
      ],
    },
    {
      id: 'x-sent-mira-view',
      subject: 'the view from our walk, minus you',
      labels: [],
      messages: [
        {
          from: alex,
          to: [mira],
          at: c.d(1, '18:30'),
          text: `Walked the lake loop today and stopped at our bench. Took this for you. The ducks send their regards, they're as rude as ever.`,
          attachments: [{ kind: 'png', filename: 'lake-loop.png', scene: landscape('coast'), size: 3_145_728 }],
        },
      ],
    },
    {
      id: 'x-sent-dad-quotes',
      subject: 'Car insurance quotes to compare',
      labels: [L.family],
      messages: [
        {
          from: alex,
          to: [dad],
          cc: [mom],
          at: c.d(13, '20:00'),
          text: `Hi Dad,

I got three quotes with the same coverage you have now:

Harborline (current): $1,284/year
Bluefield Mutual: $1,012/year
Pinecrest Auto: $1,090/year, but includes roadside assistance

Bluefield looks like the best deal. If you want, I can come over Sunday and we'll call them together.

Love,
Alex`,
        },
      ],
    },
    {
      id: 'x-sent-theo-site',
      subject: 'honest feedback on my portfolio site?',
      labels: [L.sideProject],
      messages: [
        {
          from: alex,
          to: [theo],
          at: c.d(17, '21:40'),
          text: `Rebuilt my portfolio over the weekend: alexrivera.example.net

Be brutal. Does the case study page load fast enough on your phone? I'm worried the images are too big.`,
        },
        {
          from: theo,
          to: [alex],
          at: c.d(17, '22:30'),
          text: `it's really good. images are 2-3 MB each though, you could get them under 300 KB without anyone noticing. also the hover effect on the project cards made me happy`,
        },
      ],
    },
    {
      id: 'x-sent-last-weekly',
      subject: 'Weekly design update',
      labels: [L.work],
      messages: [
        {
          from: alex,
          to: [priya],
          at: c.d(7, '08:30'),
          text: `Hi Priya,

This week:
- Onboarding v4: final flow in review, handoff on track for next week
- Settings IA: card sort with 6 support folks done, 4 groups emerged
- Billing: price preview for seat changes is in the file

Next week:
- Finalize v4 and run handoff with Tomás
- Settings IA planning doc (first draft)

Blockers: none, but I'd love 15 minutes on the settings doc structure.

Alex`,
        },
      ],
    },

    // Drafts
    {
      id: 'x-draft-toast',
      subject: 'Toast for Sofia’s graduation',
      labels: [],
      messages: [
        {
          from: alex,
          to: [],
          at: c.d(2, '23:10'),
          draft: true,
          text: `For anyone who doesn't know me, I'm Sofia's older sibling, which means I've known her longer than almost anyone here and have the embarrassing stories to prove it.

When Sofia was seven she built a cardboard house in the living room and refused to let anyone in without an appointment. Mom had to book a time slot to vacuum.

[finish this: something about the pavilion, and how she still builds things people want to walk into]`,
        },
      ],
    },
    {
      id: 'x-draft-peer-review',
      subject: 'Peer feedback for Tomás',
      labels: [L.work],
      messages: [
        {
          from: alex,
          to: [dana],
          at: c.d(1, '16:50'),
          draft: true,
          text: `Hi Dana,

Here's my peer feedback for Tomás for this cycle.

Strengths: He's the engineer I trust most to tell me when a design won't work, and he always comes with an alternative. The live region catch on onboarding is a good example of him caring about details nobody asked him to care about.

Growth:`,
        },
      ],
    },
    {
      id: 'x-draft-no-subject',
      subject: '',
      labels: [],
      messages: [
        {
          from: alex,
          to: [jordan],
          at: c.h(26),
          draft: true,
          text: `did you ever find out the name of that`,
        },
      ],
    },

    // Snoozed
    {
      id: 'x-snoozed-dentist',
      subject: 'Time for your six-month cleaning',
      labels: ['CATEGORY_PERSONAL'],
      snoozedUntil: c.ahead(1, '08:00'),
      messages: [
        {
          from: P.dentist,
          to: [alex],
          at: c.d(3, '10:00'),
          text: `Hi Alex,

It's been six months since your last cleaning. We have openings next week on Tuesday morning and Thursday afternoon. Reply here or call the office to book.

Warmly,
Sousa Family Dental`,
        },
      ],
    },
    {
      id: 'x-snoozed-housewarming',
      subject: 'housewarming playlist??',
      labels: ['CATEGORY_PERSONAL'],
      snoozedUntil: c.ahead(3, '18:00'),
      messages: [
        {
          from: jordan,
          to: [alex],
          at: c.d(1, '21:30'),
          text: `you're in charge of the playlist for saturday. rules: no sad songs before 10pm, at least one song everyone can scream along to, and nothing from your "focus" playlist, it's literally whale noises`,
        },
      ],
    },

    // Scheduled
    {
      id: 'x-scheduled-weekly',
      subject: 'Weekly design update',
      labels: [L.work],
      messages: [
        {
          from: alex,
          to: [priya],
          at: c.ahead(1, '08:30'),
          scheduled: true,
          text: `Hi Priya,

This week:
- Onboarding v4: approved, tickets written, build starts Monday
- Settings IA: sidebar plus search agreed with Sam and Rosa, mocks Friday
- Pricing research: readout moving to Monday so Ben can join

Next week:
- Pair with Tomás on the naming step
- First draft of the settings planning doc

Alex`,
        },
      ],
    },

    // More inbox
    {
      id: 'x-benefits',
      subject: 'Reminder: benefits enrollment closes Friday',
      labels: [...PRIMARY, L.work],
      unread: true,
      messages: [
        {
          from: dana,
          to: [P.fernworkAll],
          at: c.h(18),
          text: `Hi all,

Friendly reminder that open enrollment closes this Friday at 5pm. If you don't make changes, your current plans roll over, except the FSA, which you have to re-elect every year.

New this year: the vision plan now covers one pair of glasses and contacts. Yes, both.

Questions? My door (and DMs) are open.

Dana`,
        },
      ],
    },
    {
      id: 'x-dark-toggle',
      subject: 'dark mode toggle: settings or account menu?',
      labels: [...PRIMARY, L.work],
      messages: [
        {
          from: sam,
          to: [alex],
          at: c.d(2, '15:10'),
          text: `quick one: on mobile, does the theme toggle live in settings or in the account menu? half the team expects settings, the other half keeps asking for the menu`,
        },
        {
          from: alex,
          to: [sam],
          at: c.d(2, '15:34'),
          text: `Settings > Appearance on both, with "Match system" as the default. Most people never touch it, and the ones who do will look in settings first. Our support data backs that up.`,
        },
      ],
    },
    {
      id: 'x-scarf',
      subject: 'you left your scarf here',
      labels: [...PRIMARY],
      messages: [
        {
          from: nadia,
          to: [alex],
          at: c.d(4, '11:20'),
          text: `the green one. it's very nice. I'm wearing it. come get it before I get too attached`,
        },
      ],
    },
    {
      id: 'x-pizza',
      subject: 'that pizza place',
      labels: [...PRIMARY],
      messages: [
        {
          from: chris,
          to: [alex],
          at: c.d(5, '19:45'),
          text: `what was the name of the pizza place with the honey and chili one? I've been thinking about it for two weeks`,
        },
        {
          from: alex,
          to: [chris],
          at: c.d(5, '20:01'),
          text: `Slice of Life on Piedmont! Get the "hot honey" and ask for it well done.`,
        },
      ],
    },
    {
      id: 'x-readout-update',
      subject: 'Updated invitation: Pricing research readout',
      labels: [...PRIMARY, L.work],
      unread: true,
      messages: [
        {
          from: hannah,
          to: [alex, yuki, P.ben],
          at: c.m(35),
          text: `This event has been changed.

Pricing research readout
${formatWeekdayDate(readout)}, 11:00 am to 11:30 am (changed)
Organizer: Hannah Kowalczyk

Going? Yes / No / Maybe`,
          attachments: [
            {
              kind: 'ics',
              filename: 'invite.ics',
              event: {
                title: 'Pricing research readout',
                start: readout,
                end: readout + 30 * 60_000,
                location: 'Harbor room',
                organizer: hannah,
                attendees: [alex, yuki, P.ben],
              },
            },
          ],
        },
      ],
    },
    {
      id: 'x-stride-shipped',
      subject: 'Your Stride & Co. order is on the way',
      labels: [...UPDATES],
      messages: [
        {
          from: P.parcelpath,
          at: c.d(8, '09:00'),
          html: notice(PARCEL, {
            heading: 'Shipped',
            body: ['Stride & Co. Running shipped 1 item: Tempo 4, size 10.'],
            facts: [
              ['Tracking number', 'PP 5530 1172 0048 US'],
              ['Estimated delivery', formatWeekdayDate(c.ahead(2, '12:00'))],
            ],
            button: { label: 'Track package', href: 'https://parcelpath.example/t/PP553011720048US' },
          }),
        },
      ],
    },
    {
      id: 'x-card-used',
      subject: 'Your card ending 4421 was used for $138.00',
      labels: [...UPDATES],
      messages: [
        {
          from: P.juniperAlerts,
          at: c.d(9, '14:12'),
          html: notice(JUNIPER, {
            heading: 'Card purchase',
            body: ['A purchase of <b>$138.00</b> at <b>STRIDE & CO RUNNING</b> was made with your debit card ending 4421.'],
            fine: 'If you don’t recognize this, call the number on the back of your card right away.',
          }),
        },
      ],
    },
    {
      id: 'x-tomas-thanks',
      subject: 'thank you for the handoff doc',
      labels: [...PRIMARY, L.work],
      messages: [
        {
          from: tomas,
          to: [alex],
          at: c.d(3, '18:05'),
          text: `Just wanted to say the v4 handoff doc is the best one I've gotten. Every state, every edge case, and the "why" next to each decision. Made my week.`,
        },
      ],
    },

    {
      id: 'x-sofia-internship',
      subject: 'I GOT IT',
      labels: [...PRIMARY, L.family],
      unread: true,
      messages: [
        {
          from: sofia,
          to: [alex],
          cc: [mom, dad],
          at: c.m(18),
          text: `THE INTERNSHIP. I GOT IT. they said the pavilion was the reason they called me in, so basically this is your fault

starting in january. mom is already crying. dad asked if they pay (they do)`,
        },
      ],
    },
    {
      id: 'x-leila-coffee',
      subject: 'coffee after crit tomorrow? ☕',
      labels: [...PRIMARY, L.work],
      unread: true,
      messages: [
        {
          from: P.leila,
          to: [alex],
          at: c.h(1.5),
          text: `Want to grab coffee after crit tomorrow? I want to pick your brain about the settings copy before I start. Also I owe you one for the error strings session.`,
        },
      ],
    },
    {
      id: 'x-senior-doc',
      subject: 'Senior designer expectations (draft for us to discuss)',
      labels: [...PRIMARY, L.work, 'IMPORTANT'],
      unread: true,
      messages: [
        {
          from: priya,
          to: [alex],
          at: c.h(2.2),
          text: `Hi Alex,

Ahead of our November conversation, here's the draft of the senior expectations doc I mentioned. I've highlighted the three areas where I think you're already there and two where we should focus.

https://docs.example.com/fernwork/design-levels

No need to reply, let's go through it together. Just wanted you to have it early.

Priya`,
        },
      ],
    },
    {
      id: 'x-bookclub-moved',
      subject: 'Book club moved to the 22nd!',
      labels: [...PRIMARY],
      unread: true,
      messages: [
        {
          from: nadia,
          to: [alex, jordan, mira, chris],
          at: c.h(5.5),
          text: `Small change: my landlord is fixing the heater on the 21st, so book club is Saturday the 22nd instead. Same time, same soup.`,
        },
      ],
    },
    {
      id: 'x-hailway-today',
      subject: `Your ${tripName(c.h(1.8))} trip with Hailway`,
      labels: [...UPDATES, L.receipts],
      messages: [
        {
          from: P.hailway,
          at: c.h(1.8),
          html: notice({ name: 'Hailway', color: '#111111', mark: 'H', address: '700 Transit Plaza, San Jose, CA' }, {
            heading: 'Thanks for riding, Alex',
            body: ['Trip from <b>418 Linden St</b> to <b>Fernwork, 300 Bryant St</b>. 19 min, 6.1 mi.'],
            facts: [
              ['Total', '$21.40'],
              ['Paid with', 'Card ending 4421'],
            ],
          }),
        },
      ],
    },

    // Archived
    {
      id: 'x-arch-taxes',
      subject: `Documents for my ${year - 1} return`,
      labels: [L.taxes, 'IMPORTANT'],
      messages: [
        {
          from: alex,
          to: [accountant],
          at: c.d(178, '20:30'),
          text: `Hi Beatrice,

Attached are my documents for this year: the W-2 from Fernwork, the 1099 from the Halcyon freelance work, and my donation receipts. Let me know if anything is missing.

Thanks,
Alex`,
          attachments: [
            { kind: 'pdf', filename: `W-2 Fernwork ${year - 1}.pdf`, size: 152_576, lines: [{ text: `Form W-2 (demo) ${year - 1}`, size: 16, bold: true }, { text: 'Employer: Fernwork Inc' }, { text: 'Employee: Alex Rivera' }] },
            { kind: 'pdf', filename: `1099-NEC Halcyon ${year - 1}.pdf`, size: 98_304, lines: [{ text: `Form 1099-NEC (demo) ${year - 1}`, size: 16, bold: true }, { text: 'Payer: Halcyon Studio' }] },
          ],
        },
        {
          from: accountant,
          to: [alex],
          at: c.d(170, '11:00'),
          text: `Hi Alex,

Good news, your federal and state returns were filed and accepted today. You're getting a refund of $1,148, which should arrive in about three weeks.

A copy of the filed return is in your client portal. Keep it for at least seven years.

Best,
Beatrice`,
        },
      ],
    },
    {
      id: 'x-arch-offer',
      subject: 'Your offer from Fernwork 🎉',
      labels: ['CATEGORY_PERSONAL', L.work, 'STARRED', 'IMPORTANT'],
      messages: [
        {
          from: dana,
          to: [alex],
          at: c.d(712, '16:20'),
          text: `Hi Alex,

On behalf of everyone at Fernwork, I'm thrilled to offer you the role of Product Designer on the Growth team. Your offer letter is attached.

Priya will call you tomorrow to talk through it. We really hope you'll say yes.

Dana Whitfield
People Operations`,
          attachments: [
            {
              kind: 'pdf',
              filename: 'Fernwork offer letter, Alex Rivera.pdf',
              size: 204_800,
              lines: [
                { text: 'Fernwork Inc', size: 18, bold: true },
                { text: 'Offer of employment', size: 14, gap: 8 },
                { text: 'Dear Alex,', gap: 16 },
                { text: 'We are delighted to offer you the position of Product Designer, Growth.' },
                { text: 'Please review the attached terms and sign by the date below.' },
              ],
            },
          ],
        },
        {
          from: alex,
          to: [dana],
          cc: [priya],
          at: c.d(711, '10:15'),
          text: `Hi Dana,

I'm so happy to say yes! Signed letter attached in spirit, actual signature coming through the portal this afternoon.

See you on the 1st.
Alex`,
        },
      ],
    },
    {
      id: 'x-arch-movein',
      subject: 'Welcome to 418 Linden St!',
      labels: ['CATEGORY_PERSONAL', 'STARRED'],
      messages: [
        {
          from: P.landlord,
          to: [alex],
          at: c.d(648, '09:30'),
          text: `Hi Alex,

Welcome! Your keys are at the office. A few things to know:

- Trash and recycling go out Tuesday night
- The laundry room card is in your welcome packet, load it at the machine in the lobby
- Wifi in the lobby is "Linden-Guest"

The move-in checklist is attached. Note anything that's damaged so we don't charge you for it later.

Gerald`,
          attachments: [
            {
              kind: 'pdf',
              filename: 'Move-in checklist, Unit 3B.pdf',
              lines: [
                { text: 'Move-in condition checklist', size: 18, bold: true },
                { text: 'Unit 3B, 418 Linden St', gap: 6 },
                { text: 'Kitchen: ________  Bathroom: ________  Bedroom: ________', gap: 20 },
                { text: 'Notes: ____________________________________________', gap: 12 },
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'x-arch-tokyo',
      subject: 'Your trip to Tokyo: confirmation Q3NR8T',
      labels: ['CATEGORY_UPDATES', L.travel],
      messages: [
        {
          from: P.albatross,
          at: c.d(372, '19:00'),
          text: `Thanks for booking with Albatross Air.

Confirmation: Q3NR8T
Passenger: ALEX RIVERA
Outbound: SFO to HND, AB 77, Economy, seat 31K
Return: HND to SFO, AB 78, Economy, seat 33A

Check in opens 24 hours before departure.`,
        },
      ],
    },
    {
      id: 'x-arch-tokyo-kenji',
      subject: 'Tokyo recommendations (long, sorry)',
      labels: ['CATEGORY_PERSONAL', L.travel],
      messages: [
        {
          from: P.kenji,
          to: [alex],
          at: c.d(366, '22:15'),
          text: `Alex!

You asked for recommendations so here is too many:

Food: the tiny tempura counter in the basement under the station (no sign, look for the blue curtain), any convenience store egg sandwich, and a morning at the fish market area before the crowds.
Walks: Yanaka to Nezu on a Sunday. Stop at every shrine.
Rain plan: the design museum in Roppongi, then a bookstore where you can sit for hours.

Saturday we eat together. I won't take no.

健二`,
        },
      ],
    },
    {
      id: 'x-arch-mom-recipe',
      subject: 'el arroz con pollo de tu abuela',
      labels: ['CATEGORY_PERSONAL', L.family, 'STARRED'],
      messages: [
        {
          from: mom,
          to: [alex],
          at: c.d(121, '17:40'),
          text: `Mijo, here it is, exactly how Abuela makes it. She says the secret is patience, I say the secret is too much garlic.

2 lbs chicken thighs
2 cups rice (not the fancy kind)
1 onion, 1 green pepper, 6 cloves garlic (at least)
1 can tomato sauce, a little saffron or achiote
Chicken stock, a handful of olives, peas at the end

Brown the chicken first. Don't rush it. Then the sofrito, then the rice until it's a little toasted, then the stock. Cover, low heat, 25 minutes. Don't lift the lid. I mean it.

Call me when you make it.
Mamá`,
        },
        {
          from: alex,
          to: [mom],
          at: c.d(119, '20:30'),
          text: `Made it tonight. Lifted the lid once. It was still amazing. Thank you Mamá ❤️`,
        },
      ],
    },
    {
      id: 'x-arch-concert',
      subject: 'Your tickets: Paper Lanterns at Fox Hall',
      labels: ['CATEGORY_UPDATES', L.receipts],
      messages: [
        {
          from: { name: 'Boxline Tickets', email: 'tickets@boxline.example' },
          at: c.d(46, '12:05'),
          html: receipt(TICKETS, {
            heading: 'You’re going!',
            intro: '<b>Paper Lanterns</b> with special guest Marigold Static. Doors at 7 PM.',
            orderNo: 'BX-449120',
            date: formatLongDate(c.d(46, '12:05')),
            items: [{ name: 'General admission', qty: 2, price: 38 }],
            tax: 6.84,
            payment: 'Card ending 4421',
            button: { label: 'View tickets', href: 'https://boxline.example/t/BX-449120' },
          }),
        },
      ],
    },
    {
      id: 'x-arch-forkful-old',
      subject: 'Your Forkful receipt from Green Lantern Noodles',
      labels: ['CATEGORY_UPDATES', L.receipts],
      messages: [
        {
          from: P.forkful,
          at: c.d(63, '20:10'),
          html: receipt(FORKFUL, {
            heading: 'Enjoy your meal!',
            intro: 'Your order from <b>Green Lantern Noodles</b> was delivered at 8:06 PM.',
            orderNo: 'FK-1031-4410',
            date: formatLongDate(c.d(63, '20:10')),
            items: [
              { name: 'Dan dan noodles', price: 13.5 },
              { name: 'Smashed cucumber salad', price: 7 },
            ],
            shipping: 1.99,
            tax: 1.8,
            tip: 4,
            payment: 'Card ending 4421',
          }),
        },
      ],
    },
    {
      id: 'x-arch-pottery',
      subject: 'Pottery class: week 6 is glazing day',
      labels: ['CATEGORY_PERSONAL'],
      messages: [
        {
          from: { name: 'Clay Hollow Studio', email: 'classes@clayhollow.example' },
          to: [alex],
          at: c.d(52, '09:00'),
          text: `Hi Wednesday night class!

This week is glazing. Wear clothes you don't love, and bring the pieces from the bisque shelf with your initials.

We'll fire on Friday, and pieces are ready for pickup the following Wednesday.

See you soon,
Jess`,
        },
        {
          from: alex,
          to: [{ name: 'Clay Hollow Studio', email: 'classes@clayhollow.example' }],
          at: c.d(52, '12:30'),
          text: `Hi Jess, I'll be 15 minutes late this week, work thing. Please save me some of the speckled blue!`,
        },
      ],
    },
    {
      id: 'x-arch-domain',
      subject: 'plantwise.app renews in 30 days',
      labels: ['CATEGORY_UPDATES', L.sideProject],
      messages: [
        {
          from: { name: 'Namewell', email: 'renewals@namewell.example' },
          to: [theo],
          cc: [alex],
          at: c.d(203, '06:00'),
          text: `Your domain plantwise.app renews automatically in 30 days for $14.00/year. No action is needed.`,
        },
        {
          from: theo,
          to: [alex],
          at: c.d(203, '08:15'),
          text: `we're officially a real company now. kind of. $14 worth of real`,
        },
      ],
    },
    {
      id: 'x-arch-newyear',
      subject: 'feliz año nuevo 🎆',
      labels: ['CATEGORY_PERSONAL', L.family],
      messages: [
        {
          from: sofia,
          to: [alex],
          at: c.d(281, '00:12'),
          text: `happy new year from the roof!! mom made everyone eat 12 grapes at midnight and dad choked on grape 9. he's fine. we miss you`,
        },
        {
          from: alex,
          to: [sofia],
          at: c.d(281, '09:40'),
          text: `happy new year sof!! I ate my grapes alone in my kitchen like a tradition-respecting weirdo. give dad a hug for me`,
        },
      ],
    },
    {
      id: 'x-arch-sketchloop-old',
      subject: 'Yuki Tanabe commented on Research repository',
      labels: ['CATEGORY_UPDATES', L.work],
      messages: [
        {
          from: { name: 'Yuki Tanabe (via Sketchloop)', email: P.sketchloop.email },
          at: c.d(40, '13:15'),
          html: notice({ name: 'Sketchloop', color: '#6d4aff', mark: 'S', address: '88 Mission Row, Suite 5, San Francisco, CA' }, {
            heading: 'Yuki Tanabe commented on Tags / taxonomy',
            body: ['<div style="background:#f1edff;border-radius:12px;padding:8px 12px">Can we merge "confusion" and "unclear"? They’re used for the same thing in 90% of clips.</div>'],
            button: { label: 'Reply in Sketchloop', href: 'https://sketchloop.example/file/research' },
          }),
        },
      ],
    },
    {
      id: 'x-arch-yuki-coffee',
      subject: 'coffee next week?',
      labels: ['CATEGORY_PERSONAL', L.work],
      messages: [
        {
          from: yuki,
          to: [alex],
          at: c.d(29, '15:00'),
          text: `Hi Alex, would you like to get coffee next week? I want to hear how you plan your research questions with the PMs. No agenda, just curious.`,
        },
        {
          from: alex,
          to: [yuki],
          at: c.d(29, '15:20'),
          text: `Yes! Tuesday at 3? The place with the good oat milk.`,
        },
        {
          from: yuki,
          to: [alex],
          at: c.d(29, '15:22'),
          text: `Perfect 😊`,
        },
      ],
    },
    {
      id: 'x-arch-theo-name',
      subject: 'names for the plant app (please help)',
      labels: ['CATEGORY_PERSONAL', L.sideProject],
      messages: [
        {
          from: theo,
          to: [alex],
          at: c.d(240, '23:50'),
          text: `ok here's my list. be honest

- Leafy
- Plantwise
- Water Me Maybe
- Sprout Scout
- Fern Gully (my sister says no)`,
        },
        {
          from: alex,
          to: [theo],
          at: c.d(239, '08:10'),
          text: `Plantwise. It says what it does and it sounds calm. Water Me Maybe is very funny and also will get us sued by someone, somehow.`,
        },
      ],
    },
  ];
}
