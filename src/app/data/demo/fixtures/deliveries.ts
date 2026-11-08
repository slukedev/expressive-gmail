/** One Hollowpine order the retailer, carrier and a tracking app each wrote about, and two old Larkspur Market orders, one never followed by a delivery email. */
import { formatShortDate, formatWeekdayDate } from '../util';
import { UPDATES, type Ctx, type Person, type ThreadSpec } from './model';
import { notice, type Brand } from './templates';

const hollowpine: Person = { name: 'Hollowpine Outfitters', email: 'orders@hollowpine.example' };
const swiftlane: Person = { name: 'Swiftlane', email: 'updates@swiftlane.example' };
const parcelkit: Person = { name: 'Parcelkit', email: 'hello@parcelkit.example' };
const larkspur: Person = { name: 'Larkspur Market', email: 'orders@larkspurmarket.example' };

const BRANDS = {
  hollowpine: { name: 'Hollowpine Outfitters', color: '#2f5d3a', mark: 'H', address: '48 Ridgeline Rd, Bend, OR' },
  swiftlane: { name: 'Swiftlane', color: '#c2410c', mark: 'S', address: '900 Freight Loop, Sacramento, CA' },
  parcelkit: { name: 'Parcelkit', color: '#4338ca', mark: 'P', address: 'Parcelkit app, 3 Harbor St, Seattle, WA' },
  larkspur: { name: 'Larkspur Market', color: '#0e7490', mark: 'L', address: '1200 Commons Ave, Fresno, CA' },
} satisfies Record<string, Brand>;

const TRACKING = 'SL 7702 4418 9023 6';
const TRACK_URL = 'https://swiftlane.example/track/SL7702441890236';

export function deliveryThreads(c: Ctx): ThreadSpec[] {
  const shippedAt = c.d(3, '16:40');
  const deliveredAt = c.m(75);
  const oldShipped = c.d(36, '09:12');
  const oldOrderShipped = c.d(38, '14:05');
  return [
    {
      id: 'u-hollowpine-shipped',
      subject: 'Your Hollowpine Outfitters order has shipped',
      labels: [...UPDATES],
      messages: [
        {
          from: hollowpine,
          at: shippedAt,
          html: notice(BRANDS.hollowpine, {
            heading: 'Your order is on its way',
            body: ['Good news: your Trailhead 2 tent and two camp mugs left our warehouse today.'],
            facts: [
              ['Order number', 'HP-20417'],
              ['Tracking number', TRACKING],
              ['Carrier', 'Swiftlane'],
              ['Estimated delivery', formatWeekdayDate(deliveredAt)],
            ],
            button: { label: 'Track package', href: TRACK_URL },
          }),
        },
      ],
    },
    {
      id: 'u-swiftlane-transit',
      subject: `Your package is on its way: ${TRACKING}`,
      labels: [...UPDATES],
      messages: [
        {
          from: swiftlane,
          at: c.d(2, '06:10'),
          html: notice(BRANDS.swiftlane, {
            heading: 'In transit',
            body: ['Your package from Hollowpine Outfitters reached our Sacramento hub and is on its way to you.'],
            facts: [
              ['Tracking number', TRACKING],
              ['Estimated delivery', formatWeekdayDate(deliveredAt)],
            ],
            button: { label: 'Track package', href: TRACK_URL },
          }),
        },
      ],
    },
    {
      id: 'u-parcelkit-arriving',
      subject: 'Arriving today: your Hollowpine Outfitters package',
      labels: [...UPDATES],
      messages: [
        {
          from: parcelkit,
          at: Math.min(c.d(0, '07:05'), deliveredAt - 60_000),
          html: notice(BRANDS.parcelkit, {
            heading: 'Arriving today',
            body: ['Swiftlane says your Hollowpine Outfitters package is out for delivery.'],
            facts: [
              ['Tracking number', TRACKING],
              ['Carrier', 'Swiftlane'],
            ],
            fine: 'You’re getting this because you track packages in Parcelkit.',
          }),
          headers: { listUnsubscribe: '<https://parcelkit.example/unsubscribe>' },
        },
      ],
    },
    {
      id: 'u-swiftlane-delivered',
      subject: `Delivered: ${TRACKING}`,
      labels: [...UPDATES],
      messages: [
        {
          from: swiftlane,
          at: deliveredAt,
          html: notice(BRANDS.swiftlane, {
            heading: 'Delivered',
            body: ['Your package from Hollowpine Outfitters was delivered and left at the front door.'],
            facts: [['Tracking number', TRACKING]],
            fine: 'Can’t find it? Check around the door, then tell us at swiftlane.example/help.',
          }),
        },
      ],
    },

    // An order from last month that never got a delivery email. It shipped, it came, nobody wrote.
    {
      id: 'u-larkspur-shipped',
      subject: 'Your Larkspur Market order shipped',
      labels: [...UPDATES],
      messages: [
        {
          from: larkspur,
          at: oldShipped,
          html: notice(BRANDS.larkspur, {
            heading: 'Your order shipped',
            body: ['Your 3 items are on the way: a cast iron skillet, oven mitts and a bag of coffee.'],
            facts: [
              ['Order number', 'LM-4471902'],
              ['Estimated delivery', formatWeekdayDate(c.d(33, '12:00'))],
            ],
            button: { label: 'Track your order', href: 'https://larkspurmarket.example/orders/LM-4471902' },
          }),
        },
      ],
    },
    {
      id: 'u-larkspur-old-shipped',
      subject: 'Your Larkspur Market order shipped',
      labels: [...UPDATES],
      messages: [
        {
          from: larkspur,
          at: oldOrderShipped,
          html: notice(BRANDS.larkspur, {
            heading: 'Your order shipped',
            body: ['Your 1 item is on the way: a 12-cup coffee maker.'],
            facts: [
              ['Order number', 'LM-4469310'],
              ['Estimated delivery', formatWeekdayDate(c.d(35, '12:00'))],
            ],
            button: { label: 'Track your order', href: 'https://larkspurmarket.example/orders/LM-4469310' },
          }),
        },
      ],
    },
    {
      id: 'u-larkspur-old-delivered',
      subject: 'Delivered: your Larkspur Market order',
      labels: [...UPDATES],
      messages: [
        {
          from: larkspur,
          at: c.d(35, '13:48'),
          html: notice(BRANDS.larkspur, {
            heading: 'Your order was delivered',
            body: [`Order LM-4469310 was delivered on ${formatShortDate(c.d(35, '13:48'))}. Enjoy your coffee maker.`],
            facts: [['Order number', 'LM-4469310']],
          }),
        },
      ],
    },
  ];
}
