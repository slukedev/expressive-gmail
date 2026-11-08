import { create } from 'zustand';
import { readKey, writeKey } from '../../state/storage';
import { useSettingsStore, type Settings } from '../../state/settings';
import { BackendError, type MailBackend } from '../backend';
import { ACCOUNT_PROFILES_KEY } from '../cacheKeys';
import { keys, queryClient, setBackend } from '../client';
import { publicPhoto } from '../../../session/account';
import type { View } from '../../router/routes';
import { backendReady, prepareBackend } from '../lifecycle';
import type { Account } from '../types';
import { accountInfo, type AccountDirectory, type AccountInfo, type DelegatedMailbox } from './directory';
import { createMergedBackend, type MergedMember } from './merged';

export type ScopeId = 'all' | `account:${string}` | `circle:${string}`;

/** Gmail label palette seeds. */
export const ACCOUNT_COLORS = ['#4a86e8', '#16a766', '#e07798', '#ffad47', '#a479e2', '#2da2bb', '#e66550', '#a46a21'];

/** Per tab, so a reload stays where you were and a new tab follows the start setting. */
const SESSION_SCOPE_KEY = 'bg.scope';
const UNREAD_INTERVAL_MS = 60_000;
const LIST_TIMEOUT_MS = 8_000;

interface AccountsState {
  directory: AccountDirectory | null;
  /** In Gmail's /u/N order. */
  accounts: AccountInfo[];
  scope: ScopeId | null;
  /** The scope being opened, while it loads. */
  pending: ScopeId | null;
  /** Inbox unread by account key. */
  unread: Record<string, number>;
  /** In a merged scope, the one account (lowercased address) it's narrowed to. */
  focus: string | null;
  /** In a merged scope, the accounts that couldn't be read. */
  missing: { email: string; message: string }[];
  /** By key. */
  opened: Record<string, true>;
  delegated: DelegatedMailbox[];
}

export const useAccounts = create<AccountsState>(() => ({
  directory: null,
  accounts: [],
  scope: null,
  pending: null,
  unread: {},
  opened: {},
  focus: null,
  missing: [],
  delegated: [],
}));

type ScopeSettings = Pick<Settings, 'circles' | 'accountPrefs'>;

const norm = (email: string) => email.trim().toLowerCase();

export const accountScope = (email: string): ScopeId => `account:${norm(email)}`;

/** In display order. Empty when the scope no longer exists. */
export function scopeAccounts(scope: ScopeId, accounts: AccountInfo[], settings: ScopeSettings): AccountInfo[] {
  if (scope === 'all') {
    const shown = accounts.filter((a) => !settings.accountPrefs[norm(a.email)]?.hideFromAll);
    return shown.length ? shown : accounts;
  }
  if (scope.startsWith('circle:')) {
    const circle = settings.circles.find((c) => c.id === scope.slice('circle:'.length));
    if (!circle) return [];
    return circle.members.flatMap((email) => accounts.filter((a) => norm(a.email) === email));
  }
  const email = scope.slice('account:'.length);
  return accounts.filter((a) => norm(a.email) === email);
}

export const isMergedScope = (scope: ScopeId | null) => !!scope && !scope.startsWith('account:');

export function accountColor(account: Pick<AccountInfo, 'email' | 'index'>, settings: Pick<Settings, 'accountPrefs'>): string {
  return settings.accountPrefs[norm(account.email)]?.color ?? ACCOUNT_COLORS[account.index % ACCOUNT_COLORS.length]!;
}

/** Nickname, else the profile name, else the address. */
export function accountLabel(account: Pick<AccountInfo, 'email' | 'name'>, settings: Pick<Settings, 'accountPrefs'>): string {
  return settings.accountPrefs[norm(account.email)]?.nickname?.trim() || account.name || account.email;
}

const CONSUMER_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * For chips on rows: the nickname, else the work domain ("riverastudio"), else the address
 * before the @ (every Gmail address shares gmail.com, and so might two work ones).
 */
export function accountShortLabel(account: Pick<AccountInfo, 'email'>, accounts: Pick<AccountInfo, 'email'>[], settings: Pick<Settings, 'accountPrefs'>): string {
  const nickname = settings.accountPrefs[norm(account.email)]?.nickname?.trim();
  if (nickname) return nickname;
  const org = (email: string) => {
    const domain = email.split('@')[1]?.toLowerCase() ?? '';
    return CONSUMER_DOMAINS.has(domain) ? undefined : domain.split('.')[0];
  };
  const mine = org(account.email);
  const clash = !mine || accounts.some((a) => norm(a.email) !== norm(account.email) && org(a.email) === mine);
  return clash ? account.email.split('@')[0]! : mine;
}

