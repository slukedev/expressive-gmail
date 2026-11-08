import type { QueryCacheNotifyEvent } from '@tanstack/react-query';
import type { MailBackend } from './backend';
import { bootCache, type BootEntry } from './bootCache';
import { keys, queryClient } from './client';
import { contactIndex, startContactIndex } from './contacts';
import { photos } from './photos';
import type { Account } from './types';

/** Setting up a backend as the active one: its cached inbox, contact index, photo cache and events. The slow part (storage, learning the account) runs before React swaps in the shell; cache seeding runs right after the query cache is cleared. */

/** Without the account, the inbox loads uncached. */
const HINT_TIMEOUT_MS = 1_500;

let prepared: { backend: MailBackend; email?: string; entry?: BootEntry } | undefined;
let teardown: (() => void) | undefined;

function withTimeout<T>(promise: Promise<T> | undefined, ms: number): Promise<T | undefined> {
  if (!promise) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

/** Never throws. */
export async function prepareBackend(backend: MailBackend): Promise<void> {
  const photosRead = photos.preload();
  const email = await withTimeout(backend.accountHint?.(), HINT_TIMEOUT_MS);
  const [entry] = await Promise.all([bootCache.load(backend.kind, email).catch(() => undefined), photosRead]);
  prepared = { backend, email, entry };
}

/** Call once the query cache is empty and `backend` is what `backend()` returns. */
export function backendReady(backend: MailBackend) {
  teardown?.();
  const ready = prepared?.backend === backend ? prepared : undefined;
  prepared = undefined;
  if (ready?.entry) bootCache.hydrate(ready.entry);

  const stops: (() => void)[] = [];
  if (ready?.email) stops.push(bootCache.watch(backend.kind, ready.email));
  const unsubscribe = backend.subscribe?.((event) => {
    if (event.type === 'account') void queryClient.invalidateQueries({ queryKey: keys.account });
  });
  if (unsubscribe) stops.push(unsubscribe);

  // Contacts and photos belong to one account of one backend.
  let scope: string | undefined;
  let stopContacts: (() => void) | undefined;
  const enterAccount = (email: string, account?: Account) => {
    const next = `${backend.kind}:${email.trim().toLowerCase()}`;
    const self = [email, ...(account?.sendAs ?? []).map((a) => a.email)];
    if (next !== scope) {
      scope = next;
      photos.setScope(next);
      stopContacts?.();
      stopContacts = startContactIndex(queryClient, next, self);
    } else contactIndex.setSelf(self);
    if (account) photos.remember(account.email, account.photoUrl);
  };
  if (ready?.email) enterAccount(ready.email, ready.entry?.account?.data);
  stops.push(
    queryClient.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
      if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryKey[0] !== keys.account[0]) return;
      const account = event.query.state.data as Account | undefined;
      if (account?.email) enterAccount(account.email, account);
    }),
  );

  teardown = () => {
    stops.forEach((stop) => stop());
    stopContacts?.();
    photos.setScope(undefined);
    teardown = undefined;
  };
}

export function showingCachedMail() {
  return bootCache.revalidating;
}

/** Or after a timeout. */
export function untilFreshMail() {
  return bootCache.untilFresh();
}
