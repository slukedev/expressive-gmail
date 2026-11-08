import { accountKey, qualify, rawId, splitId } from './ids';
import { isMergedScope, scopeAccounts, useAccounts } from './store';
import { useSettingsStore } from '../../state/settings';

/** Lowercased address, when the current scope can tell. */
export function threadAccount(threadId: string): string | undefined {
  const { key } = splitId(threadId);
  const { accounts, scope } = useAccounts.getState();
  if (key) return accounts.find((a) => a.key === key)?.email.toLowerCase();
  if (scope?.startsWith('account:')) return scope.slice('account:'.length) || undefined;
  return undefined;
}

/** Unknown accounts always belong. */
export function inCurrentScope(account: string | undefined): boolean {
  const { accounts, scope } = useAccounts.getState();
  if (!account || !scope || accounts.length < 2) return true;
  return scopeAccounts(scope, accounts, useSettingsStore.getState().settings).some((a) => a.email.toLowerCase() === account);
}

export function scopedThreadId(threadId: string, account: string | undefined): string {
  const raw = rawId(threadId);
  return account && isMergedScope(useAccounts.getState().scope) ? qualify(accountKey(account), raw) : raw;
}
