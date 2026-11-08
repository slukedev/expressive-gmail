import { Menu as BaseMenu } from '@base-ui/react/menu';
import type { DelegatedMailbox } from '../../data/accounts/directory';
import { useAccounts } from '../../data/accounts/store';
import { openUrl } from '../../lib/host';
import { Avatar } from '../../ui/Avatar';
import { IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { MenuGroupLabel } from '../../ui/Menu';

// The app can't read delegated mailboxes (its session is the signed-in account's), so each opens in Gmail.

export const delegatedLabel = (d: DelegatedMailbox) => d.name?.trim() || d.email;

export function useDelegated(): DelegatedMailbox[] {
  return useAccounts((s) => s.delegated);
}

export function DelegatedMenuGroup() {
  const delegated = useDelegated();
  if (!delegated.length) return null;
  return (
    <BaseMenu.Group aria-label="Delegated">
      <MenuGroupLabel>Delegated</MenuGroupLabel>
      {delegated.map((d) => {
        const label = delegatedLabel(d);
        return (
          <BaseMenu.Item
            key={d.url}
            className="m3-menu-item account-row"
            aria-label={`${label === d.email ? label : `${label}, ${d.email}`}, opens in a new tab`}
            onClick={() => openUrl(d.url)}
          >
            <span className="account-row__lead">
              <Avatar own name={label} email={d.email} photoUrl={d.photoUrl} size={32} />
            </span>
            <span className="m3-menu-item__text">
              <span className="m3-menu-item__label">{label}</span>
              {label !== d.email && <span className="m3-menu-item__supporting account-row__supporting">{d.email}</span>}
            </span>
            <Icon name="open_in_new" size={20} className="account-row__open" />
          </BaseMenu.Item>
        );
      })}
    </BaseMenu.Group>
  );
}

export function DelegatedSettings() {
  const delegated = useDelegated();
  if (!delegated.length) return null;
  return (
    <>
      <h3 className="md-label-large settings-subhead" id="delegated-heading">
        Delegated
      </h3>
      <ul className="settings-list delegated-list" aria-labelledby="delegated-heading">
        {delegated.map((d) => {
          const label = delegatedLabel(d);
          return (
            <li key={d.url} className="settings-list__item account-setting">
              <Avatar own name={label} email={d.email} photoUrl={d.photoUrl} size={32} />
              <span className="account-setting__text">
                <span className="md-body-large account-setting__name">
                  <span className="account-setting__label">{label}</span>
                </span>
                {label !== d.email && <span className="md-body-medium account-setting__email">{d.email}</span>}
              </span>
              <IconButton icon="open_in_new" label={`Open ${label} in a new tab`} size="s" onClick={() => openUrl(d.url)} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
