import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { accountScope, ACCOUNT_COLORS, accountShortLabel, useAccounts } from '../../data/accounts/store';
import { openUrl } from '../../lib/host';
import { updateSettings, useSettings, type AccountMarker, type Circle, type StartScope } from '../../state/settings';
import { labelDotColor } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Button, IconButton } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Chip } from '../../ui/Chip';
import { Dialog } from '../../ui/Dialog';
import { Icon } from '../../ui/Icon';
import { Select } from '../../ui/Select';
import { snack } from '../../ui/Snackbar';
import { Switch } from '../../ui/Switch';
import { TextField } from '../../ui/TextField';
import { AccountAvatar, AccountStack, useAccountViews, type AccountView } from './AccountBits';
import { switchScope } from './switch';
import { useBackendKind } from '../../data/useBackendKind';
import { useUi } from '../../state/ui';
import { closeNewCircle, useNewCircle } from './newCircle';
import { DelegatedSettings } from './Delegated';

const MARKERS: [AccountMarker, string][] = [
  ['badge', 'Account photo on the sender'],
  ['chip', 'Chip with the account name'],
  ['dot', 'Color dot'],
  ['off', "Don't show"],
];

const CIRCLE_IDEAS = ['Work', 'Personal', 'Side projects', 'School', 'Family'];

const norm = (email: string) => email.trim().toLowerCase();

function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-row__text">
        <span className="md-body-large">{title}</span>
        {description && <span className="md-body-medium setting-row__desc">{description}</span>}
      </div>
      <div className="setting-row__control">{children}</div>
    </div>
  );
}

