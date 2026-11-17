import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { backend, keys, queryClient } from '../../data/client';
import { useLabels } from '../../data/hooks';
import { useBackendKind, useCapabilities } from '../../data/useBackendKind';
import type { Label } from '../../data/types';
import { classicGmail, openUrl } from '../../lib/host';
import { SEED_PRESETS, labelDotColor, type SchemeVariant } from '../../theme/color';
import { CustomSeedDot, RandomSeedDot } from './ColorChoices';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { updateSettings, useSettings, useSettingsStore, type Settings, type Split, type Template } from '../../state/settings';
import { useUi } from '../../state/ui';
import { Button, IconButton, cx } from '../../ui/Button';
import { ConnectedButtonGroup } from '../../ui/ButtonGroup';
import { Dialog } from '../../ui/Dialog';
import { Select } from '../../ui/Select';
import { Icon, type IconName } from '../../ui/Icon';
import { Switch } from '../../ui/Switch';
import { snack } from '../../ui/Snackbar';
import { TextField } from '../../ui/TextField';
import { Editor } from '../compose/Editor';
import { SignatureSettings } from '../compose/SignatureSettings';
import { LabelEditor } from '../labels/LabelEditor';
import { SplitEditor } from '../splits/SplitEditor';
import { plural, stripHtml } from '../../lib/format';
import { local, useLocal } from '../../state/local';
import { AccountsSettings, NewCircleHost } from '../accounts/AccountsSettings';
import { Diagnostics } from '../../ui/Diagnostics';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { applyPictureColors, usePictureChoice } from '../wallpaper/colors';
import { keyLabel } from '../../ui/keys';
import { SidebarSettings } from './SidebarSettings';
import { UiScaleChoice } from './UiScaleChoice';
import { uiScaleAvailable } from '../../theme/uiScale';
import { captureListPlace, restoreListPlace, type ListPlace } from './listPlace';
import { highlight, matches, searchWords } from './search';
import { geminiAvailable, geminiOn, type GeminiStatus } from '../../data/gemini';
import { useGeminiStatus } from '../gemini/useGemini';
import { appFeatures, installApp, openEmailLinksHere, useAppHost } from '../../lib/appHost';
import { useAccounts } from '../../data/accounts/store';
import type { TabIcon } from '../tabicon/choice';
import { TabIconColorPicker, TabIconLookPicker } from '../tabicon/TabIconPickers';
import { tabIconsShown, useScopeInitial, useShownAccount } from '../tabicon/useTabIcon';

const SECTIONS: { id: string; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'tune' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'gemini', label: 'Gemini', icon: 'forum' },
  { id: 'accounts', label: 'Accounts', icon: 'manage_accounts' },
  { id: 'sidebar', label: 'Sidebar', icon: 'side_navigation' },
  { id: 'labels', label: 'Labels', icon: 'label' },
  { id: 'splits', label: 'Splits', icon: 'filter_alt' },
  { id: 'templates', label: 'Templates', icon: 'text_snippet' },
  { id: 'signatures', label: 'Signatures', icon: 'signature' },
  { id: 'app', label: 'App', icon: 'install_desktop' },
  { id: 'connection', label: 'Connection', icon: 'sync' },
];

/** Sections built from lists rather than rows: search finds them by what they hold. */
const SECTION_INDEX: Record<string, { description: string; keywords: string }> = {
  accounts: { description: 'Signed-in accounts, their colors, circles and All inboxes', keywords: 'account switch profile circle group all inboxes color new tab open start marker badge dot chip nickname delegated' },
  sidebar: { description: 'Reorder, hide or fold destinations under More, and choose which sections show', keywords: 'sidebar menu navigation rail folders reorder hide show more customize arrange order drawer' },
  labels: { description: 'Create, rename, recolor and hide labels', keywords: 'label folder tag color nested sublabel menu' },
  splits: { description: 'Searches saved as their own inbox tab', keywords: 'split saved search tab filter' },
  templates: { description: 'Replies you insert with a /shortcut while typing', keywords: 'template canned response snippet shortcut signature' },
  signatures: { description: 'Signatures for new mail and replies, and which address uses which', keywords: 'signature sign off footer sender from default' },
  connection: import.meta.env.DEV
    ? { description: 'Where your mail comes from: your Gmail session, the Gmail API or the demo mailbox', keywords: 'source backend api oauth session demo sign in diagnostics' }
    : { description: 'Where your mail comes from: your Gmail session or the Gmail API', keywords: 'source backend api oauth session sign in diagnostics' },
};

/** Lowercased; empty when not searching. */
const SearchWords = createContext<string[]>([]);

/** Gmail's own names for its settings tabs, for the links Gmail and its emails use. */
const GMAIL_SECTIONS: Record<string, string> = { oldthemes: 'appearance', themes: 'appearance' };

function Hit({ text }: { text: string }) {
  const words = useContext(SearchWords);
  if (!words.length) return <>{text}</>;
  return (
    <>
      {highlight(text, words).map((part, i) => (i % 2 ? <mark key={i} className="settings-hit">{part}</mark> : part))}
    </>
  );
}

