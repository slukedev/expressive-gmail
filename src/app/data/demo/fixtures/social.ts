/** Social notifications and mailing lists (Forums). */
import { FORUMS, SOCIAL, type Ctx, type Person, type ThreadSpec } from './model';
import { P } from './people';
import { notice, type Brand } from './templates';

const CIRCLET: Brand = { name: 'Circlet', color: '#ff4f79', mark: 'c', address: '1 Loop Rd, Brooklyn, NY' };
const WORKFOLK: Brand = { name: 'Workfolk', color: '#0a66a8', mark: 'W', address: '400 Career Ave, Seattle, WA' };
const SNAPWELL: Brand = { name: 'Snapwell', color: '#ffb000', ink: '#1f1f1f', mark: 'S', address: '18 Shutter Ln, Los Angeles, CA' };

const socialHeaders = (domain: string) => ({
  listUnsubscribe: `<https://${domain}/email/off?u=ar-7731>`,
  listUnsubscribePost: 'List-Unsubscribe=One-Click',
});

function social(id: string, brand: Brand, from: Person, subject: string, at: number, heading: string, body: string[], cta: string, unread = false): ThreadSpec {
  const domain = from.email.split('@')[1]!;
  return {
    id,
    subject,
    labels: [...SOCIAL],
    unread,
    messages: [
      {
        from,
        at,
        html: notice(brand, {
          heading,
          body,
          button: { label: cta, href: `https://${domain}/n/${id}` },
          fine: `<a href="https://${domain}/settings/email" style="color:#6b6f76">Turn off these emails</a>`,
        }),
        headers: socialHeaders(domain),
      },
    ],
  };
}

const listHeaders = (list: Person, id: string) => ({
  listId: `${list.name} <${id}>`,
  listUnsubscribe: `<mailto:${list.email.replace('@', '+unsubscribe@')}>`,
});