export function AccountsSettings({ intent }: { intent?: string }) {
  const accounts = useAccountViews();
  const circles = useSettings((s) => s.circles);
  const startScope = useSettings((s) => s.startScope);
  const marker = useSettings((s) => s.accountMarker);
  const prefs = useSettings((s) => s.accountPrefs);
  const directory = useAccounts((s) => s.directory);
  const kind = useBackendKind();
  const [editingAccount, setEditingAccount] = useState<AccountView | null>(null);
  const [editingCircle, setEditingCircle] = useState<Circle | null | undefined>(intent === 'new-circle' ? null : undefined);
  const [deleting, setDeleting] = useState<Circle | null>(null);

  if (accounts.length < 2) {
    return (
      <div className="settings-group">
        <div className="accounts-empty">
          <Icon name="join" size={32} className="accounts-empty__icon" />
          {kind === 'api' ? (
            <>
              <p className="md-title-medium">The Gmail API connects one account</p>
              <p className="md-body-medium accounts-empty__text">
                To switch between accounts, read them together in All inboxes and group them into circles, connect through your Gmail session instead.
              </p>
              <Button variant="tonal" icon="sync" onClick={() => useUi.getState().set({ settingsSection: 'connection' })}>
                Change connection
              </Button>
            </>
          ) : (
            <>
              <p className="md-title-medium">One account is signed in</p>
              <p className="md-body-medium accounts-empty__text">
                Sign in to another Google account in this browser to switch between them here, read them together in All inboxes and group them into circles.
              </p>
            </>
          )}
          {directory?.addAccountUrl && (
            <Button variant="tonal" icon="person_add" onClick={() => openUrl(directory.addAccountUrl!)}>
              Add another account
            </Button>
          )}
        </div>
        <DelegatedSettings />
      </div>
    );
  }

  const startOptions: [string, string][] = [
    ['home', "This tab's account"],
    ['all', 'All inboxes'],
    ...circles.map((c): [string, string] => [`circle:${c.id}`, c.name]),
  ];
  const inAll = accounts.filter((a) => !prefs[norm(a.email)]?.hideFromAll).length;

  return (
    <div className="settings-group">
      <SettingRow title="Open Gmail in" description="Where a new Gmail tab starts. Each tab remembers where you left it when you reload.">
        <Select<string> align="end" label="Open Gmail in" value={startScope} onChange={(v) => updateSettings({ startScope: v as StartScope })} options={startOptions} />
      </SettingRow>
      <SettingRow title="Show the account on conversations" description="In All inboxes and circles, so you can tell at a glance which inbox a conversation is in.">
        <Select<AccountMarker> align="end" label="Show the account on conversations" value={marker} onChange={(accountMarker) => updateSettings({ accountMarker })} options={MARKERS} />
      </SettingRow>

      <h3 className="md-label-large settings-subhead">Accounts</h3>
      <div className="settings-list">
        {accounts.map((a) => {
          const shown = !prefs[norm(a.email)]?.hideFromAll;
          return (
            <div key={a.key} className="settings-list__item account-setting">
              <AccountAvatar account={a} size={32} />
              <span className="account-setting__text">
                <span className="md-body-large account-setting__name">
                  <span className="account-setting__label">{a.label}</span>
                  {a.home && <span className="md-label-small account-setting__tag">This tab</span>}
                  {!shown && <span className="md-label-small account-setting__tag account-setting__tag--muted">Not in All inboxes</span>}
                </span>
                <span className="md-body-medium account-setting__email">{a.email}</span>
              </span>
              {a.unread ? <span className="md-label-large account-setting__count">{a.unread.toLocaleString()} unread</span> : null}
              <IconButton icon="edit" label={`Edit ${a.email}`} size="s" onClick={() => setEditingAccount(a)} />
            </div>
          );
        })}
      </div>
      {directory?.addAccountUrl && (
        <Button variant="text" icon="person_add" onClick={() => openUrl(directory.addAccountUrl!)}>
          Add another account
        </Button>
      )}
      <DelegatedSettings />

      <h3 className="md-label-large settings-subhead">Circles</h3>
      <p className="settings-note md-body-medium">A circle reads a few of your accounts as one inbox, like Work for your job and your freelance address.</p>
      {circles.length > 0 && (
        <div className="settings-list">
          {circles.map((c) => {
            const members = c.members.flatMap((e) => accounts.filter((a) => norm(a.email) === e));
            return (
              <div key={c.id} className="settings-list__item account-setting">
                {members.length ? <AccountStack accounts={members} size={24} className="account-setting__stack" /> : <Icon name="join" size={24} />}
                <span className="account-setting__text">
                  <span className="md-body-large account-setting__name">
                    <span className="account-setting__label">{c.name}</span>
                    {startScope === `circle:${c.id}` && <span className="md-label-small account-setting__tag">Opens first</span>}
                  </span>
                  <span className="md-body-medium account-setting__email">{members.length ? members.map((m) => m.short).join(', ') : 'None of its accounts are signed in'}</span>
                </span>
                <IconButton icon="edit" label={`Edit the ${c.name} circle`} size="s" onClick={() => setEditingCircle(c)} />
                <IconButton icon="delete" label={`Delete the ${c.name} circle`} size="s" onClick={() => setDeleting(c)} />
              </div>
            );
          })}
        </div>
      )}
      <Button variant="tonal" icon="join" onClick={() => setEditingCircle(null)}>
        New circle
      </Button>

      <AccountEditor account={editingAccount} lastInAll={inAll <= 1} onClose={() => setEditingAccount(null)} />
      <CircleEditor open={editingCircle !== undefined} circle={editingCircle ?? undefined} onClose={() => setEditingCircle(undefined)} />
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete the ${deleting?.name} circle?`}
        description="Its accounts and their mail stay exactly as they are."
        actions={
          <>
            <Button variant="text" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="text" onClick={() => deleteCircle(deleting!, () => setDeleting(null))}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

function deleteCircle(circle: Circle, done: () => void) {
  const scope = `circle:${circle.id}` as const;
  updateSettings((s) => ({
    circles: s.circles.filter((c) => c.id !== circle.id),
    ...(s.startScope === scope ? { startScope: 'home' as const } : {}),
  }));
  done();
  const { scope: current, accounts } = useAccounts.getState();
  // Reading the circle right now: fall back to this tab's account.
  if (current === scope) {
    const home = accounts.find((a) => a.home) ?? accounts[0];
    if (home) void switchScope(accountScope(home.email));
  }
  snack(`Deleted the ${circle.name} circle`);
}

function Swatches({ value, onChange, legend }: { value: string; onChange: (hex: string) => void; legend: string }) {
  const dark = useResolvedDark();
  return (
    <fieldset className="swatches">
      <legend className="md-body-small">{legend}</legend>
      {ACCOUNT_COLORS.map((c) => {
        // The color as rows show it (badge, dot, ring), not the pale chip tone.
        const tone = { bg: labelDotColor(c, dark), fg: dark ? '#1f1f1f' : '#ffffff' };
        return (
          <button
            key={c}
            type="button"
            className="swatch"
            aria-pressed={value === c}
            aria-label={`Color ${ACCOUNT_COLOR_NAMES[c] ?? c}`}
            style={{ background: tone.bg, color: tone.fg }}
            onClick={() => onChange(c)}
          >
            {value === c && <Icon name="check" size={18} weight={500} />}
          </button>
        );
      })}
    </fieldset>
  );
}

const ACCOUNT_COLOR_NAMES: Record<string, string> = {
  '#4a86e8': 'blue',
  '#16a766': 'green',
  '#e07798': 'pink',
  '#ffad47': 'orange',
  '#a479e2': 'purple',
  '#2da2bb': 'teal',
  '#e66550': 'red',
  '#a46a21': 'brown',
};

function AccountEditor({ account, lastInAll, onClose }: { account: AccountView | null; lastInAll: boolean; onClose: () => void }) {
  const accounts = useAccounts((s) => s.accounts);
  const prefs = useSettings((s) => s.accountPrefs);
  const [nickname, setNickname] = useState('');
  const [color, setColor] = useState(ACCOUNT_COLORS[0]!);
  const [inAll, setInAll] = useState(true);
  useEffect(() => {
    if (!account) return;
    const p = prefs[norm(account.email)];
    setNickname(p?.nickname ?? '');
    setColor(p?.color ?? ACCOUNT_COLORS[account.index % ACCOUNT_COLORS.length]!);
    setInAll(!p?.hideFromAll);
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps
  const fallback = account ? accountShortLabel(account, accounts, { accountPrefs: {} }) : '';
  // All inboxes always reads at least one account.
  const locked = inAll && lastInAll && !prefs[norm(account?.email ?? '')]?.hideFromAll;
  const save = () => {
    if (!account) return;
    const key = norm(account.email);
    updateSettings((s) => ({
      accountPrefs: { ...s.accountPrefs, [key]: { ...s.accountPrefs[key], nickname: nickname.trim() || undefined, color, hideFromAll: inAll ? undefined : true } },
    }));
    onClose();
  };
  return (
    <Dialog
      open={!!account}
      onOpenChange={(o) => !o && onClose()}
      title="Edit account"
      description={account?.email}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="text" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField
          label="Nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={fallback}
          maxLength={24}
          supporting={`Shown on conversations in All inboxes and circles. Leave it empty to use “${fallback}”.`}
          autoFocus
        />
        <Swatches legend="Color" value={color} onChange={setColor} />
        <label className="circle-start">
          <span className="circle-start__text">
            <span className="md-body-large">Show in All inboxes</span>
            <span className="md-body-medium circle-start__desc">
              {locked ? 'All inboxes needs at least one account.' : "When it's off, this account's mail stays out of All inboxes. Its circles still show it."}
            </span>
          </span>
          <Switch checked={inAll} disabled={locked} onCheckedChange={setInAll} label="Show in All inboxes" />
        </label>
      </form>
    </Dialog>
  );
}

/** The dialog alone, without Settings behind it. */
export function NewCircleHost() {
  const open = useNewCircle((s) => s.open);
  return <CircleEditor open={open} onClose={closeNewCircle} />;
}

function CircleEditor({ open, circle, onClose }: { open: boolean; circle?: Circle; onClose: () => void }) {
  const accounts = useAccountViews();
  const circles = useSettings((s) => s.circles);
  const startScope = useSettings((s) => s.startScope);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [color, setColor] = useState(ACCOUNT_COLORS[0]!);
  const [opensFirst, setOpensFirst] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(circle?.name ?? '');
    setMembers(circle?.members ?? []);
    setColor(circle?.color ?? ACCOUNT_COLORS[(circles.length + 3) % ACCOUNT_COLORS.length]!);
    setOpensFirst(!!circle && startScope === `circle:${circle.id}`);
    setTried(false);
  }, [open, circle]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = name.trim();
  const duplicate = circles.some((c) => c.id !== circle?.id && c.name.toLowerCase() === trimmed.toLowerCase());
  const nameError = tried && !trimmed ? 'Give the circle a name.' : duplicate ? 'You already have a circle with this name.' : undefined;
  const membersError = tried && members.length < 2 ? 'Pick at least two accounts.' : undefined;
  const ideas = useMemo(() => CIRCLE_IDEAS.filter((i) => !circles.some((c) => c.name.toLowerCase() === i.toLowerCase())).slice(0, 4), [circles]);

  const toggle = (email: string, on: boolean) => {
    const e = norm(email);
    setMembers((m) => (on ? [...m.filter((x) => x !== e), e] : m.filter((x) => x !== e)));
  };

  const save = () => {
    setTried(true);
    if (!trimmed || duplicate || members.length < 2) return;
    const next: Circle = { id: circle?.id ?? crypto.randomUUID().slice(0, 8), name: trimmed, members, color };
    const scope = `circle:${next.id}` as const;
    updateSettings((s) => ({
      circles: circle ? s.circles.map((c) => (c.id === next.id ? next : c)) : [...s.circles, next],
      ...(opensFirst ? { startScope: scope } : s.startScope === scope ? { startScope: 'home' as const } : {}),
    }));
    onClose();
    const current = useAccounts.getState().scope;
    if (current === scope) {
      snack(`Saved. Reload to see the ${next.name} circle's new accounts.`);
    } else {
      snack(circle ? `Saved the ${next.name} circle` : `Created the ${next.name} circle`, {
        action: { label: 'Open', onClick: () => void switchScope(scope) },
      });
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={circle ? 'Edit circle' : 'New circle'}
      description="Read these accounts together as one inbox."
      size="medium"
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="text" onClick={save}>
            {circle ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} error={nameError} autoFocus={!circle} />
        {!circle && !trimmed && ideas.length > 0 && (
          <div className="idea-chips" aria-label="Name ideas">
            {ideas.map((idea) => (
              <Chip key={idea} kind="suggestion" onClick={() => setName(idea)}>
                {idea}
              </Chip>
            ))}
          </div>
        )}
        <fieldset className="circle-members">
          <legend className="md-body-small circle-members__legend">Accounts</legend>
          {accounts.map((a) => {
            const on = members.includes(norm(a.email));
            return (
              <label key={a.key} className="circle-member" data-selected={on || undefined} style={{ '--account-color': a.color } as CSSProperties}>
                <AccountAvatar account={a} size={32} />
                <span className="circle-member__text">
                  <span className="md-body-large">{a.label}</span>
                  <span className="md-body-medium circle-member__email">{a.email}</span>
                </span>
                <Checkbox checked={on} label={`Include ${a.email}`} onCheckedChange={(v) => toggle(a.email, v)} />
              </label>
            );
          })}
          {membersError && (
            <p className="md-body-small circle-members__error" role="alert">
              {membersError}
            </p>
          )}
        </fieldset>
        <label className="circle-start">
          <span className="circle-start__text">
            <span className="md-body-large">Open Gmail in this circle</span>
            <span className="md-body-medium circle-start__desc">New tabs start here instead of your own inbox.</span>
          </span>
          <Switch checked={opensFirst} onCheckedChange={setOpensFirst} label="Open Gmail in this circle" />
        </label>
        <Swatches legend="Color" value={color} onChange={setColor} />
      </form>
    </Dialog>
  );
}