export function SettingsDialog() {
  const raw = useUi((s) => s.settingsSection);
  const [asked, extra] = (raw ?? '').split(/:(.*)/s);
  const section = GMAIL_SECTIONS[asked] ?? asked;
  const open = raw !== null;
  const close = () => useUi.getState().set({ settingsSection: null });
  const [query, setQuery] = useState('');
  const words = searchWords(query);
  const searching = words.length > 0;
  const searchRef = useRef<HTMLInputElement>(null);
  const caps = useCapabilities();
  const appHost = useAppHost();
  // Labels is only for editing them. App only where the browser can install, badge or take email links.
  const sections = SECTIONS.filter((s) => (s.id !== 'labels' || caps.labelsEdit) && (s.id !== 'app' || appFeatures(appHost)));
  const current = sections.some((s) => s.id === section) ? section : 'general';
  const goTo = (id: string) => {
    setQuery('');
    useUi.getState().set({ settingsSection: id });
  };
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  // Closing after a change to what the list shows reloads it, keeping the open conversation in place.
  const place = useRef<ListPlace | null>(null);
  useEffect(() => {
    if (open) place.current ??= captureListPlace();
    else if (place.current) {
      void restoreListPlace(place.current);
      place.current = null;
    }
  }, [open]);
  // On narrow windows the sections are a scrolling row: keep the open one in view, also on mount
  // (in a portal, a few frames after opening).
  const navEl = useRef<HTMLElement | null>(null);
  const revealActive = (nav: HTMLElement | null) => {
    const row = nav?.querySelector<HTMLElement>('.settings__sections');
    const active = row?.querySelector<HTMLElement>('[data-active]');
    if (row && active && row.scrollWidth > row.clientWidth) row.scrollLeft = active.offsetLeft - row.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
  };
  const navRef = useCallback((node: HTMLElement | null) => {
    navEl.current = node;
    if (node) requestAnimationFrame(() => revealActive(node));
  }, []);
  useEffect(() => revealActive(navEl.current), [section]);

  return (
    <>
    <NewCircleHost />
    <BaseDialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="m3-scrim" forceRender />
        <BaseDialog.Popup
          className="settings"
          aria-label="Settings"
          // Also scrolls it into view in the narrow layout.
          initialFocus={() => navEl.current?.querySelector<HTMLElement>('[data-active]') ?? true}
          onKeyDown={(e) => {
            const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]');
            const find = (e.key === 'f' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing);
            if (!find) return;
            e.preventDefault();
            searchRef.current?.focus();
            searchRef.current?.select();
          }}
        >
          <header className="settings__appbar">
            <IconButton icon="close" label="Close settings" onClick={close} />
            <span className="md-title-large settings__appbar-title">Settings</span>
            <Button variant="text" onClick={() => classicGmail()}>
              Classic Gmail
            </Button>
          </header>
          <nav ref={navRef} className="settings__nav" aria-label="Settings sections">
            <BaseDialog.Title className="md-headline-small settings__title">Settings</BaseDialog.Title>
            <SettingsSearchField inputRef={searchRef} value={query} onChange={setQuery} />
            <div className="settings__sections">
              {sections.map((s) => {
                const active = !searching && current === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="settings-nav-item"
                    data-active={active || undefined}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => goTo(s.id)}
                  >
                    <Icon name={s.icon} size={24} filled={active} className="settings-nav-item__icon" />
                    <span className="settings-nav-item__label">{s.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="settings__footer">
              <button type="button" className="settings-nav-item settings-nav-item--footer" onClick={() => classicGmail()}>
                <Icon name="swap_horiz" size={24} className="settings-nav-item__icon" />
                <span className="settings-nav-item__label">Switch to classic Gmail</span>
              </button>
            </div>
          </nav>
          <div className="settings__content">
            <div className="settings__bar">
              <h2 className="md-title-large">{searching ? 'Search results' : sections.find((s) => s.id === current)?.label}</h2>
              <IconButton icon="close" label="Close settings" onClick={close} className="settings__close" />
            </div>
            {searching ? (
              <div className="settings__scroll" key="search">
                <SearchWords.Provider value={words}>
                  <SearchResults words={words} query={query.trim()} goTo={goTo} sections={sections} />
                </SearchWords.Provider>
              </div>
            ) : (
            <div className="settings__scroll" key={current}>
              <div className="settings__section">
              {current === 'general' && <General />}
              {current === 'appearance' && <Appearance focus={extra} />}
              {current === 'inbox' && <InboxSettings />}
              {current === 'gemini' && <GeminiSettings />}
              {current === 'accounts' && <AccountsSettings intent={extra} />}
              {current === 'sidebar' && <SidebarSettings />}
              {current === 'labels' && <LabelsSettings />}
              {current === 'splits' && <SplitsSettings />}
              {current === 'templates' && <TemplatesSettings fromDraft={extra} />}
              {current === 'signatures' && <SignatureSettings />}
              {current === 'app' && <AppSettings />}
              {current === 'connection' && <Connection />}
              </div>
            </div>
            )}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
    </>
  );
}

function SettingsSearchField({ inputRef, value, onChange }: { inputRef: React.RefObject<HTMLInputElement | null>; value: string; onChange: (v: string) => void }) {
  return (
    <div className="settings-search" role="search">
      <Icon name="search" size={24} className="settings-search__icon" />
      <input
        ref={inputRef}
        type="search"
        className="settings-search__input"
        placeholder="Search settings"
        aria-label="Search settings"
        aria-keyshortcuts="/"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.preventDefault();
            e.stopPropagation();
            onChange('');
          }
        }}
      />
      {value && (
        <IconButton
          icon="close"
          label="Clear search"
          size="xs"
          className="settings-search__clear"
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Each row hides itself unless it matches, so the results are the real controls. List sections show as links. */
function SearchResults({ words, query, goTo, sections }: { words: string[]; query: string; goTo: (id: string) => void; sections: typeof SECTIONS }) {
  const jumps = sections.filter((s) => SECTION_INDEX[s.id] && matches(words, s.label, SECTION_INDEX[s.id].description, SECTION_INDEX[s.id].keywords));
  const classic = matches(words, 'Switch to classic Gmail old original turn off disable');
  return (
    <div className="settings-results" aria-live="polite">
      <section className="settings-results__group" aria-label="General">
        <h3 className="md-label-large settings-results__head">General</h3>
        <General />
      </section>
      <section className="settings-results__group" aria-label="Appearance">
        <h3 className="md-label-large settings-results__head">Appearance</h3>
        <Appearance />
      </section>
      <section className="settings-results__group" aria-label="Inbox">
        <h3 className="md-label-large settings-results__head">Inbox</h3>
        <InboxSettings />
      </section>
      <section className="settings-results__group" aria-label="Gemini">
        <h3 className="md-label-large settings-results__head">Gemini</h3>
        <GeminiSettings />
      </section>
      {sections.some((s) => s.id === 'app') && (
        <section className="settings-results__group" aria-label="App">
          <h3 className="md-label-large settings-results__head">App</h3>
          <AppSettings />
        </section>
      )}
      {(jumps.length > 0 || classic) && (
        <section className="settings-results__group" aria-label="Other sections">
          <h3 className="md-label-large settings-results__head">Sections</h3>
          <div className="settings-group">
            {jumps.map((s) => (
              <button key={s.id} type="button" className="setting-row settings-jump" onClick={() => goTo(s.id)}>
                <Icon name={s.icon} size={24} className="settings-jump__icon" />
                <span className="setting-row__text">
                  <span className="md-body-large"><Hit text={s.label} /></span>
                  <span className="md-body-medium setting-row__desc"><Hit text={SECTION_INDEX[s.id].description} /></span>
                </span>
                <Icon name="chevron_right" size={24} />
              </button>
            ))}
            {classic && (
              <button type="button" className="setting-row settings-jump" onClick={() => classicGmail()}>
                <Icon name="swap_horiz" size={24} className="settings-jump__icon" />
                <span className="setting-row__text">
                  <span className="md-body-large"><Hit text="Switch to classic Gmail" /></span>
                  <span className="md-body-medium setting-row__desc">Gmail's usual look, with a button to come back here</span>
                </span>
                <Icon name="chevron_right" size={24} />
              </button>
            )}
          </div>
        </section>
      )}
      <div className="settings-results__empty">
        <Icon name="search_off" size={32} />
        <p className="md-body-large">No settings match “{query}”</p>
        <p className="md-body-medium">Try a shorter word, like “dark” or “undo”.</p>
      </div>
    </div>
  );
}

function Row({ title, description, keywords, children }: { title: string; description?: string; keywords?: string; children: ReactNode }) {
  const words = useContext(SearchWords);
  if (words.length && !matches(words, title, description, keywords)) return null;
  return (
    <div className="setting-row">
      <div className="setting-row__text">
        <span className="md-body-large"><Hit text={title} /></span>
        {description && <span className="md-body-medium setting-row__desc"><Hit text={description} /></span>}
      </div>
      <div className="setting-row__control">{children}</div>
    </div>
  );
}

/** Its heading goes when search hides all of its rows. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-block" aria-label={title}>
      <h3 className="md-label-large settings-subhead settings-block__head">{title}</h3>
      {children}
    </section>
  );
}

function Toggle({ k, title, description, keywords, disabled }: { k: keyof Settings; title: string; description?: string; keywords?: string; disabled?: boolean }) {
  const value = useSettings((s) => s[k]) as boolean;
  return (
    <Row title={title} description={description} keywords={keywords}>
      <Switch checked={value} disabled={disabled} onCheckedChange={(v) => updateSettings({ [k]: v } as Partial<Settings>)} label={title} />
    </Row>
  );
}

function General() {
  const s = useSettings((x) => x);
  // Phones always compose full screen.
  const compact = useMediaQuery('(max-width: 599px)');
  return (
    <div className="settings-group">
      <Block title="Sending">
      <Row title="Undo send" keywords="unsend recall cancel take back">
        <Select
          align="end"
          label="Undo send"
          value={s.undoSendSeconds}
          onChange={(undoSendSeconds) => updateSettings({ undoSendSeconds })}
          options={[
            [0, 'Off'],
            [5, '5 seconds'],
            [10, '10 seconds'],
            [20, '20 seconds'],
            [30, '30 seconds'],
          ]}
        />
      </Row>
      <Row title="Default reply" keywords="reply all several people">
        <ConnectedButtonGroup
          label="Default reply"
          size="xs"
          value={s.defaultReply}
          onChange={(defaultReply) => updateSettings({ defaultReply })}
          options={[
            { value: 'reply', label: 'Reply' },
            { value: 'reply-all', label: 'Reply all' },
          ]}
        />
      </Row>
      <Toggle k="sendAndArchive" title="Send and archive" keywords="reply" />
      {!compact && <Toggle k="composeFullScreen" title="Compose in full screen" keywords="maximize expand large big window new message" />}
      <Toggle
        k="attachmentReminder"
        title="Attachment reminder"
        keywords="forgot attach file"
        description="Asks before sending if your message says “attached” but has no files."
      />
      </Block>
      <Block title="After archiving or deleting">
      <Row
        title="Go to"
        keywords="after archiving deleting auto-advance next conversation"
        description="Automatic opens the next conversation with a reading pane, or goes back to the list without one."
      >
        <Select
          align="end"
          label="After archiving or deleting, go to"
          value={s.afterAction}
          onChange={(afterAction) => updateSettings({ afterAction })}
          options={[
            ['auto', 'Automatic'],
            ['older', 'Older conversation'],
            ['newer', 'Newer conversation'],
            ['list', 'Back to the list'],
          ]}
        />
      </Row>
      <Toggle
        k="advanceToUnread"
        title="Skip to unread"
        keywords="auto-advance next unread conversation classic"
        description="Opens the next unread conversation instead of the next one in the list."
        disabled={s.afterAction === 'list'}
      />
      </Block>
      <Block title="Privacy">
      <Row title="Images from senders" keywords="pictures remote load external">
        <Select
          align="end"
          label="Images from senders"
          value={s.externalImages}
          onChange={(externalImages) => updateSettings({ externalImages })}
          options={[
            ['always', 'Always show'],
            ['ask', 'Ask first'],
          ]}
        />
      </Row>
      <Toggle
        k="blockTrackers"
        title="Block email trackers"
        keywords="privacy pixels tracking spy"
        description="Removes the invisible images that tell senders when you open their email."
      />
      </Block>
      <Block title="Notifications">
      <Row
        title="New mail notifications"
        keywords="alerts desktop sound verification codes"
        description={
          notificationsSupported()
            ? 'One for each new message in your inbox. Verification codes show in the notification.'
            : "This browser doesn't let extensions show notifications from Gmail yet."
        }
      >
        <Switch
          disabled={!notificationsSupported()}
          checked={s.notifications}
          label="New mail notifications"
          onCheckedChange={async (on) => {
            if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') {
              await Notification.requestPermission().catch(() => 'denied');
            }
            if (on && typeof Notification !== 'undefined' && Notification.permission === 'denied' && !hasExtensionNotifications()) {
              snack('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
              return;
            }
            updateSettings({ notifications: on });
          }}
        />
      </Row>
      </Block>
      <Block title="Keyboard">
      <Toggle k="keyboardShortcuts" title="Keyboard shortcuts" keywords="hotkeys keys" description={`Gmail's shortcuts, plus ${keyLabel('Ctrl K')} for the command palette.`} />
      <Toggle k="arrowKeys" title="Arrow key navigation" keywords="arrows up down keyboard move scroll navigate" description="Up and Down move through mail and scroll a conversation. Enter opens or replies, Esc goes back." />
      <Row title="Custom keys" keywords="keyboard shortcuts hotkeys remap rebind change keys">
        <Button variant="tonal" icon="keyboard" onClick={() => useUi.getState().set({ shortcutsHelp: true })}>
          Change keys
        </Button>
      </Row>
      </Block>
    </div>
  );
}

function Appearance({ focus }: { focus?: string }) {
  const s = useSettings((x) => x);
  const picture = usePictureChoice();
  const scalable = uiScaleAvailable();
  return (
    <div className="settings-group">
      <Block title="Theme and color">
      <Row title="Theme" keywords="dark light mode system night appearance">
        <ConnectedButtonGroup
          label="Theme"
          size="xs"
          value={s.themeMode}
          onChange={(themeMode) => updateSettings({ themeMode })}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
      </Row>
      <Row
        title="Colors"
        keywords="material you dynamic palette accent theme picture photo"
      >
        <ConnectedButtonGroup
          label="Colors"
          size="xs"
          value={picture?.selected ? 'picture' : s.themeSource}
          onChange={(v) => (v === 'picture' ? void applyPictureColors() : updateSettings({ themeSource: v }))}
          options={[
            { value: 'google', label: 'Google' },
            { value: 'dynamic', label: 'Material You' },
            ...(picture ? [{ value: 'picture' as const, label: 'From your picture' }] : []),
          ]}
        />
      </Row>
      {s.themeSource === 'dynamic' && (
        <>
          <Row title="Base color" keywords="seed source accent theme custom own pick random shuffle surprise">
            <span className="seed-row" role="group" aria-label="Base color">
              {SEED_PRESETS.map((p) => (
                <button
                  key={p.seed}
                  type="button"
                  className="seed-dot"
                  aria-pressed={s.seed === p.seed}
                  aria-label={p.name}
                  title={p.name}
                  style={{ background: p.seed }}
                  onClick={() => updateSettings({ seed: p.seed })}
                >
                  {s.seed === p.seed && <Icon name="check" size={16} weight={500} />}
                </button>
              ))}
              <RandomSeedDot />
              <CustomSeedDot />
            </span>
          </Row>
          <Row title="Style" keywords="palette vibrant expressive tonal neutral">
            <Select
              align="end"
              label="Style"
              value={s.variant}
              onChange={(variant: SchemeVariant) => updateSettings({ variant })}
              options={[
                ['tonal-spot', 'Tonal spot'],
                ['vibrant', 'Vibrant'],
                ['expressive', 'Expressive'],
                ['neutral', 'Neutral'],
              ]}
            />
          </Row>
          <Row title="Contrast" keywords="accessibility high">
            <ConnectedButtonGroup
              label="Contrast"
              size="xs"
              value={String(s.contrast) as '0' | '0.5' | '1'}
              onChange={(v) => updateSettings({ contrast: Number(v) })}
              options={[
                { value: '0', label: 'Standard' },
                { value: '0.5', label: 'Medium' },
                { value: '1', label: 'High' },
              ]}
            />
          </Row>
        </>
      )}
      <Toggle
        k="darkEmails"
        title="Dark emails"
        keywords="dark mode night"
        description="Darkens emails that bring their own colors. Any message can switch back from its menu."
      />
      </Block>
      <Block title="Display">
        {scalable && (
          <Row title="Interface size" keywords="zoom scale bigger smaller larger text size small screen">
            <UiScaleChoice size="xs" />
          </Row>
        )}
        <Row title="Density" keywords="compact comfortable spacing rows list">
          <ConnectedButtonGroup
            label="Density"
            size="xs"
            value={s.density}
            onChange={(density) => updateSettings({ density })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'default', label: 'Default' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Row>
      </Block>
      {tabIconsShown() && <TabIconBlock focus={focus === 'tab-icon'} />}
    </div>
  );
}

// Never an address: it has no @.
const ALL_ACCOUNTS = 'all';

/** One icon for every account, and any account can have its own so its tabs stand out. */
function TabIconBlock({ focus }: { focus: boolean }) {
  const accounts = useAccounts((x) => x.accounts);
  const shown = useShownAccount();
  const global = useSettings((x) => x.tabIcon);
  const prefs = useSettings((x) => x.accountPrefs);
  const emails = accounts.map((a) => a.email.toLowerCase());
  // Opens on the icon this tab shows. With one account there's nothing to choose between; an icon it kept from before is still the one it shows.
  const [picked, setPicked] = useState(() => (shown && prefs[shown]?.tabIcon ? shown : null));
  const editing = emails.length > 1 ? (picked && emails.includes(picked) ? picked : null) : (emails.find((e) => prefs[e]?.tabIcon) ?? null);
  const own = editing ? prefs[editing]?.tabIcon : undefined;
  const icon = own ?? global;
  const initial = useScopeInitial(editing ?? shown);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'start' });
  }, [focus]);
  const change = (patch: Partial<TabIcon>) =>
    updateSettings((x) =>
      editing
        ? { accountPrefs: { ...x.accountPrefs, [editing]: { ...x.accountPrefs[editing], tabIcon: { ...(x.accountPrefs[editing]?.tabIcon ?? x.tabIcon), ...patch } } } }
        : { tabIcon: { ...x.tabIcon, ...patch } },
    );
  const setOwn = (on: boolean) => {
    if (!editing) return;
    updateSettings((x) => {
      const { tabIcon: _, ...rest } = x.accountPrefs[editing] ?? {};
      return { accountPrefs: { ...x.accountPrefs, [editing]: on ? { ...rest, tabIcon: x.tabIcon } : rest } };
    });
  };
  const keywords = 'tab icon favicon browser logo gmail original unread count number badge profile account';
  return (
    <section ref={ref} className="settings-block" aria-label="Tab icon">
      <h3 className="md-label-large settings-subhead settings-block__head">Tab icon</h3>
      {emails.length > 1 && (
        <Row title="Account" keywords={keywords}>
          <Select
            align="end"
            label="Account"
            value={editing ?? ALL_ACCOUNTS}
            onChange={(v) => setPicked(v === ALL_ACCOUNTS ? null : v)}
            options={[[ALL_ACCOUNTS, 'All accounts'], ...accounts.map((a): [string, string] => [a.email.toLowerCase(), a.email])]}
          />
        </Row>
      )}
      {emails.length > 1 && editing && (
        <Row title="Own icon" keywords={keywords}>
          <Switch checked={!!own} onCheckedChange={setOwn} label="Own icon" />
        </Row>
      )}
      {(!editing || own) && (
        <>
          <Row title="Icon" keywords={keywords}>
            <TabIconLookPicker icon={icon} initial={initial} onChange={(look) => change({ look })} />
          </Row>
          {icon.look !== 'gmail' && (
            <Row title="Color" keywords={`${keywords} color colour`}>
              <TabIconColorPicker value={icon.color} onChange={(color) => change({ color })} />
            </Row>
          )}
          <Row title="Unread count" keywords={keywords}>
            <Switch checked={icon.count} onCheckedChange={(count) => change({ count })} label="Unread count" />
          </Row>
        </>
      )}
    </section>
  );
}

