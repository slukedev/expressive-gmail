import { BackendError } from '../../data/backend';
import { backend } from '../../data/client';
import {
  activateScope,
  accountColor,
  backendForScope,
  openAccount,
  scopeAccounts,
  scopeName,
  useAccounts,
  isMergedScope,
  type ScopeId,
  type Warm,
} from '../../data/accounts/store';
import { viewQuery } from '../../data/views';
import { filteredQuery, getListFilters } from '../list/filters';
import { getRoute, navigate } from '../../router/useRoute';
import { hostDiag, openAccountInTab } from '../../lib/host';
import { labelDotColor } from '../../theme/color';
import { LEAVE_MS, leaveFor } from './AccountTransition';
import { viewToHash, type View } from '../../router/routes';
import { useSettingsStore } from '../../state/settings';
import { useUi } from '../../state/ui';
import { snack, snackbarManager } from '../../ui/Snackbar';
import { cancelDraftSave, isEmptyDraft, toOutgoing } from '../compose/send';

/** However an account's background Gmail misbehaves. */
const OPEN_DEADLINE_MS = 30_000;

function deadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer = 0;
  return Promise.race([
    promise.finally(() => window.clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new BackendError(message, 'session-unavailable', true)), ms);
    }),
  ]);
}

/** Views that only make sense in the account they came from fall back to the inbox. */
function viewAfterSwitch(view: View): View {
  return view.kind === 'label' || view.kind === 'split' ? { kind: 'folder', folder: 'inbox' } : view;
}

/** So the switch can read the new shell's list ahead. */
export function warmFor(view: View): Warm {
  const settings = useSettingsStore.getState().settings;
  return { view, q: filteredQuery(viewQuery(view, settings), getListFilters(view)), pageSize: settings.pageSize };
}

/** Saves every unsent message to Drafts in its own account, then closes it. */
async function parkComposes(): Promise<number> {
  const open = useUi.getState().composes;
  let saved = 0;
  for (const d of open) {
    cancelDraftSave(d.key);
    if (isEmptyDraft(d) || !backend().capabilities.drafts) continue;
    try {
      await backend().saveDraft(toOutgoing(d));
      saved++;
    } catch {
      // Left open below so nothing typed is lost.
      return -1;
    }
  }
  for (const d of open) useUi.getState().closeCompose(d.key);
  return saved;
}

let prefetchTimer = 0;
/** Opening an account is heavy: wait out the menu's own opening, and a pointer sweeping past rows starts nothing. */
const PREFETCH_DELAY_MS = 200;

/** On pointing at a switcher row, so a click a moment later finds the accounts ready. Errors wait for the click. */
export function prefetchScope(scope: ScopeId) {
  const { scope: current, directory } = useAccounts.getState();
  if (scope === current || !directory || !isMergedScope(scope)) return;
  window.clearTimeout(prefetchTimer);
  prefetchTimer = window.setTimeout(() => {
    const { accounts } = useAccounts.getState();
    for (const account of scopeAccounts(scope, accounts, useSettingsStore.getState().settings)) {
      if (!account.home) void openAccount(account).catch(() => undefined);
    }
  }, PREFETCH_DELAY_MS);
}

/** Unsent messages are saved as drafts first so nothing goes out from the wrong account. */
export async function switchScope(scope: ScopeId) {
  const state = useAccounts.getState();
  if (state.pending) {
    if (state.pending !== scope) snack(`Still opening ${scopeName(state.pending, state.accounts, useSettingsStore.getState().settings)}…`);
    return;
  }
  if (state.scope === scope) return;
  const settings = useSettingsStore.getState().settings;
  const name = scopeName(scope, state.accounts, settings);
  const members = scopeAccounts(scope, state.accounts, settings);
  if (!members.length) {
    snack(`${name} has no signed-in accounts. Edit it in Settings > Accounts.`);
    return;
  }

  // One other account loads its Gmail in this tab, as Gmail switches: instant from its cache,
  // and Back and reload behave as people expect.
  const single = !isMergedScope(scope) ? members[0]! : undefined;
  if (single && !single.home && state.directory?.heavy) {
    useAccounts.setState({ pending: scope });
    const saved = await parkComposes();
    if (saved < 0) {
      useAccounts.setState({ pending: null });
      snack("Couldn't save your draft, so you're still here. Send or discard it, then switch.");
      return;
    }
    hostDiag(`loading ${single.email} (/u/${single.index}) in this tab`);
    try {
      sessionStorage.removeItem('bg.scope');
    } catch {
      // No per-tab memory: nothing to clear.
    }
    const dark = document.documentElement.dataset.themeMode === 'dark';
    leaveFor({ email: single.email, name: single.name, photoUrl: single.photoUrl, color: labelDotColor(accountColor(single, settings), dark) });
    await new Promise((resolve) => window.setTimeout(resolve, LEAVE_MS));
    openAccountInTab(single.index, viewToHash(viewAfterSwitch(getRoute().view)));
    return;
  }

  useAccounts.setState({ pending: scope });
  const started = performance.now();
  const took = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;
  hostDiag(`switching to ${scope}`);
  // Opening an account in the background can take a few seconds the first time.
  const slow = window.setTimeout(() => {
    snack(`Opening ${name}…`, { id: 'scope-switch', timeout: 0 });
  }, 700);
  try {
    const saved = await parkComposes();
    if (saved < 0) {
      snack("Couldn't save your draft, so you're still here. Send or discard it, then switch.");
      return;
    }
    const { backend: next, failed } = await deadline(backendForScope(scope), OPEN_DEADLINE_MS, `${name} took too long to open.`);
    useUi.getState().clearSelection();
    useUi.getState().setCursor(-1);
    useUi.getState().set({ settingsSection: null, palette: false });
    const view = viewAfterSwitch(getRoute().view);
    const from = getRoute();
    if (!(await activateScope(next, scope, warmFor(view), failed))) return;
    if (from.threadId || from.view !== view) navigate({ view }, { replace: true });
    hostDiag(`switched to ${scope} in ${took()}${failed.length ? `, without ${failed.map((f) => f.account.email).join(', ')}` : ''}`);
    window.clearTimeout(slow);
    snackbarManager.close('scope-switch');
    if (saved > 0) {
      snack(saved === 1 ? 'Your unsent message was saved to Drafts.' : `${saved} unsent messages were saved to Drafts.`);
    }
  } catch (err) {
    window.clearTimeout(slow);
    snackbarManager.close('scope-switch');
    hostDiag(`switch to ${scope} failed after ${took()}: ${(err as Error)?.message ?? String(err)}`);
    const message = err instanceof BackendError || err instanceof Error ? err.message : String(err);
    snack(`Couldn't open ${name}. ${message}`, {
      timeout: 10_000,
      action: { label: 'Try again', onClick: () => void switchScope(scope) },
    });
  } finally {
    window.clearTimeout(slow);
    // A newer switch may be the one pending now.
    if (useAccounts.getState().pending === scope) useAccounts.setState({ pending: null });
  }
}
