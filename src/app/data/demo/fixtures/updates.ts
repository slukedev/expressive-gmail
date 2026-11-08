/** Updates: dev tools, design comments, receipts, shipping, bank mail, security codes and bills. */
import { formatLongDate, formatShortDate, formatWeekdayDate, isoDay, tripName } from '../util';
import { L, UPDATES, type Ctx, type MessageSpec, type Person, type ThreadSpec } from './model';
import { P } from './people';
import { devNote, notice, receipt, receiptTotal, type Brand, type ReceiptOptions } from './templates';

const { alex } = P;

const BRANDS = {
  sketchloop: { name: 'Sketchloop', color: '#6d4aff', mark: 'S', address: '88 Mission Row, Suite 5, San Francisco, CA' },
  parcelpath: { name: 'Parcelpath', color: '#0f766e', mark: 'P', address: '1 Depot Way, Reno, NV' },
  juniper: { name: 'Juniper Savings', color: '#1d4d3a', mark: 'J', address: 'Member FDIC (fictional), 500 Cedar Ave, Portland, OR' },
  oakline: { name: 'Oakline Home', color: '#7a5230', mark: 'O', address: '210 Grain St, Grand Rapids, MI' },
  forkful: { name: 'Forkful', color: '#e8590c', mark: 'F', address: '45 Market Lane, Oakland, CA' },
  hailway: { name: 'Hailway', color: '#111111', mark: 'H', address: '700 Transit Plaza, San Jose, CA' },
  reelhouse: { name: 'Reelhouse', color: '#b3261e', mark: 'R', address: '12 Cinema Ct, Burbank, CA' },
  inkwell: { name: 'Inkwell', color: '#2b3a67', mark: 'I', address: '9 Quarry Rd, Boulder, CO' },
  ledgerly: { name: 'Ledgerly', color: '#0b57d0', mark: 'L', address: '300 Count St, Austin, TX' },
  albatross: { name: 'Albatross Air', color: '#003a70', mark: 'A', address: 'Terminal 2, Albatross Air HQ' },
  lumiar: { name: 'Casa Lumiar', color: '#b5651d', mark: 'CL', address: 'Rua da Escola Politécnica 14, Lisboa' },
  bayline: { name: 'Bayline Energy', color: '#f2b705', ink: '#1f1f1f', mark: 'B', address: 'PO Box 4410, Oakland, CA' },
  library: { name: 'Eastbay Public Library', color: '#5b3f8c', mark: 'E', address: '125 14th St, Oakland, CA' },
} satisfies Record<string, Brand>;

const ch = (name: string): Person => ({ name, email: P.codehub.email });

function codehubThread(
  id: string,
  subject: string,
  repo: string,
  reason: string,
  link: string,
  messages: { who: string; at: number; body: string }[],
  extra: Partial<ThreadSpec> = {},
): ThreadSpec {
  return {
    id,
    subject,
    labels: [...UPDATES, L.work],
    messages: messages.map(
      (m): MessageSpec => ({
        from: ch(m.who),
        to: [{ name: repo, email: `${repo.split('/')[1]}@noreply.codehub.example` }],
        cc: [alex],
        at: m.at,
        html: devNote({ repo, body: m.body, link, reason }),
        headers: { listId: `${repo} <${repo.replace('/', '.')}.codehub.example>`, listUnsubscribe: '<https://codehub.example/notifications/unsubscribe>' },
      }),
    ),
    ...extra,
  };
}

function sketchloopComment(id: string, at: number, who: string, file: string, frame: string, comment: string, unread = false): ThreadSpec {
  const b = BRANDS.sketchloop;
  return {
    id,
    subject: `${who} commented on ${file}`,
    labels: [...UPDATES, L.work, L.designReviews],
    unread,
    messages: [
      {
        from: { name: `${who} (via Sketchloop)`, email: P.sketchloop.email },
        at,
        html: notice(b, {
          heading: `${who} commented on ${frame}`,
          body: [
            `<span style="color:#6b6f76">${file}</span>`,
            `<div style="background:${b.color}14;border-radius:12px;padding:8px 12px;font-size:15px;color:#1f1f1f">${comment}</div>`,
          ],
          button: { label: 'Reply in Sketchloop', href: 'https://sketchloop.example/file/growth?comment=1' },
          fine: 'You’re getting this because you’re a member of this file. <a href="https://sketchloop.example/settings/notifications" style="color:#6b6f76">Notification settings</a>',
        }),
        headers: { listUnsubscribe: '<https://sketchloop.example/u/notify>', listUnsubscribePost: 'List-Unsubscribe=One-Click' },
      },
    ],
  };
}

