/** The demo's signed-in accounts, each its own mailbox with its own labels (as Gmail keeps /u/0, /u/1, /u/2 apart), so All inboxes and circles have something to merge. */
import type { Address, Filter, Label } from '../../types';
import { loadMailbox } from './index';
import { USER_LABELS } from './labels';
import { MAKES_LABELS, MAKES_SELF, makesPeople, makesThreads } from './makes';
import type { Ctx, Person, ThreadSpec } from './model';
import { SELF } from './people';
import { STUDIO_LABELS, STUDIO_SELF, studioFilters, studioPeople, studioThreads } from './studio';

export type PersonaId = 'main' | 'studio' | 'makes';

export interface Persona {
  id: PersonaId;
  self: Person;
  /** Gmail's /u/N slot. */
  index: number;
  photo: string;
  sendAs: Address[];
  signature: string;
  labels: Label[];
  /** Only the main account gets a new message every so often. */
  liveMail: boolean;
  mailbox(c: Ctx): { threads: ThreadSpec[]; people: Person[]; filters: Omit<Filter, 'id'>[] };
}

export const PERSONAS: Record<PersonaId, Persona> = {
  main: {
    id: 'main',
    self: SELF,
    index: 0,
    photo: 'alex-rivera-demo',
    sendAs: [
      { name: SELF.name, email: SELF.email },
      { name: 'Alex Rivera', email: 'hello@alexrivera.example.net' },
    ],
    signature: '<div>Alex Rivera</div><div style="color:#5f6368">Product Designer, Fernwork</div>',
    labels: USER_LABELS,
    liveMail: true,
    mailbox: loadMailbox,
  },
  studio: {
    id: 'studio',
    self: STUDIO_SELF,
    index: 1,
    photo: 'alex-rivera-studio',
    sendAs: [{ name: STUDIO_SELF.name, email: STUDIO_SELF.email }],
    signature: '<div>Alex Rivera</div><div style="color:#5f6368">Rivera Studio, identity and web design</div>',
    labels: STUDIO_LABELS,
    liveMail: false,
    mailbox: (c) => ({ threads: studioThreads(c), people: studioPeople(), filters: studioFilters() }),
  },
  makes: {
    id: 'makes',
    self: MAKES_SELF,
    index: 2,
    photo: 'alex-rivera-makes',
    sendAs: [{ name: MAKES_SELF.name, email: MAKES_SELF.email }],
    signature: '',
    labels: MAKES_LABELS,
    liveMail: false,
    mailbox: (c) => ({ threads: makesThreads(c), people: makesPeople(), filters: [] }),
  },
};

export const PERSONA_ORDER: PersonaId[] = ['main', 'studio', 'makes'];
