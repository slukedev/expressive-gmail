/** The compact shape fixtures are written in; the backend expands them into full messages. */
import type { LabelId } from '../../types';
import type { IcsEvent, PdfLine, Scene } from '../files';
import { DAY, HOUR, MINUTE, dayAt } from '../util';

export interface Person {
  name: string;
  email: string;
  /** Gets a generated illustrated avatar in contacts. */
  photo?: boolean;
}

export type AttachmentSpec =
  | { kind: 'pdf'; filename: string; lines: PdfLine[]; size?: number }
  | { kind: 'png'; filename: string; scene: Scene; size?: number; contentId?: string }
  | { kind: 'ics'; filename?: string; event: Omit<IcsEvent, 'stamp' | 'uid'> & { uid?: string } }
  | { kind: 'csv'; filename: string; rows: (string | number)[][] }
  | { kind: 'docx'; filename: string; paragraphs: string[]; size?: number };

export interface MessageSpec {
  from: Person;
  /** Defaults to Alex for received mail. */
  to?: Person[];
  cc?: Person[];
  bcc?: Person[];
  replyTo?: Person[];
  at: number;
  /** The author's own words. HTML is derived. */
  text?: string;
  /** Newsletters, receipts. A text version is derived. */
  html?: string;
  /** Defaults to the thread subject, with "Re: " on replies. */
  subject?: string;
  /** Default: true for text replies. */
  quote?: boolean;
  attachments?: AttachmentSpec[];
  headers?: { listUnsubscribe?: string; listUnsubscribePost?: string; listId?: string };
  draft?: boolean;
  scheduled?: boolean;
  unread?: boolean;
  dir?: 'rtl';
  labels?: LabelId[];
}

export interface ThreadSpec {
  id: string;
  subject: string;
  /** For received messages. STARRED, IMPORTANT and user labels also go on Alex's own. */
  labels: LabelId[];
  messages: MessageSpec[];
  /** Newest received messages that are unread (true = all). */
  unread?: number | boolean;
  snoozedUntil?: number;
  muted?: boolean;
}

export interface Ctx {
  now: number;
  rng: () => number;
  /** n minutes ago */
  m(n: number): number;
  /** n hours ago */
  h(n: number): number;
  /** At "HH:MM" local, or a seeded daytime hour. */
  d(daysAgo: number, time?: string): number;
  /** At "HH:MM" local. */
  ahead(days: number, time: string): number;
}

export function createCtx(now: number, rng: () => number): Ctx {
  const parse = (time: string): [number, number] => {
    const [hh, mm] = time.split(':');
    return [Number(hh), Number(mm ?? 0)];
  };
  return {
    now,
    rng,
    m: (n) => now - n * MINUTE,
    h: (n) => now - n * HOUR,
    d: (daysAgo, time) => {
      if (time) {
        const [hh, mm] = parse(time);
        const t = dayAt(now, daysAgo, hh, mm);
        // "Today at 9:41" before 9:41 has happened yet: keep it in the past.
        return t < now ? t : now - (daysAgo + 1) * 7 * MINUTE;
      }
      const hh = 8 + Math.floor(rng() * 12);
      const mm = Math.floor(rng() * 60);
      const t = dayAt(now, daysAgo, hh, mm);
      return t < now ? t : now - 11 * MINUTE;
    },
    ahead: (days, time) => {
      const [hh, mm] = parse(time);
      const t = dayAt(now, -days, hh, mm);
      return t > now ? t : t + DAY;
    },
  };
}

export const PRIMARY: LabelId[] = ['INBOX', 'CATEGORY_PERSONAL'];
export const UPDATES: LabelId[] = ['INBOX', 'CATEGORY_UPDATES'];
export const PROMOS: LabelId[] = ['INBOX', 'CATEGORY_PROMOTIONS'];
export const SOCIAL: LabelId[] = ['INBOX', 'CATEGORY_SOCIAL'];
export const FORUMS: LabelId[] = ['INBOX', 'CATEGORY_FORUMS'];

/** Stable, so tests and the UI can refer to them. */
export const L = {
  work: 'Label_1',
  designReviews: 'Label_2',
  travel: 'Label_3',
  receipts: 'Label_4',
  family: 'Label_5',
  sideProject: 'Label_6',
  taxes: 'Label_7',
} as const;
