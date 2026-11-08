/** Alex's second account: Rivera Studio, a freelance design practice. Clients, invoices, contracts. */
import type { Filter, Label } from '../../types';
import { PRIMARY, PROMOS, UPDATES, type Ctx, type Person, type ThreadSpec } from './model';
import { appScreen } from './images';
import { notice, receipt, type Brand } from './templates';

const p = (name: string, email: string, photo = false): Person => ({ name, email, photo });

export const STUDIO_SELF: Person = { name: 'Alex Rivera', email: 'alex@riverastudio.example.net', photo: true };

const SL = {
  clients: 'Label_1',
  invoices: 'Label_2',
  contracts: 'Label_3',
} as const;

export const STUDIO_LABELS: Label[] = [
  { id: SL.clients, name: 'Clients', type: 'user', color: { background: '#4a86e8', text: '#ffffff' } },
  { id: SL.invoices, name: 'Invoices', type: 'user', color: { background: '#ffad47', text: '#ffffff' } },
  { id: SL.contracts, name: 'Contracts', type: 'user', color: { background: '#a479e2', text: '#ffffff' } },
];

const S = {
  alex: STUDIO_SELF,
  wren: p('Wren Abernathy', 'wren@thimbleandoak.example', true),
  thimble: p('Thimble & Oak', 'hello@thimbleandoak.example'),
  ines: p('Inés Calderón', 'ines@harborbikes.example', true),
  felix: p('Felix Moreau', 'felix.moreau@quaycoffee.example'),
  odile: p('Odile Park', 'odile@parkandpine.example', true),
  billbird: p('Billbird', 'invoices@billbird.example'),
  pixelvault: p('Pixelvault', 'hello@pixelvault.example'),
  typeforge: p('Typeforge', 'receipts@typeforge.example'),
  domainly: p('Domainly', 'renewals@domainly.example'),
  creativeWeekly: p('Studio Notes', 'issue@studionotes.example'),
};

const BILLBIRD: Brand = { name: 'Billbird', color: '#1b8a5a', mark: 'B', address: '210 Ledger St, Portland, OR' };
const TYPEFORGE: Brand = { name: 'Typeforge', color: '#202124', mark: 'T', address: '9 Serif Row, Providence, RI' };
const DOMAINLY: Brand = { name: 'Domainly', color: '#6941c6', mark: 'D', address: '77 Root Zone Ave, Austin, TX' };
const STUDIO_NOTES: Brand = { name: 'Studio Notes', color: '#d9480f', mark: 'S', address: '4 Atelier Ct, Chicago, IL' };

export function studioPeople(): Person[] {
  return Object.values(S);
}

export function studioFilters(): Omit<Filter, 'id'>[] {
  return [{ criteria: { from: S.billbird.email }, action: { addLabelIds: [SL.invoices] } }];
}

