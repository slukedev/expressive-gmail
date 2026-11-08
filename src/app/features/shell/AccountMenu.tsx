import { Menu as BaseMenu } from '@base-ui/react/menu';
import { useAccount } from '../../data/hooks';
import { useBackendKind } from '../../data/useBackendKind';
import { accountScope, isMergedScope, scopeName, useAccounts, type ScopeId } from '../../data/accounts/store';
import { classicGmail, openUrl } from '../../lib/host';
import { useSettings } from '../../state/settings';
import { useUi } from '../../state/ui';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { MenuItem, MenuPopup, MenuSeparator } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';
import { AccountAvatar, AccountStack, unreadText, useAccountViews, useScopeViews, type AccountView } from '../accounts/AccountBits';
import { prefetchScope, switchScope } from '../accounts/switch';
import { openNewCircle } from '../accounts/newCircle';
import { DelegatedMenuGroup, useDelegated } from '../accounts/Delegated';

const SOURCE_LABEL = { session: 'Signed in through Gmail', api: 'Connected with the Gmail API', demo: import.meta.env.DEV ? 'Demo mailbox' : 'Signed in through Gmail' };

function Trailing({ scope, unread }: { scope: ScopeId; unread?: number }) {
  const current = useAccounts((s) => s.scope);
  const pending = useAccounts((s) => s.pending);
  return pending === scope ? (
      <LoadingIndicator size={24} label="Opening" className="account-row__busy" />
    ) : current === scope ? (
      <Icon name="check" size={20} className="account-row__check" />
    ) : unread ? (
      <span className="account-row__count">{unreadText(unread)}</span>
    ) : null;
}

function ScopeRow({
  scope,
  lead,
  title,
  supporting,
  unread,
}: {
  scope: ScopeId;
  lead: React.ReactNode;
  title: string;
  supporting?: string;
  unread?: number;
}) {
  const current = useAccounts((s) => s.scope);
  const leaves = useAccounts((s) => !!s.directory?.heavy && !isMergedScope(scope) && !s.accounts.find((a) => accountScope(a.email) === scope)?.home);
  const selected = current === scope;
  return (
    <BaseMenu.Item
      className="m3-menu-item account-row"
      data-selected={selected || undefined}
      aria-current={selected ? 'true' : undefined}
      // Switching in place keeps the menu up with progress in this row; loading another account's page closes it.
      closeOnClick={selected || leaves}
      onClick={() => !selected && void switchScope(scope)}
      onPointerEnter={() => prefetchScope(scope)}
      onFocus={() => prefetchScope(scope)}
    >
      <span className="account-row__lead">{lead}</span>
      <span className="m3-menu-item__text">
        <span className="m3-menu-item__label">{title}</span>
        {supporting && <span className="m3-menu-item__supporting account-row__supporting">{supporting}</span>}
      </span>
      <Trailing scope={scope} unread={unread} />
    </BaseMenu.Item>
  );
}

const sum = (list: AccountView[]) => list.reduce((n, a) => n + (a.unread ?? 0), 0);
const count = (n: number) => `${n} ${n === 1 ? 'account' : 'accounts'}`;