export function socialThreads(c: Ctx): ThreadSpec[] {
  const typeL = listHeaders(P.typeList, 'typography-discuss.lists.example.org');
  const bikeL = listHeaders(P.bikeList, 'commuters.lists.example.org');
  const a11yL = listHeaders(P.a11yList, 'a11y-practitioners.lists.example.org');
  return [
    social('s-circlet-follow', CIRCLET, { name: 'Circlet', email: P.circlet.email }, 'Jordan Lee and 2 others started following you', c.h(4), 'You have 3 new followers', ['<b>Jordan Lee</b>, <b>Kenji Mori</b> and <b>plantwise.app</b> started following you.'], 'See who', true),
    social('s-circlet-mention', CIRCLET, { name: 'Mira Castillo on Circlet', email: P.circlet.email }, 'Mira Castillo mentioned you in a post', c.d(1, '20:15'), 'Mira mentioned you', ['“Found a cardamom bun that rivals the one @alexr and I used to fight over. Almost.”'], 'View post'),
    social('s-circlet-memory', CIRCLET, { name: 'Circlet', email: P.circlet.email }, 'Your memories from 3 years ago', c.d(3, '08:00'), '3 years ago today', ['You posted 4 photos from <b>Point Reyes</b>. Want to share them again?'], 'See memories'),
    social('s-circlet-digest', CIRCLET, { name: 'Circlet', email: P.circlet.email }, 'Sofia Rivera, Theo Brandt and others posted recently', c.d(6, '18:00'), 'Catch up with friends', ['<b>Sofia Rivera</b> shared 6 photos from a studio review.', '<b>Theo Brandt</b> posted: “if your plant is dying it’s probably overwatered. it’s always overwatered.”'], 'Open Circlet'),
    social('s-workfolk-view', WORKFOLK, { name: 'Workfolk', email: P.workfolk.email }, 'You appeared in 14 searches this week', c.d(2, '09:30'), 'Your profile is getting noticed', ['You appeared in <b>14 searches</b> this week. People searching for “product designer onboarding” found you.'], 'See searches'),
    social('s-workfolk-congrats', WORKFOLK, { name: 'Workfolk', email: P.workfolk.email }, 'Congratulate Hannah Kowalczyk on 3 years at Fernwork', c.d(7, '10:00'), 'Work anniversary', ['<b>Hannah Kowalczyk</b> is celebrating 3 years as Senior Product Manager at Fernwork.'], 'Say congrats'),
    social('s-snapwell', SNAPWELL, { name: 'Snapwell', email: P.snapwell.email }, 'Jordan Lee added you to a shared album', c.d(20, '22:10'), 'New shared album', ['<b>Jordan Lee</b> added you to <b>Lake weekend</b> (38 photos).'], 'View album'),

    // Forums
    {
      id: 'f-type-variable',
      subject: '[typography-discuss] Variable fonts and optical sizing in UI',
      labels: [...FORUMS],
      unread: 2,
      messages: [
        {
          from: { name: 'Harriet Vance', email: 'harriet.vance@example.org' },
          to: [P.typeList],
          at: c.d(2, '06:40'),
          headers: typeL,
          text: `Hi all,

Is anyone using the optical size axis automatically in product UI? We tried letting the browser pick opsz from the font size and our 12px labels got noticeably wider, which broke a few tight layouts.

Curious how others handled it. Pin opsz per token? Let it float?

Harriet`,
        },
        {
          from: { name: 'Dev Malhotra', email: 'dev.m@example.net' },
          to: [P.typeList],
          at: c.d(2, '09:12'),
          headers: typeL,
          text: `We pin it per token. Auto opsz is lovely for editorial, but in UI we want widths to be predictable more than we want them to be optimal.`,
        },
        {
          from: { name: 'Ines Carvalho', email: 'ines@example.org' },
          to: [P.typeList],
          at: c.d(1, '14:03'),
          headers: typeL,
          text: `Same here. One trick: let it float for body text and pin it for anything that lives in a fixed-width container (buttons, chips, table headers).`,
        },
        {
          from: { name: 'Harriet Vance', email: 'harriet.vance@example.org' },
          to: [P.typeList],
          at: c.h(12),
          headers: typeL,
          text: `That split makes a lot of sense, thank you both. Trying it this week.`,
        },
      ],
    },
    {
      id: 'f-bike-lane',
      subject: '[EBBC] Telegraph Ave bike lane closure next week',
      labels: [...FORUMS],
      messages: [
        {
          from: { name: 'Marta Quiñones', email: 'marta.q@example.net' },
          to: [P.bikeList],
          at: c.d(3, '07:45'),
          headers: bikeL,
          text: `Heads up: the protected lane on Telegraph between 40th and 51st is closed Monday to Thursday next week for repaving. The city's suggested detour is Shattuck, which is not great at rush hour.

Better option: take Webster, it's quiet and has the new speed humps.

Marta`,
        },
        {
          from: { name: 'Hugo Lambert', email: 'hugo.lambert@example.org' },
          to: [P.bikeList],
          at: c.d(3, '12:20'),
          headers: bikeL,
          text: `+1 for Webster. Watch the pothole at 47th, it's practically a swimming pool after rain.`,
        },
      ],
    },
    {
      id: 'f-bike-ride',
      subject: '[EBBC] Sunday social ride: coffee and the waterfront',
      labels: ['CATEGORY_FORUMS'],
      messages: [
        {
          from: { name: 'Marta Quiñones', email: 'marta.q@example.net' },
          to: [P.bikeList],
          at: c.d(16, '19:00'),
          headers: bikeL,
          text: `Easy pace, 12 miles, flat. Meet at the fountain at 9, coffee at the halfway point. New riders very welcome.`,
        },
      ],
    },
    {
      id: 'f-a11y-dialogs',
      subject: '[a11y] Modal dialogs: where should focus go on open?',
      labels: [...FORUMS],
      messages: [
        {
          from: { name: 'Rafael Souza', email: 'rafael.souza@example.org' },
          to: [P.a11yList],
          at: c.d(5, '16:00'),
          headers: a11yL,
          text: `Settling a debate on our team. When a confirmation dialog opens, does focus go to the first button, the dialog title, or the least destructive action?

Our current dialogs focus "Delete", which feels wrong.`,
        },
        {
          from: { name: 'Akosua Mensah', email: 'akosua@example.net' },
          to: [P.a11yList],
          at: c.d(5, '17:30'),
          headers: a11yL,
          text: `For destructive confirmations, focus the least destructive action (usually Cancel). For everything else, focus the first interactive element or the heading if the content needs to be read first.

And yes, focusing Delete is how people delete things by pressing Enter twice.`,
        },
        {
          from: { name: 'Rafael Souza', email: 'rafael.souza@example.org' },
          to: [P.a11yList],
          at: c.d(4, '09:10'),
          headers: a11yL,
          text: `"How people delete things by pressing Enter twice" is going straight into our design review deck. Thanks Akosua.`,
        },
      ],
    },
  ];
}
