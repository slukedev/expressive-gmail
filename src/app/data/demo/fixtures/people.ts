/** The cast. Everyone is fictional, on reserved example domains or made-up ones. */
import type { Person } from './model';

export const SELF: Person = { name: 'Alex Rivera', email: 'alex.rivera@example.com', photo: true };

const p = (name: string, email: string, photo = false): Person => ({ name, email, photo });

export const P = {
  alex: SELF,

  // Fernwork, where Alex works (company mail runs on example.com)
  priya: p('Priya Natarajan', 'priya.natarajan@example.com', true),
  marcus: p('Marcus Oyelaran', 'marcus.oyelaran@example.com', true),
  hannah: p('Hannah Kowalczyk', 'hannah.k@example.com'),
  tomas: p('Tomás Ferreira', 'tomas.ferreira@example.com', true),
  yuki: p('Yuki Tanabe', 'yuki.tanabe@example.com', true),
  jonas: p('Jonas Bäcker', 'jonas.baecker@example.com'),
  dana: p('Dana Whitfield', 'dana.whitfield@example.com'),
  sam: p('Sam Okafor', 'sam.okafor@example.com', true),
  leila: p('Leila Haddad', 'leila.haddad@example.com'),
  ben: p('Ben Castellano', 'ben.castellano@example.com'),
  rosa: p('Rosa Lindqvist', 'rosa.lindqvist@example.com'),
  fernworkIt: p('Fernwork IT', 'it-help@example.com'),
  fernworkAll: p('Fernwork Everyone', 'everyone@example.com'),
  designTeam: p('Design Team', 'design@example.com'),

  // Friends
  jordan: p('Jordan Lee', 'jordan.lee@example.net', true),
  mira: p('Mira Castillo', 'mira.castillo@example.org', true),
  theo: p('Theo Brandt', 'theo.brandt@example.net'),
  nadia: p('Nadia Rahman', 'nadia.rahman@example.org'),
  kenji: p('森 健二', 'kenji.mori@example.net'),
  omar: p('عمر السيد', 'omar.alsayed@example.net'),
  greta: p('Greta Müller', 'greta.mueller@example.org'),
  chris: p('Chris Adeyemi', 'chris.adeyemi@example.net'),

  // Family
  mom: p('Lucía Rivera', 'lucia.rivera@example.org', true),
  dad: p('Daniel Rivera', 'dan.rivera@example.org'),
  sofia: p('Sofia Rivera', 'sofia.rivera@example.net', true),

  // Life admin
  landlord: p('Gerald Pike', 'gerald@pikeproperties.example'),
  clinic: p('Riverside Family Health', 'appointments@riversidehealth.example'),
  marisol: p('Marisol Ortega', 'marisol@halcyonstudio.example'),
  signpost: p('SignPost', 'noreply@signpost.example'),
  recruiter: p('Imogen Hart', 'imogen.hart@talentloft.example'),
  vet: p('Elm Street Vet', 'frontdesk@elmstreetvet.example'),
  dentist: p('Dr. Ana Sousa', 'office@sousadental.example'),
  plumber: p('Ray Delgado', 'ray@delgadoplumbing.example'),

  // Services
  codehub: p('Codehub', 'notifications@codehub.example'),
  sketchloop: p('Sketchloop', 'comments@sketchloop.example'),
  parcelpath: p('Parcelpath', 'tracking@parcelpath.example'),
  juniper: p('Juniper Savings', 'statements@junipersavings.example'),
  juniperAlerts: p('Juniper Savings', 'alerts@junipersavings.example'),
  oakline: p('Oakline Home', 'orders@oaklinehome.example'),
  forkful: p('Forkful', 'receipts@forkful.example'),
  hailway: p('Hailway', 'receipts@hailway.example'),
  reelhouse: p('Reelhouse', 'billing@reelhouse.example'),
  inkwell: p('Inkwell', 'security@inkwell.example'),
  ledgerly: p('Ledgerly', 'no-reply@ledgerly.example'),
  albatross: p('Albatross Air', 'itinerary@albatrossair.example'),
  lumiar: p('Casa Lumiar', 'reservas@casalumiar.example'),
  cityPower: p('Bayline Energy', 'billing@baylineenergy.example'),
  library: p('Eastbay Public Library', 'notices@eastbaylibrary.example'),
  calendar: p('Calendar', 'calendar-notification@example.com'),
  circlet: p('Circlet', 'notify@circlet.example'),
  workfolk: p('Workfolk', 'updates@workfolk.example'),
  snapwell: p('Snapwell', 'hello@snapwell.example'),
  meetups: p('Gatherly', 'events@gatherly.example'),

  // Newsletters and shops
  margin: p('Margin Notes', 'issue@marginnotes.example'),
  stride: p('Stride & Co. Running', 'hello@strideandco.example'),
  lowtide: p('Low Tide Coffee', 'brew@lowtidecoffee.example'),
  farewise: p('Farewise', 'deals@farewise.example'),
  patchnotes: p('Patch Notes Weekly', 'editor@patchnotes.example'),

  // Lists
  typeList: p('typography-discuss', 'typography-discuss@lists.example.org'),
  bikeList: p('East Bay Bike Commuters', 'commuters@lists.example.org'),
  a11yList: p('a11y-practitioners', 'a11y-practitioners@lists.example.org'),

  // Spam
  spamPrize: p('Rewards Department', 'claims@prize-center.example'),
  spamCrypto: p('Desmond K.', 'desk@quickyield.example'),
  spamDelivery: p('Delivery Notice', 'notice@parcel-redelivery.example'),
} as const;

export function accountPeople(): Person[] {
  return Object.values(P);
}
