import type { MailBackend } from '../backend';
import { accountInfo, memoizedOpen, singleAccountDirectory, type AccountDirectory, type DelegatedMailbox } from '../accounts/directory';
import { avatarUrl } from './avatar';
import { createDemoBackend, type DemoBackendOptions } from './backend';
import { PERSONAS, PERSONA_ORDER, type PersonaId } from './fixtures/personas';

export interface DemoDirectoryOptions {
  /** Only the main account is signed in. */
  single?: boolean;
  /** Every call fails, to see partial merged inboxes. */
  failing?: PersonaId;
  /** No mailboxes are delegated to this account. */
  noDelegated?: boolean;
}

/** Mailboxes other people shared with the main account. Opening one loads Gmail itself, so the links are Gmail's shape. */
const DELEGATED: DelegatedMailbox[] = [
  { email: 'jordan.rivera@example.com', name: 'Jordan Rivera', photoUrl: avatarUrl('jordan-rivera-demo'), url: 'https://mail.google.com/mail/u/0/d/AEoRXRTdemoJordan0001/' },
  { email: 'bookings@riverastudio.example.net', name: 'Rivera Studio Bookings', url: 'https://mail.google.com/mail/u/0/d/AEoRXRTdemoBookings02/' },
];

/** `home` is the main one, already connected. */
export function createDemoDirectory(home: MailBackend, backendOptions: DemoBackendOptions, options: DemoDirectoryOptions = {}): AccountDirectory {
  if (backendOptions.empty) return singleAccountDirectory(home);
  const delegated = options.noDelegated ? undefined : async () => DELEGATED;
  if (options.single) return { ...singleAccountDirectory(home), ...(delegated ? { delegated } : {}) };
  const infos = PERSONA_ORDER.map((id) => {
    const p = PERSONAS[id];
    return { id, info: accountInfo({ email: p.self.email, name: p.self.name, photoUrl: avatarUrl(p.photo), index: p.index }, id === 'main') };
  });
  const open = memoizedOpen(home, async (account) => {
    const persona = infos.find((x) => x.info.key === account.key)?.id;
    if (!persona) throw new Error(`${account.email} isn't signed in`);
    return createDemoBackend({
      ...backendOptions,
      persona,
      ...(options.failing === persona ? { failRate: 1 } : {}),
    });
  });
  return {
    list: async () => infos.map((x) => x.info),
    open,
    ...(delegated ? { delegated } : {}),
    async unread(accounts) {
      const out: Record<string, number> = {};
      await Promise.all(
        accounts.map(async (a) => {
          try {
            const labels = await (await open(a)).listLabels();
            out[a.key] = labels.find((l) => l.id === 'INBOX')?.unreadCount ?? 0;
          } catch {
            // The switcher shows no count rather than a wrong one.
          }
        }),
      );
      return out;
    },
  };
}
