import type { MailBackend } from '../backend';
import type { DelegatedMailbox } from '../../../shared/accounts-rpc';
import { accountKey } from './ids';

export interface AccountInfo {
  key: string;
  email: string;
  name?: string;
  photoUrl?: string;
  /** Gmail's /u/N slot. */
  index: number;
  /** The tab's own account; its backend is the one already connected. */
  home?: boolean;
}

export interface AccountDirectory {
  list(): Promise<AccountInfo[]>;
  open(account: AccountInfo): Promise<MailBackend>;
  /** By key, read without opening the accounts. */
  profiles?(accounts: AccountInfo[]): Promise<Record<string, { name?: string; photoUrl?: string }>>;
  unread?(accounts: AccountInfo[]): Promise<Record<string, number>>;
  /** These open in Gmail itself, in a new tab. */
  delegated?(): Promise<DelegatedMailbox[]>;
  addAccountUrl?: string;
  /** Opening another account loads a hidden copy of Gmail, which costs memory. */
  heavy?: boolean;
}

export type { DelegatedMailbox };

export function accountInfo(a: { email: string; name?: string; photoUrl?: string; index: number }, home = false): AccountInfo {
  return {
    key: accountKey(a.email),
    email: a.email,
    index: a.index,
    ...(a.name ? { name: a.name } : {}),
    ...(a.photoUrl ? { photoUrl: a.photoUrl } : {}),
    ...(home ? { home: true } : {}),
  };
}

/** Gmail API mode, a brand new demo account. */
export function singleAccountDirectory(home: MailBackend): AccountDirectory {
  return {
    async list() {
      return [accountInfo(await home.getAccount(), true)];
    },
    async open() {
      return home;
    },
  };
}

export function memoizedOpen(home: MailBackend, open: (a: AccountInfo) => Promise<MailBackend>) {
  const cache = new Map<string, Promise<MailBackend>>();
  return (account: AccountInfo): Promise<MailBackend> => {
    if (account.home) return Promise.resolve(home);
    let p = cache.get(account.key);
    if (!p) {
      p = open(account);
      cache.set(account.key, p);
      p.catch(() => cache.delete(account.key));
    }
    return p;
  };
}
