import { useState, type CSSProperties } from 'react';
import { focusAccount, useAccounts } from '../../data/accounts/store';
import { splitId } from '../../data/accounts/ids';
import { closeThread, getRoute } from '../../router/useRoute';
import { useUi } from '../../state/ui';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { snack } from '../../ui/Snackbar';
import { unreadText, useScopeViews, type AccountView } from './AccountBits';
import { warmFor } from './switch';

/** One chip per account in the rows' colors, so it's also the key to them. */
export function AccountFilter({ missing = [] }: { missing?: string[] }) {
  const accounts = useScopeViews();
  const focus = useAccounts((s) => s.focus);
  const [busy, setBusy] = useState<string | null>(null);
  if (accounts.length < 2) return null;

  const pick = async (a: AccountView) => {
    const email = a.email.toLowerCase();
    const next = focus === email ? null : email;
    setBusy(a.key);
    try {
      // An open conversation from another account can't stay open in the narrowed view.
      const open = getRoute().threadId;
      if (next && open && splitId(open).key !== a.key) closeThread();
      useUi.getState().clearSelection();
      await focusAccount(next, warmFor(getRoute().view));
    } catch (err) {
      snack(`Couldn't show ${a.short} on its own. ${(err as Error)?.message ?? ''}`.trim());
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="account-filter" role="group" aria-label="Show mail from">
      {accounts.map((a) => {
        const on = focus === a.email.toLowerCase();
        const failed = missing.some((m) => m.toLowerCase() === a.email.toLowerCase());
        return (
          <Chip
            key={a.key}
            kind="filter"
            selected={on}
            disabled={!!busy}
            className="account-filter__chip"
            style={{ '--account-color': a.color } as CSSProperties}
            // Selected: the M3 filter-chip check takes the dot's place, so a narrowed view reads as one.
            avatar={
              on ? (
                <Icon name="check" size={18} className="m3-chip__leading account-filter__check" />
              ) : failed ? (
                <Icon name="cloud_off" size={18} className="m3-chip__leading account-filter__failed" />
              ) : (
                <span className="account-chip__dot account-filter__dot" aria-hidden="true" />
              )
            }
            data-failed={failed || undefined}
            title={a.email}
            aria-label={`Only ${a.short}, ${a.email}${failed ? ", couldn't load" : a.unread ? `, ${a.unread} unread` : ''}`}
            onClick={() => void pick(a)}
          >
            {a.short}
            {a.unread && !failed ? <span className="account-filter__count">{unreadText(a.unread)}</span> : null}
          </Chip>
        );
      })}
    </div>
  );
}
