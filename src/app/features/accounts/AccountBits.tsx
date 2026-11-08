import { useMemo, type CSSProperties } from 'react';
import { splitId } from '../../data/accounts/ids';
import type { AccountInfo } from '../../data/accounts/directory';
import {
  accountColor,
  accountLabel,
  accountShortLabel,
  isMergedScope,
  scopeAccounts,
  scopeName,
  useAccounts,
  type ScopeId,
} from '../../data/accounts/store';
import { useSettings, type Settings } from '../../state/settings';
import { labelChipColors, labelDotColor } from '../../theme/color';
import { useResolvedDark, useSystemDark } from '../../theme/ThemeProvider';
import { Avatar } from '../../ui/Avatar';
import { cx } from '../../ui/Button';
import type { ViewIdentity } from '../list/viewIdentity';

export interface AccountView extends AccountInfo {
  /** Nickname, profile name or address. */
  label: string;
  /** Nickname, else the shortest thing that tells it apart. */
  short: string;
  /** Resolved for the current scheme. */
  color: string;
  tone: { bg: string; fg: string };
  /** Every account has its own photo, so a photo alone tells them apart. */
  distinctPhoto: boolean;
  unread?: number;
}

function toView(a: AccountInfo, accounts: AccountInfo[], prefs: Settings['accountPrefs'], dark: boolean, unread: number | undefined): AccountView {
  const photos = accounts.map((x) => x.photoUrl);
  const distinct = photos.every((p) => !!p) && new Set(photos).size === photos.length;
  return {
    ...a,
    label: accountLabel(a, { accountPrefs: prefs }),
    short: accountShortLabel(a, accounts, { accountPrefs: prefs }),
    color: labelDotColor(accountColor(a, { accountPrefs: prefs }), dark),
    tone: labelChipColors(accountColor(a, { accountPrefs: prefs }), dark),
    distinctPhoto: distinct,
    ...(unread !== undefined ? { unread } : {}),
  };
}

export function useAccountViews(): AccountView[] {
  const accounts = useAccounts((s) => s.accounts);
  const unread = useAccounts((s) => s.unread);
  const prefs = useSettings((s) => s.accountPrefs);
  const dark = useResolvedDark();
  return useMemo(() => accounts.map((a) => toView(a, accounts, prefs, dark, unread[a.key])), [accounts, unread, prefs, dark]);
}

export function useScopeViews(of?: ScopeId | null): AccountView[] {
  const current = useAccounts((s) => s.scope);
  const scope = of === undefined ? current : of;
  const views = useAccountViews();
  const circles = useSettings((s) => s.circles);
  const accountPrefs = useSettings((s) => s.accountPrefs);
  return useMemo(() => {
    if (!scope) return [];
    const keys = scopeAccounts(scope, views, { circles, accountPrefs }).map((a) => a.key);
    return keys.map((k) => views.find((v) => v.key === k)!);
  }, [scope, views, circles, accountPrefs]);
}

/** Null for one account. */
export function useScopeTitle(): string | null {
  const scope = useAccounts((s) => s.scope);
  const accounts = useAccounts((s) => s.accounts);
  const circles = useSettings((s) => s.circles);
  const accountPrefs = useSettings((s) => s.accountPrefs);
  return isMergedScope(scope) ? scopeName(scope!, accounts, { circles, accountPrefs }) : null;
}

/** All inboxes in primary, a circle in its own color. */
export function useScopeIdentity(): ViewIdentity | null {
  const scope = useAccounts((s) => s.scope);
  const circles = useSettings((s) => s.circles);
  const dark = useResolvedDark();
  if (scope === 'all') return { icon: 'all_inbox', shape: 'Cookie12Sided', bg: 'var(--md-sys-color-primary-container)', fg: 'var(--md-sys-color-on-primary-container)' };
  const circle = scope?.startsWith('circle:') ? circles.find((c) => c.id === scope.slice(7)) : undefined;
  return circle ? { icon: 'join', shape: 'Clover4Leaf', ...labelChipColors(circle.color, dark) } : null;
}