export function scopeName(scope: ScopeId, accounts: AccountInfo[], settings: Pick<Settings, 'circles' | 'accountPrefs'>): string {
  if (scope === 'all') return 'All inboxes';
  if (scope.startsWith('circle:')) return settings.circles.find((c) => c.id === scope.slice(7))?.name ?? 'Circle';
  const account = scopeAccounts(scope, accounts, settings)[0];
  return account ? accountLabel(account, settings) : scope.slice(8);
}

function aliases(): Record<string, string[]> {
  const { settings } = useSettingsStore.getState();
  const out: Record<string, string[]> = {};
  for (const a of useAccounts.getState().accounts) {
    const nickname = settings.accountPrefs[norm(a.email)]?.nickname?.trim();
    out[a.key] = [nickname, a.name].filter((x): x is string => !!x);
  }
  return out;
}

type Profiles = Record<string, { name?: string; photoUrl?: string }>;
let profiles: Profiles | undefined;

/** For sources that only list addresses. */
async function rememberProfile(account: Pick<Account, 'email' | 'name' | 'photoUrl'>) {
  profiles ??= (await readKey<Profiles>(ACCOUNT_PROFILES_KEY)) ?? {};
  const key = norm(account.email);
  const prev = profiles[key];
  // A read that failed names the account by its address; that isn't a name.
  const name = account.name && norm(account.name) !== key ? account.name : undefined;
  const next = { name: name || prev?.name, photoUrl: account.photoUrl || prev?.photoUrl };
  if (prev?.name === next.name && prev?.photoUrl === next.photoUrl) return;
  profiles = { ...profiles, [key]: next };
  await writeKey(ACCOUNT_PROFILES_KEY, profiles).catch(() => undefined);
  useAccounts.setState((s) => ({
    accounts: s.accounts.map((a) =>
      norm(a.email) === key ? { ...a, name: next.name ?? a.name, photoUrl: next.photoUrl ?? a.photoUrl } : a,
    ),
  }));
}

// Gmail draws the account photo some time after the first read, and the app reads the account
// again when it does; keep the switcher in step with every read.
if (typeof window !== 'undefined') {
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success' || event.query.queryKey[0] !== keys.account[0]) return;
    const account = event.query.state.data as Account | undefined;
    if (!account?.email) return;
    for (const a of account.members ?? [account]) if (a.photoUrl || a.name) void rememberProfile(a);
  });
}

/** Photos saved before signed-in-only addresses were handled point at their public copy instead. */
const loadable = (url: string | undefined) => (url ? (publicPhoto(url) ?? url) : url);

async function withProfiles(list: AccountInfo[]): Promise<AccountInfo[]> {
  profiles ??= (await readKey<Profiles>(ACCOUNT_PROFILES_KEY)) ?? {};
  return list.map((a) => {
    const saved = profiles![norm(a.email)];
    const p = saved && { ...saved, photoUrl: loadable(saved.photoUrl) };
    return { ...a, ...(a.name || !p?.name ? {} : { name: p.name }), ...(a.photoUrl || !p?.photoUrl ? {} : { photoUrl: p.photoUrl }) };
  });
}

export async function openAccount(account: AccountInfo): Promise<MailBackend> {
  const { directory } = useAccounts.getState();
  if (!directory) throw new BackendError('Accounts are still loading', 'session-unavailable', true);
  const backend = await directory.open(account);
  if (!useAccounts.getState().opened[account.key]) {
    useAccounts.setState((s) => ({ opened: { ...s.opened, [account.key]: true } }));
    void backend.getAccount().then(rememberProfile, () => undefined);
  }
  return backend;
}

export async function backendForScope(
  scope: ScopeId,
  focus: string | null = null,
): Promise<{ backend: MailBackend; failed: { account: AccountInfo; error: unknown }[] }> {
  const { accounts } = useAccounts.getState();
  const all = scopeAccounts(scope, accounts, useSettingsStore.getState().settings);
  const members = focus ? all.filter((a) => norm(a.email) === focus) : all;
  if (!members.length) throw new BackendError('None of the accounts in this view are signed in.', 'not-found');
  if (!isMergedScope(scope)) return { backend: await openAccount(members[0]!), failed: [] };
  const settled = await Promise.allSettled(members.map(openAccount));
  const ok: MergedMember[] = [];
  const failed: { account: AccountInfo; error: unknown }[] = [];
  settled.forEach((r, i) => {
    const account = members[i]!;
    if (r.status === 'fulfilled') ok.push({ key: account.key, email: account.email, backend: r.value });
    else failed.push({ account, error: r.reason });
  });
  if (!ok.length) throw failed[0]!.error;
  return { backend: createMergedBackend(ok, { aliases }), failed };
}

/** The list on screen after a switch, read ahead so the new shell paints with it. */
export interface Warm {
  view: View;
  q: string;
  pageSize: number;
}