/** Safari's extensions have no notifications API, and its frames can't ask for permission. */
function notificationsSupported() {
  return hasExtensionNotifications() || (typeof Notification !== 'undefined' && window.parent === window);
}

function hasExtensionNotifications() {
  const g = globalThis as unknown as { browser?: { notifications?: unknown }; chrome?: { notifications?: unknown } };
  return Boolean(g.browser?.notifications ?? g.chrome?.notifications);
}

function BlockedSenders() {
  const blocked = useLocal((x) => x.blocked);
  const words = useContext(SearchWords);
  if (words.length && !matches(words, 'Blocked senders block unblock spam', ...blocked)) return null;
  return (
    <>
      <h3 className="md-label-large settings-subhead">Blocked senders</h3>
      {blocked.length === 0 ? (
        <p className="settings-note md-body-medium">Nobody is blocked. Block a sender from a message's menu to send their mail to Spam.</p>
      ) : (
        <div className="settings-list">
          {blocked.map((email) => (
            <div key={email} className="settings-list__item">
              <Icon name="block" size={20} />
              <span className="md-body-large settings-list__name">{email}</span>
              <Button variant="text" size="xs" onClick={() => local.unblock(email)}>
                Unblock
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function InboxSettings() {
  const s = useSettings((x) => x);
  // Touch screens never show them.
  const hover = useMediaQuery('(hover: hover)');
  return (
    <div className="settings-group">
      <Block title="Start and sorting">
      <Row title="Start page" keywords="start in default open home landing all mail everything archive first view" description="Where new tabs and the Gmail logo take you.">
        <Select
          align="end"
          label="Start page"
          value={s.startView}
          onChange={(startView) => updateSettings({ startView })}
          options={[
            ['inbox', 'Inbox'],
            ['all', 'All mail'],
          ]}
        />
      </Row>
      <Row title="Inbox type" keywords="sort priority important unread starred first categories tabs promotions social updates forums">
        <Select
          align="end"
          label="Inbox type"
          value={s.inboxType}
          onChange={(inboxType) => updateSettings({ inboxType })}
          options={[
            ['categories', 'Default, with category tabs'],
            ['everything', 'Everything in one list'],
            ['important-first', 'Important first'],
            ['unread-first', 'Unread first'],
            ['starred-first', 'Starred first'],
          ]}
        />
      </Row>
      {s.inboxType === 'categories' &&
        (['promotions', 'social', 'updates', 'forums'] as const).map((c) => (
          <Row key={c} title={`${c[0].toUpperCase()}${c.slice(1)} tab`} keywords="category">
            <Switch
              checked={s.categories[c]}
              label={`${c[0].toUpperCase()}${c.slice(1)} tab`}
              onCheckedChange={(v) => updateSettings({ categories: { ...s.categories, [c]: v } })}
            />
          </Row>
        ))}
      </Block>
      <Block title="Conversation list">
      <Toggle k="showAvatars" title="Sender images" keywords="avatars photos profile pictures" />
      <Toggle k="showSnippets" title="Message previews" keywords="snippets line" />
      <Toggle k="showLabelChips" title="Label tags" keywords="labels chips in the list" />
      <Toggle k="groupByDate" title="Group by date" keywords="sections" description="Today, Yesterday, This week and earlier." />
      <Toggle k="smartFeatures" title="Smart chips and cards" keywords="verification code package tracking" description="Codes, packages, invites, bills, trips and deals, read in your browser." />
      {hover && <Toggle k="hoverActions" title="Hover actions" keywords="quick buttons" description="Archive, delete, mark read and snooze from the list." />}
      <Row title="Conversations per page" keywords="page size load scroll">
        <Select align="end" label="Conversations per page" value={s.pageSize} onChange={(pageSize) => updateSettings({ pageSize })} options={[[25, '25'], [50, '50'], [100, '100']]} />
      </Row>
      </Block>
      <Block title="Reading pane">
      <Row title="Position" keywords="reading pane split preview layout right" description="Automatic splits the window when it's wide enough.">
        <Select
          align="end"
          label="Reading pane position"
          value={s.readingPane}
          onChange={(readingPane) => updateSettings({ readingPane })}
          options={[
            ['auto', 'Automatic'],
            ['right', 'Right of inbox'],
            ['none', 'No split'],
          ]}
        />
      </Row>
      <Toggle k="glance" title="At a glance" keywords="greeting worth a look" description="Codes, deliveries, invites and bills when nothing is open." />
      </Block>
      <BlockedSenders />
    </div>
  );
}

function LabelsSettings() {
  const { data: labels = [] } = useLabels();
  const [editing, setEditing] = useState<{ open: boolean; label?: Label }>({ open: false });
  const [deleting, setDeleting] = useState<Label | null>(null);
  const dark = useResolvedDark();
  const user = labels.filter((l) => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="settings-group">
      {user.length === 0 ? (
        <p className="settings-note md-body-medium">No labels yet.</p>
      ) : (
        <p className="settings-note md-body-medium">Turn a label off to keep it on your mail but out of the menu.</p>
      )}
      <div className="settings-list">
        {user.map((l) => {
          const parts = l.name.split('/');
          const depth = parts.length - 1;
          return (
          <div key={l.id} className="settings-list__item label-setting" style={depth ? ({ '--depth': depth } as React.CSSProperties) : undefined}>
            <Icon name="label" filled size={20} className="label-setting__icon" style={l.color ? { color: labelDotColor(l.color.background, dark) } : undefined} />
            <span className="label-setting__text">
              <span className="md-body-large label-setting__name" title={l.name}>{parts[depth]}</span>
              {l.totalCount !== undefined && (
                <span className="md-body-small label-setting__meta">
                  {plural(l.totalCount, 'conversation')}
                </span>
              )}
            </span>
            <Switch
              checked={!l.hidden}
              label={`Show “${l.name}” in the menu`}
              onCheckedChange={async (show) => {
                try {
                  await backend().updateLabel(l.id, { hidden: !show });
                  void queryClient.invalidateQueries({ queryKey: keys.labels });
                } catch {
                  snack("Couldn't update the label.");
                }
              }}
            />
            <IconButton icon="edit" label={`Edit ${l.name}`} size="xs" onClick={() => setEditing({ open: true, label: l })} />
            <IconButton icon="delete" label={`Delete ${l.name}`} size="xs" onClick={() => setDeleting(l)} />
          </div>
          );
        })}
      </div>
      <Button variant="tonal" icon="new_label" onClick={() => setEditing({ open: true })}>
        Create new label
      </Button>
      <LabelEditor state={editing} onClose={() => setEditing({ open: false })} />
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="Conversations keep everything else; they just lose this label."
        actions={
          <>
            <Button variant="text" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="text"
              onClick={async () => {
                const l = deleting!;
                setDeleting(null);
                try {
                  await backend().deleteLabel(l.id);
                  void queryClient.invalidateQueries({ queryKey: keys.labels });
                  snack(`Label "${l.name}" deleted`);
                } catch {
                  snack("Couldn't delete the label.");
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

/** Back where it was, on Undo. */
function restoreAt<T extends { id: string }>(list: T[], item: T, index: number): T[] {
  if (list.some((x) => x.id === item.id)) return list;
  return [...list.slice(0, index), item, ...list.slice(index)];
}

function deleteSplit(split: Split) {
  const index = useSettingsStore.getState().settings.splits.findIndex((x) => x.id === split.id);
  updateSettings((s) => ({ splits: s.splits.filter((x) => x.id !== split.id) }));
  snack(`Split "${split.name}" deleted`, { action: { label: 'Undo', onClick: () => updateSettings((s) => ({ splits: restoreAt(s.splits, split, index) })) } });
}

function deleteTemplate(template: Template) {
  const index = useSettingsStore.getState().settings.templates.findIndex((x) => x.id === template.id);
  updateSettings((s) => ({ templates: s.templates.filter((x) => x.id !== template.id) }));
  snack(`Template "${template.name}" deleted`, { action: { label: 'Undo', onClick: () => updateSettings((s) => ({ templates: restoreAt(s.templates, template, index) })) } });
}

function SplitsSettings() {
  const splits = useSettings((s) => s.splits);
  const [editing, setEditing] = useState<Split | null | undefined>(undefined);
  return (
    <div className="settings-group">
      <p className="settings-note md-body-medium">Each split is a saved search, like “from:@example.com is:unread”.</p>
      <div className="settings-list">
        {splits.map((sp) => (
          <div key={sp.id} className="settings-list__item">
            <Icon name="filter_alt" size={20} />
            <span className="md-body-large settings-list__name">{sp.name}</span>
            <code className="settings-list__meta">{sp.query}</code>
            <IconButton icon="edit" label={`Edit ${sp.name}`} size="xs" onClick={() => setEditing(sp)} />
            <IconButton icon="delete" label={`Delete ${sp.name}`} size="xs" onClick={() => deleteSplit(sp)} />
          </div>
        ))}
      </div>
      <Button variant="tonal" icon="add" onClick={() => setEditing(null)}>
        New split
      </Button>
      <SplitEditor open={editing !== undefined} split={editing ?? undefined} onClose={() => setEditing(undefined)} />
    </div>
  );
}

function TemplatesSettings({ fromDraft }: { fromDraft?: string }) {
  const templates = useSettings((s) => s.templates);
  const draft = useUi((s) => (fromDraft?.startsWith('new:') ? s.composes.find((c) => c.key === fromDraft.slice(4)) : undefined));
  const [editing, setEditing] = useState<Partial<Template> | null>(null);
  useEffect(() => {
    if (draft) setEditing({ name: draft.subject || 'New template', subject: draft.subject, html: draft.html, shortcut: '' });
  }, [draft?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    const shortcut = (editing.shortcut ?? '').replace(/[^\w-]/g, '').toLowerCase();
    const clash = templates.some((t) => t.shortcut === shortcut && t.id !== editing.id);
    const valid = !!editing.name?.trim() && !!shortcut && !clash && !!stripHtml(editing.html ?? '').trim();
    return (
      <div className="settings-group form-stack">
        <TextField label="Name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
        <TextField
          label="Shortcut"
          value={shortcut}
          leadingIcon="keyboard_command_key"
          supporting={clash ? undefined : `Type /${shortcut || 'shortcut'} in a message to insert it.`}
          error={clash ? 'Another template already uses this shortcut.' : undefined}
          onChange={(e) => setEditing({ ...editing, shortcut: e.target.value })}
        />
        <TextField label="Subject (optional)" value={editing.subject ?? ''} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
        <div className="template-editor">
          <Editor initialHtml={editing.html ?? ''} label="Template text" onChange={(html) => setEditing((e) => ({ ...e!, html }))} onFiles={() => undefined} onSubmit={() => undefined} onLink={() => undefined} minHeight={160} />
        </div>
        <div className="settings-actions">
          <Button variant="text" onClick={() => setEditing(null)}>
            Cancel
          </Button>
          <Button
            variant="filled"
            disabled={!valid}
            onClick={() => {
              const t: Template = { id: editing.id ?? crypto.randomUUID().slice(0, 8), name: editing.name!.trim(), shortcut, subject: editing.subject?.trim() || undefined, html: editing.html! };
              updateSettings((s) => ({ templates: [...s.templates.filter((x) => x.id !== t.id), t] }));
              setEditing(null);
              snack(`Template "${t.name}" saved. Type /${t.shortcut} to use it.`);
            }}
          >
            Save template
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="settings-group">
      <p className="settings-note md-body-medium">In any message, type / and the shortcut to insert one.</p>
      <div className="settings-list">
        {templates.map((t) => (
          <div key={t.id} className="settings-list__item">
            <Icon name="text_snippet" size={20} />
            <span className="md-body-large settings-list__name">{t.name}</span>
            <kbd className="settings-list__meta">/{t.shortcut}</kbd>
            <IconButton icon="edit" label={`Edit ${t.name}`} size="xs" onClick={() => setEditing(t)} />
            <IconButton icon="delete" label={`Delete ${t.name}`} size="xs" onClick={() => deleteTemplate(t)} />
          </div>
        ))}
      </div>
      <Button variant="tonal" icon="add" onClick={() => setEditing({ name: '', shortcut: '', html: '' })}>
        New template
      </Button>
    </div>
  );
}

/** The preview, a plain page, shows the option. */
function hasSignInApi() {
  if (import.meta.env.BROWSER === 'safari') return false;
  const ext = (globalThis as { browser?: { runtime?: { id?: string }; identity?: unknown } }).browser;
  return !ext?.runtime?.id || !!ext.identity;
}

/** The installed app. Each row shows only where this browser offers it. */
function AppSettings() {
  const host = useAppHost();
  const badge = useSettings((s) => s.appBadge);
  const [installing, setInstalling] = useState(false);
  const install = async () => {
    setInstalling(true);
    const outcome = await installApp();
    setInstalling(false);
    if (outcome === 'unavailable') snack('Install it from your browser’s menu instead.');
  };
  return (
    <div className="settings-group">
      {((host.installable && !host.standalone) || host.badge) && (
        <Block title="Window and icon">
          {host.installable && !host.standalone && (
            <Row title="Install app" description="Its own window, with unread mail on its icon." keywords="pwa install desktop window dock taskbar launcher standalone progressive web app">
              <Button variant="tonal" icon="install_desktop" disabled={installing} onClick={() => void install()}>
                Install
              </Button>
            </Row>
          )}
          {host.badge && (
            <Row title="Icon badge" keywords="app badge unread count dot dock taskbar icon number">
              <Select
                align="end"
                label="Icon badge"
                value={badge}
                onChange={(appBadge) => updateSettings({ appBadge })}
                options={[
                  ['count', 'Unread count'],
                  ['dot', 'Dot'],
                  ['off', 'Off'],
                ]}
              />
            </Row>
          )}
        </Block>
      )}
      {host.mailto && (
        <Block title="Email links">
          <Row title="Open email links here" description="Email addresses on other sites start a new message here." keywords="mailto default mail app handler protocol links">
            <Button
              variant="tonal"
              icon="mail"
              onClick={async () => {
                if (await openEmailLinksHere()) snack('Confirm in your browser to finish.');
                else snack('Your browser didn’t allow it. Try again.');
              }}
            >
              Allow
            </Button>
          </Row>
        </Block>
      )}
    </div>
  );
}

function Connection() {
  const s = useSettings((x) => x);
  const kind = useBackendKind();
  const [clientId, setClientId] = useState(s.oauthClientId);
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try {
      const api = await import('../../data/api');
      await api.setClientId(clientId);
      await api.signIn();
      updateSettings({ oauthClientId: clientId, backend: 'api' });
      snack('Connected with the Gmail API');
    } catch (err) {
      snack(err instanceof Error ? err.message : "Couldn't sign in with Google. Try again.", { state: 'error', action: { label: 'Try again', onClick: () => void connect() } });
    } finally {
      setBusy(false);
    }
  };
  const apiRef = useRef<HTMLDivElement>(null);
  const options: { value: Settings['backend']; title: string; text: string; icon: IconName }[] = [
    { value: 'session', title: 'Your Gmail session', text: 'Works right away with the account you’re signed in to. Uses Gmail’s own internal connection, which Google can change without notice.', icon: 'mail' },
    // Safari and Firefox for Android have no extension sign-in API, so the Gmail API can't connect there.
    ...(!hasSignInApi()
      ? []
      : [{ value: 'api' as const, title: 'Gmail API', text: 'Google’s official API. Needs a free Google Cloud client ID and a one-time sign-in. Most reliable for labels, filters and drafts.', icon: 'lock' as IconName }]),
    ...(import.meta.env.DEV ? [{ value: 'demo' as const, title: 'Demo mailbox', text: 'A made-up inbox to try everything without touching your mail.', icon: 'science' as IconName }] : []),
  ];
  return (
    <div className="settings-group">
      <div className="choice-cards" role="radiogroup" aria-label="Where your mail comes from">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            // What's connected now, not the saved choice: the two differ while a source can't start.
            aria-checked={kind === o.value}
            className={cx('choice-card', kind === o.value && 'choice-card--selected')}
            onClick={() => {
              if (o.value !== 'api') return updateSettings({ backend: o.value });
              apiRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
              apiRef.current?.querySelector('input')?.focus({ preventScroll: true });
            }}
          >
            <Icon name={o.icon} size={24} className="choice-card__icon" />
            <span className="choice-card__text">
              <span className="md-title-medium">
                {o.title}
                {kind === o.value && <span className="choice-card__badge md-label-medium">In use</span>}
              </span>
              <span className="md-body-medium choice-card__desc">{o.text}</span>
            </span>
          </button>
        ))}
      </div>
      {options.some((o) => o.value === 'api') && (
        <>
          <h3 className="md-label-large settings-subhead">Set up the Gmail API</h3>
          <div className="api-setup" ref={apiRef}>
            <p className="md-body-medium api-setup__text">Create a Web application client in Google Cloud Console, paste its ID here, then sign in once.</p>
            <TextField label="OAuth client ID" value={clientId} onChange={(e) => setClientId(e.target.value.trim())} supporting="Looks like 1234-abcd.apps.googleusercontent.com" />
            <div className="settings-actions">
              <Button variant="text" icon="open_in_new" onClick={() => openUrl('https://console.cloud.google.com/apis/credentials')}>
                Open Cloud Console
              </Button>
              <Button
                variant="filled"
                disabled={!clientId || busy}
                onClick={() => void connect()}
              >
                Sign in with Google
              </Button>
            </div>
          </div>
        </>
      )}
      <Diagnostics />
    </div>
  );
}

const GEMINI_PRIVACY_URL = 'https://support.google.com/mail/answer/15604322';

function geminiState(status: GeminiStatus | undefined): string {
  if (!status) return 'Checking this account…';
  if (status.ready) return 'Ready on this account: summaries, Help me write, suggested replies and answers about your mail.';
  return {
    plan: 'Not available on this account.',
    'smart-features': 'Turn on smart features in Gmail to use it.',
    connection: 'The Gmail API connection can’t reach Gemini. It works with “Your Gmail session”.',
    page: status.detail ?? 'Gmail’s page didn’t show Gemini the way this app expects.',
  }[status.block];
}

function GeminiSettings() {
  const s = useSettings((x) => x);
  const status = useGeminiStatus();
  const on = geminiOn(s.geminiChoice, status);
  const available = geminiAvailable(status);
  return (
    <div className="settings-group">
      <Block title="Gemini in Gmail">
        <Row
          title="Gemini"
          keywords="ai assistant disable hide turn off summaries help me write"
          description={!available || on ? geminiState(status) : 'Off. No Gemini buttons, cards or suggestions anywhere, and nothing is sent to Gemini.'}
        >
          {/* Off and fixed where Gmail has no Gemini; untouched, it follows Gmail (the same setting as first-run setup). */}
          <Switch checked={on} disabled={!available} label="Gemini" onCheckedChange={(geminiChoice) => updateSettings({ geminiChoice })} />
        </Row>
      </Block>
      {on && (
        <Block title="Where it shows">
          <Row title="Summaries" keywords="summary card summarize tldr" description="Automatic shows one on long conversations.">
            <Select
              align="end"
              label="Summaries"
              value={s.geminiSummaries}
              onChange={(geminiSummaries) => updateSettings({ geminiSummaries })}
              options={[
                ['auto', 'Automatic'],
                ['ask', 'Only when I ask'],
              ]}
            />
          </Row>
          <Toggle k="geminiReplies" title="Suggested replies" keywords="smart reply quick answers" description="When off, suggestions come from simple rules." />
          <Toggle k="geminiSearch" title="Answers in search" keywords="ask gmail ai overview question" description="Searches that read as a question get Gemini’s answer above the results." />
        </Block>
      )}
      <Block title="Privacy">
        <Row title="How Gemini uses your mail" keywords="data privacy google terms" description="Gemini runs on Google’s servers under your account’s Gemini terms. This app sends nothing to any other service.">
          <Button variant="text" icon="open_in_new" onClick={() => openUrl(GEMINI_PRIVACY_URL)}>
            Learn more
          </Button>
        </Row>
      </Block>
    </div>
  );
}
