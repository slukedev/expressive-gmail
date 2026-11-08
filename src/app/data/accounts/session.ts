import { connectRemoteBackend } from '../../../shared/rpc';
import { accountsClient } from '../../../shared/accounts-rpc';
import { BackendError, type MailBackend } from '../backend';
import { withLocalSnooze } from '../localSnooze';
import { accountInfo, memoizedOpen, type AccountDirectory } from './directory';

const CONNECT_MS = 10_000;
const HINT_MS = 8_000;

function within<T>(promise: Promise<T> | undefined, ms: number): Promise<T | undefined> {
  if (!promise) return Promise.resolve(undefined);
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

export function createSessionDirectory(port: MessagePort, home: MailBackend): AccountDirectory {
  const service = accountsClient(port);
  let indexByKey = new Map<string, number>();
  return {
    heavy: true,
    addAccountUrl: 'https://accounts.google.com/AddSession?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F',
    async list() {
      const listed = await service.list();
      const infos = listed.map((a) => accountInfo(a, !!a.home));
      indexByKey = new Map(infos.map((a) => [a.key, a.index]));
      return infos;
    },
    open: memoizedOpen(home, async (account) => {
      const remote = await connectRemoteBackend(await service.open(account.index, account.email), undefined, { timeoutMs: CONNECT_MS });
      // /u/N can point at a different account after someone signs out of another one.
      const email = await within(remote.accountHint?.(), HINT_MS).catch(() => undefined);
      if (email && email.toLowerCase() !== account.email.toLowerCase()) {
        throw new BackendError(`${account.email} is no longer signed in at this slot. Reload Gmail to refresh your accounts.`, 'unauthenticated');
      }
      return withLocalSnooze(remote, account.email);
    }),
    delegated: () => service.delegated(),
    async profiles(accounts) {
      const found = await service.profiles(accounts.map((a) => ({ index: indexByKey.get(a.key) ?? a.index, email: a.email })));
      const out: Record<string, { name?: string; photoUrl?: string }> = {};
      for (const a of accounts) {
        const p = found[indexByKey.get(a.key) ?? a.index];
        if (p) out[a.key] = p;
      }
      return out;
    },
    async unread(accounts) {
      const counts = await service.unread(accounts.map((a) => indexByKey.get(a.key) ?? a.index));
      const out: Record<string, number> = {};
      for (const a of accounts) {
        const n = counts[indexByKey.get(a.key) ?? a.index];
        if (n !== undefined) out[a.key] = n;
      }
      return out;
    },
  };
}