const WARM_TIMEOUT_MS = 6_000;

let swaps = 0;

/** With `warm`, reads what will be on screen first, so the new shell paints complete instead of a skeleton. */
async function swapBackend(backend: MailBackend, warm?: Warm): Promise<boolean> {
  // Switches overlap (narrow to one account, then pick a circle before it lands): the last asked wins.
  const swap = ++swaps;
  const [, account, labels, page] = await Promise.all([
    prepareBackend(backend),
    warm ? withTimeout(backend.getAccount(), WARM_TIMEOUT_MS) : undefined,
    warm ? withTimeout(backend.listLabels(), WARM_TIMEOUT_MS) : undefined,
    warm ? withTimeout(backend.listThreads({ q: warm.q, pageSize: warm.pageSize }), WARM_TIMEOUT_MS) : undefined,
  ]);
  if (swap !== swaps) return false;
  setBackend(backend);
  queryClient.clear();
  backendReady(backend);
  // Whatever the boot cache already put on screen refreshes on its own; fill in the rest.
  const seed = (key: readonly unknown[], data: unknown) => {
    if (data !== undefined && queryClient.getQueryData(key) === undefined) queryClient.setQueryData(key, data);
  };
  seed(keys.account, account);
  seed(keys.labels, labels);
  if (warm && page) seed(keys.threads(warm.q, warm.view), { pages: [page], pageParams: [undefined] });
  return true;
}

/** The shell remounts on the scope change. Resolves false when a later switch took over first. */
export async function activateScope(backend: MailBackend, scope: ScopeId, warm?: Warm, failed: { account: AccountInfo; error: unknown }[] = []): Promise<boolean> {
  if (!(await swapBackend(backend, warm))) return false;
  if (scope === 'account:') scope = listedHomeScope() ?? scope;
  useAccounts.setState({ scope, focus: null, missing: failed.map((f) => ({ email: f.account.email, message: (f.error as Error)?.message ?? String(f.error) })) });
  try {
    sessionStorage.setItem(SESSION_SCOPE_KEY, scope);
  } catch {
    // Storage blocked: a reload opens the start scope instead.
  }
  void refreshUnread();
  return true;
}

/** The scope stays (same title, same chips); the backend under it reads only that account, so everything agrees. */
export async function focusAccount(email: string | null, warm?: Warm) {
  const { scope, focus } = useAccounts.getState();
  const next = email ? norm(email) : null;
  if (!scope || !isMergedScope(scope) || focus === next) return;
  const { backend } = await backendForScope(scope, next);
  // A scope switch meanwhile owns the backend now.
  if (useAccounts.getState().scope !== scope) return;
  if (await swapBackend(backend, warm)) useAccounts.setState({ focus: next });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

function wantedScope(settings: Settings): ScopeId | null {
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(SESSION_SCOPE_KEY);
  } catch {
    // No per-tab memory; use the start setting.
  }
  // A tab reloads into All inboxes or a circle it was showing; another single account loads as its own page.
  if (saved && /^(all|circle:.+)$/.test(saved)) return saved as ScopeId;
  return settings.startScope === 'home' ? null : settings.startScope;
}

let unreadTimer = 0;

/** The tab's own account unless it was elsewhere before a reload or the start setting says otherwise. */
export async function bootAccounts(directory: AccountDirectory, home: MailBackend): Promise<{ fellBack?: string }> {
  useAccounts.setState({ directory, accounts: [], scope: null, pending: null, unread: {}, opened: {}, focus: null, missing: [], delegated: [] });
  const hint = await withTimeout(home.accountHint?.() ?? Promise.resolve(undefined), 1_500);
  const homeEmail = hint ?? (await withTimeout(home.getAccount(), 4_000))?.email;
  const homeScope = homeEmail ? accountScope(homeEmail) : null;

  const listing = loadAccountList(directory, home, homeEmail);
  const wanted = wantedScope(useSettingsStore.getState().settings);
  if (!wanted || wanted === homeScope) {
    await activateScope(home, homeScope ?? 'account:');
    return {};
  }
  await withTimeout(listing, LIST_TIMEOUT_MS);
  try {
    const { backend, failed } = await backendForScope(wanted);
    await activateScope(backend, wanted, undefined, failed);
    return {};
  } catch (err) {
    await activateScope(home, homeScope ?? 'account:');
    return { fellBack: (err as Error)?.message ?? String(err) };
  }
}

function listedHomeScope(): ScopeId | undefined {
  const home = useAccounts.getState().accounts.find((a) => a.home);
  return home ? accountScope(home.email) : undefined;
}