export function useFocusedAccount(): AccountView | undefined {
  const focus = useAccounts((s) => s.focus);
  const views = useAccountViews();
  return focus ? views.find((v) => v.email.toLowerCase() === focus) : undefined;
}

export function useIsMerged() {
  return isMergedScope(useAccounts((s) => s.scope));
}

export function useThreadAccount(threadId: string): AccountView | undefined {
  const key = splitId(threadId).key;
  // Every list row asks. A row from no other account mustn't re-render when counts or the theme change.
  const accounts = useAccounts((s) => (key ? s.accounts : null));
  const unread = useAccounts((s) => (key ? s.unread[key] : undefined));
  const prefs = useSettings((s) => (key ? s.accountPrefs : null));
  const mode = useSettings((s) => (key ? s.themeMode : null));
  const systemDark = useSystemDark();
  const dark = mode === 'system' ? systemDark : mode === 'dark';
  return useMemo(() => {
    const a = accounts?.find((x) => x.key === key);
    return a && accounts && prefs ? toView(a, accounts, prefs, dark, unread) : undefined;
  }, [key, accounts, unread, prefs, dark]);
}

/** The ring tells apart accounts with the same face. */
export function AccountAvatar({ account, size = 32, ring = true }: { account: AccountView; size?: number; ring?: boolean }) {
  return (
    <span className={cx('account-avatar', ring && 'account-avatar--ring')} style={{ '--account-color': account.color } as CSSProperties}>
      <Avatar own name={account.name} email={account.email} photoUrl={account.photoUrl} size={size} />
    </span>
  );
}

export function AccountStack({ accounts, size = 24, max = 3, more = true, className }: { accounts: AccountView[]; size?: number; max?: number; more?: boolean; className?: string }) {
  const shown = accounts.slice(0, max);
  const extra = more ? accounts.length - shown.length : 0;
  return (
    <span className={cx('account-stack', className)} style={{ '--stack-size': `${size}px` } as CSSProperties} aria-hidden="true">
      {shown.map((a) => (
        <span key={a.key} className="account-stack__item" style={{ '--account-color': a.color } as CSSProperties}>
          <Avatar own name={a.name} email={a.email} photoUrl={a.photoUrl} size={size} />
        </span>
      ))}
      {extra > 0 && <span className="account-stack__more">+{extra}</span>}
    </span>
  );
}

export function AccountChip({ account, size = 'small', className }: { account: AccountView; size?: 'small' | 'medium'; className?: string }) {
  const photo = size === 'medium' ? 20 : 14;
  return (
    <span
      className={cx('account-chip', `account-chip--${size}`, className)}
      title={account.email}
      style={{ '--account-bg': account.tone.bg, '--account-fg': account.tone.fg, '--account-color': account.color } as CSSProperties}
    >
      <Avatar own name={account.name} email={account.email} photoUrl={account.photoUrl} size={photo} className="account-chip__photo" />
      <span className="account-chip__text">{account.short}</span>
    </span>
  );
}

/** Like Android's app badge on a notification: the account's photo when all differ, else its initial. */
export function AccountBadge({ account }: { account: AccountView }) {
  return (
    <span className="account-badge" style={{ '--account-color': account.color } as CSSProperties} aria-hidden="true">
      {account.distinctPhoto ? (
        <Avatar own name={account.name} email={account.email} photoUrl={account.photoUrl} size={16} />
      ) : (
        <span className="account-badge__initial">{(account.short.match(/\p{L}|\p{N}/u)?.[0] ?? '?').toLocaleUpperCase()}</span>
      )}
    </span>
  );
}

/** "1,204", nothing for zero. */
export function unreadText(n: number | undefined): string {
  return n ? n.toLocaleString() : '';
}