/** With more than one account signed in it switches between them, All inboxes and circles in place. */
export function AccountMenu() {
  const { data: account } = useAccount();
  const kind = useBackendKind();
  const scope = useAccounts((s) => s.scope);
  const accounts = useAccountViews();
  const inScope = useScopeViews();
  const directory = useAccounts((s) => s.directory);
  const circles = useSettings((s) => s.circles);
  const settings = { circles, accountPrefs: useSettings((s) => s.accountPrefs) };
  const all = useScopeViews('all');
  const delegated = useDelegated().length > 0;
  if (!account) return <span className="account-btn account-btn--placeholder" />;

  const merged = !!account.members;
  const many = accounts.length > 1;
  const name = merged && scope ? scopeName(scope, accounts, settings) : account.name;
  const detail = merged ? count(inScope.length) : account.email;
  // The header is who you are: in a merged view, the account this tab signed in with.
  const me = merged ? (accounts.find((a) => a.home) ?? accounts[0]) : undefined;
  const who = me ? { name: me.name ?? me.email, email: me.email, photoUrl: me.photoUrl } : { name: account.name, email: account.email, photoUrl: account.photoUrl };
  const openSettings = (section: string) => useUi.getState().set({ settingsSection: section });

  return (
    // Not modal: a modal menu locks page scroll and lays the page out again to cut its backdrop.
    <BaseMenu.Root modal={false}>
      <Tooltip
        content={
          <span className="account-tip">
            <strong>{merged ? name : 'Google Account'}</strong>
            {merged ? inScope.map((a) => <span key={a.key}>{a.email}</span>) : <><span>{account.name}</span><span>{account.email}</span></>}
          </span>
        }
      >
        <BaseMenu.Trigger className="account-btn" data-merged={merged || undefined} aria-label={merged ? `Accounts: ${name}, ${detail}` : `Account: ${account.name}, ${account.email}`}>
          {merged ? <AccountStack accounts={inScope} size={24} max={2} more={false} className="account-btn__stack" /> : <Avatar own name={account.name} email={account.email} photoUrl={account.photoUrl} size={32} />}
        </BaseMenu.Trigger>
      </Tooltip>
      <MenuPopup align="end" className="account-menu">
        <div className="account-menu__header">
          <Avatar own name={who.name} email={who.email} photoUrl={who.photoUrl} size={56} />
          <div className="account-menu__who">
            <span className="md-title-medium account-menu__name">{who.name}</span>
            <span className="md-body-medium account-menu__email">{who.email}</span>
            <span className="md-label-medium account-menu__source">{SOURCE_LABEL[kind]}</span>
          </div>
        </div>
        {many && <MenuSeparator />}
        {many && (
          <ScopeRow
            scope="all"
            lead={<AccountStack accounts={all} size={20} max={3} />}
            title="All inboxes"
            supporting={count(all.length)}
            unread={sum(all)}
          />
        )}
        {many &&
          circles.map((c) => (
            <CircleRow key={c.id} id={c.id} name={c.name} />
          ))}
        {many && (
          <MenuItem icon="join" onClick={openNewCircle}>
            {circles.length ? 'New circle' : 'Group accounts into a circle'}
          </MenuItem>
        )}
        {many && <MenuSeparator />}
        {many &&
          accounts.map((a) => (
            <ScopeRow
              key={a.key}
              scope={accountScope(a.email)}
              lead={<AccountAvatar account={a} size={32} />}
              title={a.label}
              supporting={a.label === a.email ? undefined : a.email}
              unread={a.unread}
            />
          ))}
        {delegated && <MenuSeparator />}
        {delegated && <DelegatedMenuGroup />}
        <MenuSeparator />
        {directory?.addAccountUrl && (
          <MenuItem icon="person_add" onClick={() => openUrl(directory.addAccountUrl!)}>
            Add another account
          </MenuItem>
        )}
        {many && (
          <MenuItem icon="manage_accounts" onClick={() => openSettings('accounts')}>
            Manage accounts and circles
          </MenuItem>
        )}
        <MenuItem icon="settings" onClick={() => openSettings('general')}>
          All settings
        </MenuItem>
        <MenuItem icon="swap_horiz" onClick={() => classicGmail()}>
          Switch to classic Gmail
        </MenuItem>
      </MenuPopup>
    </BaseMenu.Root>
  );
}

function CircleRow({ id, name }: { id: string; name: string }) {
  const members = useScopeViews(`circle:${id}`);
  return (
    <ScopeRow
      scope={`circle:${id}`}
      lead={members.length ? <AccountStack accounts={members} size={20} max={3} /> : <Icon name="join" size={20} />}
      title={name}
      supporting={members.length ? members.map((m) => m.short).join(', ') : 'No signed-in accounts'}
      unread={sum(members)}
    />
  );
}