export function studioThreads(c: Ctx): ThreadSpec[] {
  const { alex, wren, ines, felix, odile } = S;
  return [
    {
      id: 'st-thimble-brand',
      subject: 'Thimble & Oak: logo round 2',
      labels: [...PRIMARY, 'IMPORTANT', 'STARRED', SL.clients],
      unread: 1,
      messages: [
        {
          from: alex,
          to: [wren],
          at: c.d(3, '21:10'),
          text: `Hi Wren,

Round 2 is attached. I took your note about the first set feeling "too polished for a fabric shop" seriously. These lean on the stitched outline from your shop sign and a looser wordmark.

Option B is my favourite. It holds up at 16px for the website tab and still feels hand made on the tote bags.

Take your time, and tell me what makes you smile and what makes you wince.

Alex`,
          attachments: [{ kind: 'pdf', filename: 'Thimble & Oak, logo round 2.pdf', size: 1_843_200, lines: [{ text: 'Thimble & Oak, identity round 2', size: 18, bold: true }, { text: 'Option A: stitched monogram' }, { text: 'Option B: loose wordmark with thread underline' }, { text: 'Option C: badge for packaging' }] }],
        },
        {
          from: wren,
          to: [alex],
          at: c.h(2),
          text: `Alex! B made me smile out loud in the shop. My sister walked past and said "that's us" without me saying anything, which I think is the whole point.

Two small things:
- could the thread underline be a touch thicker? It disappears on the brown kraft paper
- is there a version without "Oak" for the little sewing labels? They're tiny.

Can we talk Thursday? I'm free after 4.

Wren`,
        },
      ],
    },
    {
      id: 'st-harbor-kickoff',
      subject: 'Harbor Bikes website: kickoff notes and next steps',
      labels: [...PRIMARY, SL.clients],
      unread: true,
      messages: [
        {
          from: ines,
          to: [alex],
          at: c.h(5),
          text: `Hi Alex,

Thanks for the call this morning. Writing down what we agreed so nothing slips:

1. Six pages: home, rentals, repairs, group rides, about, contact
2. Rentals need a real booking form, not just a phone number (Saturdays are chaos)
3. We'll send photos from the spring rides by Friday
4. Launch before the summer season, ideally the first week of June

I've attached the sitemap my nephew sketched. Please ignore his opinions on fonts.

Inés`,
          attachments: [{ kind: 'png', filename: 'harbor-bikes-sitemap.png', scene: appScreen('welcome') }],
        },
      ],
    },
    {
      id: 'st-quay-feedback',
      subject: 'Re: Quay Coffee menu boards',
      labels: [...PRIMARY, SL.clients],
      messages: [
        {
          from: felix,
          to: [alex],
          at: c.d(6, '08:20'),
          text: `Morning Alex,

The boards went up yesterday. Customers keep taking photos of the pastry board, so that's a good sign.

One problem: the oat milk price changed, and the board says $0.75 when it's now $0.90. Is the file something I can edit myself, or do I need to come back to you every time?

Felix`,
        },
        {
          from: alex,
          to: [felix],
          at: c.d(5, '19:02'),
          text: `Glad people like the pastry board!

I'll send you an editable version with the prices on their own layer, plus a one page guide for changing them. No charge, that should have been part of the handoff.

Alex`,
        },
      ],
    },
    {
      id: 'st-parkpine-contract',
      subject: 'Park & Pine: signed contract',
      labels: [...PRIMARY, 'IMPORTANT', SL.contracts, SL.clients],
      unread: true,
      messages: [
        {
          from: odile,
          to: [alex],
          at: c.d(1, '16:40'),
          text: `Hi Alex,

Signed and attached. The deposit should reach you by Wednesday.

Really looking forward to this. The packaging for the pine soap line has been on my list for two years.

Odile`,
          attachments: [{ kind: 'pdf', filename: 'Park & Pine, design services agreement (signed).pdf', size: 312_400, lines: [{ text: 'Design services agreement', size: 16, bold: true }, { text: 'Client: Park & Pine Soap Co.' }, { text: 'Studio: Rivera Studio' }, { text: 'Scope: packaging for 4 SKUs' }, { text: 'Fee: $6,400, 50% deposit' }] }],
        },
      ],
    },
    {
      id: 'st-billbird-paid',
      subject: 'Payment received: Invoice RS-0142 from Quay Coffee',
      labels: [...UPDATES, SL.invoices],
      unread: true,
      messages: [
        {
          from: S.billbird,
          at: c.h(9),
          html: notice(BILLBIRD, {
            heading: 'You got paid',
            body: ['<b>Quay Coffee</b> paid invoice <b>RS-0142</b> in full.'],
            facts: [['Amount', '$1,250.00'], ['Method', 'Bank transfer'], ['Arrives', 'In 2 business days']],
            button: { label: 'View invoice', href: 'https://billbird.example/i/RS-0142' },
          }),
        },
      ],
    },
    {
      id: 'st-billbird-overdue',
      subject: 'Invoice RS-0139 to Harbor Bikes is 5 days overdue',
      labels: [...UPDATES, SL.invoices],
      messages: [
        {
          from: S.billbird,
          at: c.d(2, '07:00'),
          html: notice(BILLBIRD, {
            heading: 'An invoice is overdue',
            body: ['Invoice <b>RS-0139</b> to <b>Harbor Bikes</b> was due 5 days ago. Want us to send a friendly reminder?'],
            facts: [['Amount due', '$800.00'], ['Due', '5 days ago']],
            button: { label: 'Send reminder', href: 'https://billbird.example/i/RS-0139/remind' },
          }),
        },
      ],
    },
    {
      id: 'st-typeforge',
      subject: 'Your Typeforge receipt',
      labels: [...UPDATES],
      messages: [
        {
          from: S.typeforge,
          at: c.d(9, '13:12'),
          html: receipt(TYPEFORGE, {
            heading: 'Thanks for your purchase',
            intro: 'Your font licence is ready to download.',
            orderNo: 'TF-88214',
            date: 'Order placed',
            items: [{ name: 'Marlowe Sans', detail: 'Desktop licence, 2 seats', price: 120 }],
            tax: 9.6,
            payment: 'Visa ending 4417',
            button: { label: 'Download fonts', href: 'https://typeforge.example/library' },
          }),
        },
      ],
    },
    {
      id: 'st-domainly',
      subject: 'riverastudio.example.net renews in 14 days',
      labels: [...UPDATES],
      messages: [
        {
          from: S.domainly,
          at: c.d(4, '10:00'),
          html: notice(DOMAINLY, {
            heading: 'Your domain renews soon',
            body: ['<b>riverastudio.example.net</b> renews automatically in 14 days.'],
            facts: [['Renewal', '$18.00 / year'], ['Card', 'Visa ending 4417']],
            button: { label: 'Manage domain', href: 'https://domainly.example/d/riverastudio' },
          }),
        },
      ],
    },
    {
      id: 'st-studio-notes',
      subject: 'Pricing a logo without underselling yourself',
      labels: [...PROMOS],
      messages: [
        {
          from: S.creativeWeekly,
          at: c.d(1, '06:30'),
          html: notice(STUDIO_NOTES, {
            heading: 'Issue 88: pricing a logo',
            body: ['Three freelancers share their actual rate cards, and why they stopped charging by the hour.'],
            button: { label: 'Read the issue', href: 'https://studionotes.example/88' },
          }),
          headers: { listUnsubscribe: '<https://studionotes.example/unsubscribe?u=rs-1182>', listUnsubscribePost: 'List-Unsubscribe=One-Click' },
        },
      ],
    },
    {
      id: 'st-pixelvault',
      subject: '40% off stock photo credits this week',
      labels: [...PROMOS],
      messages: [
        {
          from: S.pixelvault,
          at: c.d(3, '12:00'),
          html: notice({ name: 'Pixelvault', color: '#0b7285', mark: 'P', address: '12 Aperture Way, Denver, CO' }, {
            heading: 'Credits are 40% off',
            body: ['Stock up for the busy season. Offer ends Sunday.'],
            button: { label: 'Get credits', href: 'https://pixelvault.example/sale' },
          }),
          headers: { listUnsubscribe: '<https://pixelvault.example/unsub?u=rs>', listUnsubscribePost: 'List-Unsubscribe=One-Click' },
        },
      ],
    },
    {
      id: 'st-draft-proposal',
      subject: 'Proposal: Harbor Bikes website',
      labels: ['DRAFT'],
      messages: [
        {
          from: alex,
          to: [ines],
          at: c.h(1),
          draft: true,
          text: `Hi Inés,

Here's the proposal for the new site. Short version: six pages, a booking form for rentals, and a launch in the first week of June.

`,
        },
      ],
    },
  ];
}