function receiptThread(
  id: string,
  brand: Brand,
  from: Person,
  subject: string,
  at: number,
  o: ReceiptOptions,
  labels = [...UPDATES, L.receipts],
  extra: Partial<MessageSpec> = {},
): ThreadSpec {
  return { id, subject, labels, messages: [{ from, at, html: receipt(brand, o), ...extra }] };
}

export function updateThreads(c: Ctx): ThreadSpec[] {
  const flightOut = c.ahead(39, '07:25');
  const deliveredAt = c.d(2, '14:37');
  const statementEnd = c.d(8, '00:05');
  const rows: (string | number)[][] = [['Date', 'Description', 'Amount', 'Balance']];
  const tx: [number, string, number][] = [
    [38, 'Payroll deposit, Fernwork Inc', 4210.55],
    [37, 'Pike Property Mgmt, rent', -2345],
    [35, 'Low Tide Coffee subscription', -24],
    [33, 'Forkful order', -38.62],
    [30, 'Bayline Energy', -61.4],
    [27, 'Transfer to Savings', -500],
    [24, 'Payroll deposit, Fernwork Inc', 4210.55],
    [21, 'Oakline Home', -486.03],
    [18, 'Hailway ride', -23.9],
    [14, 'Reelhouse', -15.99],
    [11, 'Eastbay Farmers Market', -42.5],
    [9, 'Stride & Co. Running', -138],
  ];
  let bal = 6120.18;
  for (const [ago, what, amt] of tx) {
    bal += amt;
    rows.push([isoDay(c.d(ago, '12:00')), what, amt.toFixed(2), bal.toFixed(2)]);
  }

  return [
    // Codehub
    codehubThread(
      'u-codehub-review',
      '[fernwork/web-app] Onboarding v4: naming step with name suggestions (PR #2841)',
      'fernwork/web-app',
      'your review was requested',
      'https://codehub.example/fernwork/web-app/pull/2841',
      [
        {
          who: 'Tomás Ferreira',
          at: c.h(2.5),
          body: `<p><b>@tomasf</b> requested your review on this pull request.</p>
<p>Implements the workspace naming step from the v4 spec:</p>
<ul><li>Inline "name taken" state with up to two suggestions</li><li>Suggestions fill the field on tap</li><li>Live region announces "Step 1 of 4, name your workspace"</li></ul>
<p>Screenshots in the PR description. Feature flagged behind <code>onboarding_v4</code>.</p>
<p style="font-family:Menlo,monospace;font-size:12px;color:#59636e">12 files changed, 418 additions, 96 deletions</p>`,
        },
      ],
      { unread: 1 },
    ),
    codehubThread(
      'u-codehub-ci',
      '[fernwork/web-app] Run failed: e2e (chromium) on main',
      'fernwork/web-app',
      'you are subscribed to this workflow',
      'https://codehub.example/fernwork/web-app/actions/runs/88412',
      [
        {
          who: 'Codehub Actions',
          at: c.h(5),
          body: `<p><b>e2e (chromium)</b> failed for commit <code>a3f91c2</code> on <b>main</b>.</p>
<pre style="background:#f6f8fa;border-radius:6px;padding:12px;font-size:12px;overflow:auto">FAIL onboarding.spec.ts › invite step › skip keeps typed emails
  Expected: "I'll do this later"
  Received: "Skip"</pre>
<p>Triggered by a push from @alexr.</p>`,
        },
      ],
    ),
    codehubThread(
      'u-codehub-issue',
      '[fernwork/web-app] Settings search returns stale results after rename (Issue #2790)',
      'fernwork/web-app',
      'you were mentioned',
      'https://codehub.example/fernwork/web-app/issues/2790',
      [
        {
          who: 'Sam Okafor',
          at: c.d(3, '10:20'),
          body: `<p>After renaming a section, settings search still shows the old name until a hard refresh. Steps:</p><ol><li>Rename "Members" to "People" in the admin panel</li><li>Search for "people"</li><li>No results, but "members" still works</li></ol><p>@alexr do we want search to match the old name too for a while? People will remember it.</p>`,
        },
        {
          who: 'Marcus Oyelaran',
          at: c.d(3, '11:02'),
          body: `<p>Root cause is the search index only rebuilding on deploy. I'll make it rebuild on rename.</p>`,
        },
        {
          who: 'Sam Okafor',
          at: c.d(2, '09:48'),
          body: `<p>Closed by #2822. Old names now match for 30 days as aliases, per Alex's suggestion.</p>`,
        },
      ],
    ),
    codehubThread(
      'u-codehub-release',
      '[fernwork/design-tokens] Release v3.2.0',
      'fernwork/design-tokens',
      'you are watching releases',
      'https://codehub.example/fernwork/design-tokens/releases/v3.2.0',
      [
        {
          who: 'Jonas Bäcker',
          at: c.d(6, '16:30'),
          body: `<h3 style="margin:0 0 8px">v3.2.0</h3><ul><li>New <code>surface-container-lowest</code> token for cards on tinted backgrounds</li><li>Dark mode illustration palette</li><li>Fix: <code>focus-ring</code> contrast now 3.1:1 on all surfaces</li></ul>`,
        },
      ],
    ),
    codehubThread(
      'u-codehub-merged',
      '[fernwork/web-app] Billing: show next invoice at the top (PR #2833)',
      'fernwork/web-app',
      'you authored the linked issue',
      'https://codehub.example/fernwork/web-app/pull/2833',
      [{ who: 'Sam Okafor', at: c.d(4, '17:12'), body: `<p>Merged #2833 into main.</p>` }],
      { labels: ['CATEGORY_UPDATES', L.work] },
    ),

    // Sketchloop
    sketchloopComment('u-sk-1', c.h(6.5), 'Priya Natarajan', 'Growth / Onboarding', 'v4 / final, Invite step', 'The new skip link is so much better. Can we try it at 15px instead of 14px?', true),
    sketchloopComment('u-sk-2', c.d(1, '15:40'), 'Jonas Bäcker', 'Brand illustrations', 'Empty states / dark', '@Alex dark versions are in! The plant one needed a lighter pot so it doesn’t disappear on #141218.'),
    sketchloopComment('u-sk-3', c.d(5, '11:25'), 'Sam Okafor', 'Settings IA', 'Sidebar / Billing', 'Is "Invoices" its own section or part of Billing? I can build either, just need to know for routing.'),
    sketchloopComment('u-sk-4', c.d(9, '14:05'), 'Rosa Lindqvist', 'Billing settings v2', 'Seat change dialog', 'Love the price preview. Could it also show the prorated amount for this month?'),

    // Receipts
    receiptThread('u-oakline', BRANDS.oakline, P.oakline, 'Your Oakline Home order #OH-58213 is confirmed', c.d(21, '20:14'), {
      heading: 'Thanks for your order, Alex',
      intro: 'We’re getting your order ready. You’ll get another email with tracking when it ships.',
      orderNo: '#OH-58213',
      date: formatLongDate(c.d(21, '20:14')),
      items: [
        { name: 'Wren lounge chair', detail: 'Oat boucle, walnut legs', price: 389 },
        { name: 'Linen cushion cover', detail: 'Clay, 20 x 20 in', qty: 2, price: 24 },
        { name: 'Stoneware planter', detail: 'Medium, speckled white', price: 18 },
      ],
      shipping: 0,
      tax: 31.03,
      payment: 'Card ending 4421',
      button: { label: 'View order', href: 'https://oaklinehome.example/orders/OH-58213' },
    }),
    receiptThread('u-forkful-1', BRANDS.forkful, P.forkful, 'Your Forkful receipt from Saffron Table', c.d(1, '19:52'), {
      heading: 'Enjoy your meal!',
      intro: 'Your order from <b>Saffron Table</b> was delivered at 7:48 PM.',
      orderNo: 'FK-1180-7729',
      date: formatLongDate(c.d(1, '19:52')),
      items: [
        { name: 'Chana masala', price: 14.5 },
        { name: 'Garlic naan', qty: 2, price: 4 },
        { name: 'Mango lassi', price: 5.5 },
      ],
      shipping: 2.99,
      tax: 2.61,
      tip: 5,
      payment: 'Card ending 4421',
    }),
    receiptThread(
      'u-forkful-2',
      BRANDS.forkful,
      P.forkful,
      'Your Forkful receipt from Little Bánh Mì',
      c.d(9, '12:31'),
      {
        heading: 'Enjoy your meal!',
        intro: 'Your order from <b>Little Bánh Mì</b> was delivered at 12:27 PM.',
        orderNo: 'FK-1166-2093',
        date: formatLongDate(c.d(9, '12:31')),
        items: [
          { name: 'Lemongrass tofu bánh mì', price: 11 },
          { name: 'Iced coffee with condensed milk', price: 5.25 },
        ],
        shipping: 0,
        tax: 1.42,
        tip: 3,
        payment: 'Card ending 4421',
      },
      ['CATEGORY_UPDATES', L.receipts],
    ),
    receiptThread('u-hailway-1', BRANDS.hailway, P.hailway, `Your ${tripName(c.d(7, '23:40'))} trip with Hailway`, c.d(7, '23:40'), {
      heading: `Thanks for riding, Alex`,
      intro: 'Trip from <b>Fernwork, 300 Bryant St</b> to <b>418 Linden St</b>. 22 min, 6.4 mi.',
      orderNo: 'HW-7F2K91',
      date: formatLongDate(c.d(7, '23:40')),
      items: [
        { name: 'Trip fare', price: 19.4 },
        { name: 'Booking fee', price: 2.5 },
      ],
      tip: 2,
      payment: 'Card ending 4421',
    }, ['CATEGORY_UPDATES', L.receipts]),
    receiptThread('u-hailway-2', BRANDS.hailway, P.hailway, `Your ${tripName(c.d(32, '09:05'))} trip with Hailway`, c.d(32, '09:05'), {
      heading: `Thanks for riding, Alex`,
      intro: 'Trip from <b>418 Linden St</b> to <b>Oakland Intl Airport, Terminal 2</b>. 28 min, 11.2 mi.',
      orderNo: 'HW-6C1M05',
      date: formatLongDate(c.d(32, '09:05')),
      items: [
        { name: 'Trip fare', price: 31.8 },
        { name: 'Airport fee', price: 4.5 },
      ],
      tip: 4,
      payment: 'Card ending 4421',
    }, ['CATEGORY_UPDATES', L.receipts, L.travel]),
    receiptThread('u-reelhouse', BRANDS.reelhouse, P.reelhouse, 'Your Reelhouse receipt', c.d(14, '06:00'), {
      heading: 'Payment received',
      intro: 'Thanks for watching with Reelhouse. Your Standard plan renews monthly.',
      orderNo: 'RH-88104471',
      date: formatLongDate(c.d(14, '06:00')),
      items: [{ name: 'Reelhouse Standard', detail: 'Monthly plan', price: 15.99 }],
      payment: 'Card ending 4421',
      button: { label: 'Manage plan', href: 'https://reelhouse.example/account' },
    }),

    // Shipping
    {
      id: 'u-parcel-shipped',
      subject: 'Your Oakline Home order has shipped',
      labels: [...UPDATES],
      messages: [
        {
          from: P.parcelpath,
          at: c.d(6, '08:15'),
          html: notice(BRANDS.parcelpath, {
            heading: 'Your package is on its way',
            body: ['Oakline Home shipped your order. Large items like furniture can take a few extra days.'],
            facts: [
              ['Tracking number', 'PP 4419 2086 7731 US'],
              ['Carrier', 'Parcelpath Freight'],
              ['Estimated delivery', formatWeekdayDate(deliveredAt)],
            ],
            button: { label: 'Track package', href: 'https://parcelpath.example/t/PP441920867731US' },
          }),
        },
      ],
    },
    {
      id: 'u-parcel-out',
      subject: 'Out for delivery: PP 4419 2086 7731 US',
      labels: [...UPDATES],
      messages: [
        {
          from: P.parcelpath,
          at: c.d(2, '07:02'),
          html: notice(BRANDS.parcelpath, {
            heading: 'Arriving today',
            body: ['Your package is out for delivery and should arrive by 6 PM. Someone may need to sign for it.'],
            facts: [
              ['Tracking number', 'PP 4419 2086 7731 US'],
              ['Delivery window', '12 PM to 6 PM'],
            ],
            button: { label: 'Track live', href: 'https://parcelpath.example/t/PP441920867731US' },
          }),
        },
      ],
    },
    {
      id: 'u-parcel-delivered',
      subject: 'Delivered: your package from Oakline Home',
      labels: [...UPDATES],
      unread: true,
      messages: [
        {
          from: P.parcelpath,
          at: deliveredAt,
          html: notice(BRANDS.parcelpath, {
            heading: 'Delivered',
            body: [`Your package was delivered at ${formatShortDate(deliveredAt)}, 2:37 PM and left with the building manager.`],
            facts: [
              ['Tracking number', 'PP 4419 2086 7731 US'],
              ['Signed by', 'G. PIKE'],
            ],
            fine: 'Didn’t get it? Report a problem within 7 days at parcelpath.example/help.',
          }),
        },
      ],
    },

    // Bank
    {
      id: 'u-bank-statement',
      subject: 'Your Everyday Checking statement is ready',
      labels: [...UPDATES, L.receipts],
      messages: [
        {
          from: P.juniper,
          at: c.d(7, '06:30'),
          html: notice(BRANDS.juniper, {
            heading: 'Your statement is ready',
            body: [
              `Your statement for Everyday Checking (ending 0912) for the period ending ${formatLongDate(statementEnd)} is attached and available in online banking.`,
              'We’ve also attached your transactions as a spreadsheet, since you asked for that last year.',
            ],
            facts: [
              ['Ending balance', `$${bal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`],
              ['Account', 'Everyday Checking ending 0912'],
            ],
            fine: 'Juniper Savings will never ask for your password or full card number by email.',
          }),
          attachments: [
            {
              kind: 'pdf',
              filename: `Statement ${isoDay(statementEnd)}.pdf`,
              size: 96_256,
              lines: [
                { text: 'Juniper Savings', size: 18, bold: true },
                { text: 'Everyday Checking, account ending 0912', size: 11 },
                { text: `Statement period ending ${formatLongDate(statementEnd)}`, size: 11 },
                ...rows.slice(1).map((r) => ({ text: `${r[0]}    ${String(r[1]).padEnd(34, ' ')}  ${r[2]}`, size: 10 })),
                { text: `Ending balance: $${bal.toFixed(2)}`, bold: true, gap: 12 },
              ],
            },
            { kind: 'csv', filename: `transactions-${isoDay(statementEnd)}.csv`, rows },
          ],
        },
      ],
    },
    {
      id: 'u-bank-deposit',
      subject: 'Direct deposit received',
      labels: [...UPDATES],
      messages: [
        {
          from: P.juniperAlerts,
          at: c.d(3, '05:12'),
          html: notice(BRANDS.juniper, {
            heading: 'You’ve got money',
            body: ['A direct deposit of <b>$4,210.55</b> from FERNWORK INC PAYROLL posted to Everyday Checking (ending 0912).'],
            fine: 'You’re getting this alert because you turned on deposit notifications. Manage alerts in online banking.',
          }),
        },
      ],
    },
    {
      id: 'u-bank-signin',
      subject: 'New sign-in to Juniper Savings',
      labels: ['CATEGORY_UPDATES'],
      messages: [
        {
          from: P.juniperAlerts,
          at: c.d(19, '21:14'),
          html: notice(BRANDS.juniper, {
            heading: 'New sign-in',
            body: ['We noticed a sign-in to your account from a new device. If this was you, there’s nothing to do.'],
            facts: [
              ['Device', 'Laptop, browser'],
              ['Location', 'Oakland, CA (approximate)'],
              ['Time', `${formatLongDate(c.d(19, '21:14'))}, 9:14 PM`],
            ],
            fine: 'Not you? Call the number on the back of your card. We will never ask for your password by email.',
          }),
        },
      ],
    },

    // Security codes
    {
      id: 'u-inkwell-reset',
      subject: 'Reset your Inkwell password',
      labels: [...UPDATES],
      messages: [
        {
          from: P.inkwell,
          at: c.d(2, '22:41'),
          html: notice(BRANDS.inkwell, {
            heading: 'Reset your password',
            body: ['Someone (hopefully you) asked to reset the password for the Inkwell account alex.rivera@example.com.'],
            button: { label: 'Choose a new password', href: 'https://inkwell.example/reset?t=demo' },
            fine: 'This link expires in 30 minutes. If you didn’t ask for this, you can ignore this email and your password won’t change.',
          }),
        },
      ],
    },
    {
      id: 'u-ledgerly-2fa',
      subject: 'Your Ledgerly verification code: 482 913',
      labels: [...UPDATES],
      unread: true,
      messages: [
        {
          from: P.ledgerly,
          at: c.m(12),
          html: notice(BRANDS.ledgerly, {
            heading: 'Your verification code',
            body: ['Enter this code to finish signing in to Ledgerly.'],
            code: '482913',
            fine: 'The code expires in 10 minutes. Ledgerly staff will never ask you for this code.',
          }),
        },
      ],
    },

    // Bills
    {
      id: 'u-bayline',
      subject: 'Your Bayline Energy bill is ready: $58.12',
      labels: [...UPDATES],
      messages: [
        {
          from: P.cityPower,
          at: c.d(4, '07:00'),
          html: notice(BRANDS.bayline, {
            heading: 'Your bill is ready',
            body: ['You used 182 kWh this month, 9% less than the same month last year. Nice.'],
            facts: [
              ['Amount due', '$58.12'],
              ['Due date', formatLongDate(c.ahead(17, '12:00'))],
              ['Autopay', 'On, Card ending 4421'],
            ],
            button: { label: 'View bill', href: 'https://baylineenergy.example/bill' },
          }),
        },
      ],
    },
    {
      id: 'u-library',
      subject: 'Your hold is ready for pickup',
      labels: [...UPDATES],
      unread: true,
      messages: [
        {
          from: P.library,
          at: c.h(10),
          html: notice(BRANDS.library, {
            heading: '1 item is ready for pickup',
            body: ['<b>The Lighthouse Keeper’s Daughter</b>, hardcover', 'Pick up at Temescal Branch by the date below. Holds shelf is to the left of the front desk.'],
            facts: [['Pick up by', formatWeekdayDate(c.ahead(7, '12:00'))]],
          }),
        },
      ],
    },

    // Travel
    {
      id: 'u-albatross',
      subject: 'Your trip to Lisbon: confirmation K7XQ2M',
      labels: [...UPDATES, L.travel, 'STARRED'],
      messages: [
        {
          from: P.albatross,
          at: c.d(10, '22:10'),
          html: notice(BRANDS.albatross, {
            heading: 'You’re going to Lisbon',
            body: ['Thanks for booking with Albatross Air. Here are your flight details. Check in opens 24 hours before departure.'],
            facts: [
              ['Confirmation', 'K7XQ2M'],
              ['Passenger', 'ALEX RIVERA'],
              ['Outbound', `${formatShortDate(flightOut)}, SFO 7:25 AM to LIS 7:10 AM +1`],
              ['Flight', 'AB 218, Economy, seat 24A'],
              ['Return', `${formatShortDate(flightOut + 4 * 86_400_000)}, LIS 11:40 AM to SFO 3:05 PM`],
              ['Total paid', `$${receiptTotal({ items: [{ name: 'Fare', price: 812.4 }], tax: 96.2 }).toFixed(2)}`],
            ],
            button: { label: 'Manage booking', href: 'https://albatrossair.example/trips/K7XQ2M' },
          }),
        },
      ],
    },
    {
      id: 'u-lumiar',
      subject: 'Reserva confirmada: Casa Lumiar, Lisboa',
      labels: [...UPDATES, L.travel],
      messages: [
        {
          from: P.lumiar,
          at: c.d(9, '10:00'),
          html: notice(BRANDS.lumiar, {
            heading: 'Olá Alex, your room is confirmed',
            body: [
              'We’re happy to welcome you with the Fernwork group. Breakfast is served in the garden from 7:30 to 10:30.',
              'Bem-vindo a Lisboa!',
            ],
            facts: [
              ['Check-in', `${formatWeekdayDate(flightOut + 86_400_000)}, from 3 PM`],
              ['Check-out', `${formatWeekdayDate(flightOut + 4 * 86_400_000)}, by 11 AM`],
              ['Room', '41, Courtyard single'],
              ['Booking', 'CL-20931-FW'],
            ],
          }),
        },
      ],
    },
  ];
}
