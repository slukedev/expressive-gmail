/** Alex's third account: an older personal address now used for a ceramics hobby, a marketplace shop and their newsletters. */
import type { Label } from '../../types';
import { PRIMARY, PROMOS, SOCIAL, UPDATES, type Ctx, type Person, type ThreadSpec } from './model';
import { notice, receipt, type Brand } from './templates';

const p = (name: string, email: string, photo = false): Person => ({ name, email, photo });

export const MAKES_SELF: Person = { name: 'Alex Rivera', email: 'alexr.makes@example.org', photo: true };

const ML = {
  ceramics: 'Label_1',
  receipts: 'Label_2',
} as const;

/** "Receipts" shares its name with the main account's label, so All inboxes shows one. */
export const MAKES_LABELS: Label[] = [
  { id: ML.ceramics, name: 'Ceramics', type: 'user', color: { background: '#b65775', text: '#ffffff' } },
  { id: ML.receipts, name: 'Receipts', type: 'user', color: { background: '#ffad47', text: '#ffffff' } },
];

const M = {
  alex: MAKES_SELF,
  june: p('June Okonkwo', 'june@claystudio.example', true),
  claystudio: p('Kiln Street Clay Studio', 'classes@claystudio.example'),
  potluck: p('Potluck Market', 'orders@potluckmarket.example'),
  glazehouse: p('Glazehouse', 'shop@glazehouse.example'),
  felt: p('Feltboard', 'digest@feltboard.example'),
  bea: p('Bea Lindgren', 'bea.lindgren@example.org', true),
};

const POTLUCK: Brand = { name: 'Potluck Market', color: '#e8590c', mark: 'P', address: '30 Stall Lane, Oakland, CA' };
const GLAZEHOUSE: Brand = { name: 'Glazehouse', color: '#2b8a3e', mark: 'G', address: '5 Cone Six Rd, Asheville, NC' };
const KILN: Brand = { name: 'Kiln Street Clay Studio', color: '#7c4a2d', mark: 'K', address: '118 Kiln St, Oakland, CA' };
const FELTBOARD: Brand = { name: 'Feltboard', color: '#c2255c', mark: 'F', address: '2 Pinboard Plaza, New York, NY' };

export function makesPeople(): Person[] {
  return Object.values(M);
}

export function makesThreads(c: Ctx): ThreadSpec[] {
  const { alex, june, bea } = M;
  return [
    {
      id: 'mk-kiln-firing',
      subject: 'Your pieces are out of the kiln',
      labels: [...PRIMARY, ML.ceramics],
      unread: true,
      messages: [
        {
          from: june,
          to: [alex],
          at: c.h(3),
          text: `Hi Alex,

Your three bowls came out of Tuesday's glaze firing. The celadon one pooled beautifully at the bottom. The speckled one has a small crawl on the rim, nothing a little sanding won't fix.

They're on the pickup shelf, top row, under your name. Shelf clears out every two weeks.

June`,
        },
      ],
    },
    {
      id: 'mk-class-signup',
      subject: 'Wheel throwing II starts next month',
      labels: [...UPDATES, ML.ceramics],
      messages: [
        {
          from: M.claystudio,
          at: c.d(2, '09:00'),
          html: notice(KILN, {
            heading: 'Wheel throwing II',
            body: ['Eight Thursday evenings: trimming, lids, and pulling handles. Members get first pick of seats until Friday.'],
            facts: [['Starts', 'First Thursday next month'], ['Time', '6:30 to 9:00 PM'], ['Seats left', '4']],
            button: { label: 'Save my seat', href: 'https://claystudio.example/classes/wheel-2' },
          }),
        },
      ],
    },
    {
      id: 'mk-potluck-sold',
      subject: 'You made a sale: Speckled mug, oatmeal glaze',
      labels: [...UPDATES],
      unread: true,
      messages: [
        {
          from: M.potluck,
          at: c.h(6),
          html: notice(POTLUCK, {
            heading: 'Cha-ching. Something sold.',
            body: ['<b>Speckled mug, oatmeal glaze</b> sold to a buyer in Portland, OR. Ship it within 3 days to keep your shop rating.'],
            facts: [['Sale', '$38.00'], ['Fees', '$2.47'], ['Ship by', 'In 3 days']],
            button: { label: 'Print shipping label', href: 'https://potluckmarket.example/orders/PM-30117' },
          }),
        },
      ],
    },
    {
      id: 'mk-buyer-question',
      subject: 'Question about the nesting bowls',
      labels: [...PRIMARY],
      messages: [
        {
          from: bea,
          to: [alex],
          at: c.d(1, '20:44'),
          text: `Hi! Are the nesting bowls in your shop dishwasher safe? I want to give them to my sister but she will absolutely put them in the dishwasher.

Thanks,
Bea`,
        },
        {
          from: alex,
          to: [bea],
          at: c.d(1, '21:30'),
          text: `Hi Bea, yes, they're fired to cone 6 and the glaze is food and dishwasher safe. Hand washing keeps the rim glaze glossy longer, but she won't break anything.

Alex`,
        },
      ],
    },
    {
      id: 'mk-glazehouse-order',
      subject: 'Glazehouse order GH-5521 is on its way',
      labels: [...UPDATES, ML.receipts],
      messages: [
        {
          from: M.glazehouse,
          at: c.d(4, '15:20'),
          html: receipt(GLAZEHOUSE, {
            heading: 'Your order shipped',
            intro: 'Your glazes left our warehouse this afternoon.',
            orderNo: 'GH-5521',
            date: 'Shipped',
            items: [
              { name: 'Celadon dipping glaze', detail: '1 pint', price: 21 },
              { name: 'Oatmeal speckle', detail: '1 pint', price: 19.5 },
            ],
            shipping: 8,
            tax: 3.24,
            payment: 'Mastercard ending 0932',
            button: { label: 'Track package', href: 'https://glazehouse.example/track/GH-5521' },
          }),
        },
      ],
    },
    {
      id: 'mk-feltboard',
      subject: 'Pins you might like: speckled glazes',
      labels: [...SOCIAL],
      messages: [
        {
          from: M.felt,
          at: c.d(2, '18:00'),
          html: notice(FELTBOARD, {
            heading: 'Speckled glazes',
            body: ['32 new pins on boards you follow, including <b>Studio pottery</b> and <b>Kitchen shelves</b>.'],
            button: { label: 'See pins', href: 'https://feltboard.example/digest' },
          }),
          headers: { listUnsubscribe: '<https://feltboard.example/unsub?u=mk>', listUnsubscribePost: 'List-Unsubscribe=One-Click' },
        },
      ],
    },
    {
      id: 'mk-potluck-promo',
      subject: 'Spring fair: list your shop for free',
      labels: [...PROMOS],
      messages: [
        {
          from: M.potluck,
          at: c.d(5, '11:00'),
          html: notice(POTLUCK, {
            heading: 'The spring fair is back',
            body: ['Feature up to five items on the fair page at no cost. Applications close in two weeks.'],
            button: { label: 'Apply', href: 'https://potluckmarket.example/fair' },
          }),
          headers: { listUnsubscribe: '<https://potluckmarket.example/unsub?u=mk>', listUnsubscribePost: 'List-Unsubscribe=One-Click' },
        },
      ],
    },
  ];
}