async function loadAccountList(directory: AccountDirectory, home: MailBackend, homeEmail: string | undefined) {
  let list: AccountInfo[];
  try {
    list = await directory.list();
  } catch {
    const account = await home.getAccount().catch(() => undefined);
    list = account ? [accountInfo(account, true)] : [];
  }
  // The tab's account is home even when the source can't tell which slot it is.
  if (homeEmail && !list.some((a) => a.home)) list = list.map((a) => (norm(a.email) === norm(homeEmail) ? { ...a, home: true } : a));
  list = await withProfiles([...list].sort((a, b) => a.index - b.index));
  const home_ = list.find((a) => a.home);
  useAccounts.setState((s) => ({ accounts: list, opened: home_ ? { ...s.opened, [home_.key]: true } : s.opened }));
  // Booted before the tab could name its account: the list names it now.
  if (useAccounts.getState().scope === 'account:') useAccounts.setState({ scope: listedHomeScope() ?? 'account:' });
  void home.getAccount().then(rememberProfile, () => undefined);
  void fillProfiles(directory, list);
  loadDelegated(directory);
  watchForNewAccounts(directory, home, homeEmail);
  window.clearInterval(unreadTimer);
  if (list.length > 1) {
    unreadTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshUnread();
    }, UNREAD_INTERVAL_MS);
  }
  void refreshUnread();
}

async function fillProfiles(directory: AccountDirectory, list: AccountInfo[]) {
  const missing = list.filter((a) => !a.home && !a.photoUrl);
  if (!missing.length || !directory.profiles) return;
  const found = await directory.profiles(missing).catch(() => ({}) as Record<string, { name?: string; photoUrl?: string }>);
  for (const a of missing) {
    const p = found[a.key];
    if (p) await rememberProfile({ email: a.email, name: p.name ?? '', photoUrl: p.photoUrl });
  }
}

const DELEGATED_MS = 15_000;
/** Gmail may not have drawn its switcher yet; one more look after it settles. */
const DELEGATED_RETRY_MS = 75_000;

/** Never on the way to the first paint; a failure just lists none. */
function loadDelegated(directory: AccountDirectory) {
  if (!directory.delegated) return;
  const idle = (run: () => void, after: number) =>
    setTimeout(() => (typeof requestIdleCallback === 'function' ? requestIdleCallback(run, { timeout: 4_000 }) : run()), after);
  const read = async (retry: boolean) => {
    const found = (await withTimeout(directory.delegated!(), DELEGATED_MS)) ?? [];
    const { directory: current, accounts } = useAccounts.getState();
    if (current !== directory) return;
    if (!found.length && retry) idle(() => void read(false), DELEGATED_RETRY_MS);
    const signedIn = new Set(accounts.map((a) => norm(a.email)));
    const seen = new Set<string>();
    const delegated = found.filter((d) => {
      const key = norm(d.email);
      if (!/^https:\/\/mail\.google\.com\//.test(d.url) || signedIn.has(key) || seen.has(key) || seen.has(d.url)) return false;
      seen.add(key);
      seen.add(d.url);
      return true;
    });
    const before = useAccounts.getState().delegated;
    const same = before.length === delegated.length && before.every((d, i) => d.url === delegated[i]!.url && d.name === delegated[i]!.name);
    if (!same) useAccounts.setState({ delegated });
  };
  idle(() => void read(true), typeof requestIdleCallback === 'function' ? 0 : 1_000);
}

let stopWatching: (() => void) | undefined;

/** Add another account opens Google in a new tab; list again when the user comes back. */
function watchForNewAccounts(directory: AccountDirectory, home: MailBackend, homeEmail: string | undefined) {
  stopWatching?.();
  let last = Date.now();
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < 30_000) return;
    last = Date.now();
    void directory
      .list()
      .then(async (fresh) => {
        const known = useAccounts.getState().accounts;
        const same = fresh.length === known.length && fresh.every((a) => known.some((k) => k.key === a.key));
        if (same || useAccounts.getState().directory !== directory) return;
        stopWatching?.();
        await loadAccountList(directory, home, homeEmail);
      })
      .catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisible);
  stopWatching = () => document.removeEventListener('visibilitychange', onVisible);
}

/** Live from open accounts, cheaply for the rest. */
async function refreshUnread() {
  const { directory, accounts, opened } = useAccounts.getState();
  if (!directory || accounts.length < 2) return;
  const counts: Record<string, number> = {};
  const live = accounts.filter((a) => opened[a.key]);
  const rest = accounts.filter((a) => !opened[a.key]);
  await Promise.all(
    live.map(async (a) => {
      try {
        const labels = await (await directory.open(a)).listLabels();
        counts[a.key] = labels.find((l) => l.id === 'INBOX')?.unreadCount ?? 0;
      } catch {
        // Keep the last count.
      }
    }),
  );
  if (rest.length && directory.unread) Object.assign(counts, await directory.unread(rest).catch(() => ({})));
  useAccounts.setState((s) => ({ unread: { ...s.unread, ...counts } }));
}
