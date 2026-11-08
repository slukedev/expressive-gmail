import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useLabels, useMailSync } from '../../data/hooks';
import { useBackendKind } from '../../data/useBackendKind';
import { setHostFavicon, setHostTitle } from '../../lib/host';
import { useRoute } from '../../router/useRoute';
import { useSettings, updateSettings } from '../../state/settings';
import { useUi } from '../../state/ui';
import { ComposeDock } from '../compose/ComposeDock';
import { CommandPalette } from '../palette/CommandPalette';
import { QuickSettings } from '../settings/QuickSettings';
import { ShortcutsDialog } from '../shortcuts/ShortcutsDialog';
import { useShortcuts } from '../shortcuts/useShortcuts';
import { MainArea } from './MainArea';
import { OfflineBanner } from './OfflineBanner';
import { usePhoneChrome } from './phoneChrome';
import { NavRail } from './NavRail';
import { TopBar } from './TopBar';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { viewTitle } from '../../data/views';
import { useReminderWatcher } from '../followups/useReminderWatcher';
import { useMailWatchers } from '../../smart/useMailWatchers';
import { Fab } from '../../ui/Button';
import { newCompose } from '../compose/open';
import { Morph } from './Morph';
import { useGeminiPanel } from '../gemini/panel';
import { useGeminiFeature } from '../gemini/useGemini';
import { useAccounts } from '../../data/accounts/store';
import { useNewCircle } from '../accounts/newCircle';
import { useScopeTitle } from '../accounts/AccountBits';
import { OnFirstOpen, preloadable } from '../../warmup';
import { SettingsDialog } from '../settings/lazy';

// Opened now and then: their code loads in the warm-up. The command palette stays in: keys pressed before its code arrived would be lost, or run as list shortcuts.
const Onboarding = preloadable(() => import('../onboarding/Onboarding').then((m) => m.Onboarding));
const GeminiPanel = preloadable(() => import('../gemini/GeminiPanel').then((m) => m.GeminiPanel));

function SettingsHost() {
  // Settings also hosts the New circle dialog the account menu opens.
  const settings = useUi((s) => s.settingsSection !== null);
  const circle = useNewCircle((s) => s.open);
  const open = settings || circle;
  return (
    <OnFirstOpen open={open}>
      <SettingsDialog />
    </OnFirstOpen>
  );
}

function OnboardingHost() {
  const onboarded = useSettings((s) => s.onboarded);
  return (
    <OnFirstOpen open={!onboarded}>
      <Onboarding />
    </OnFirstOpen>
  );
}

/** Extended at rest, icon-only while scrolling down (Gmail Android). */
function CompactFab() {
  const [extended, setExtended] = useState(true);
  useEffect(() => {
    let last = 0;
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement;
      if (!el.classList?.contains('list-scroll')) return;
      const y = el.scrollTop;
      if (Math.abs(y - last) < 8) return;
      setExtended(y < last || y < 24);
      last = y;
    };
    document.addEventListener('scroll', onScroll, true);
    return () => document.removeEventListener('scroll', onScroll, true);
  }, []);
  return <Fab icon="edit" label="Compose" extended={extended} filledIcon className="compact-fab" onClick={() => newCompose()} />;
}

export function Shell() {
  const route = useRoute();
  const railExpanded = useSettings((s) => s.railExpanded);
  const density = useSettings((s) => s.density);
  const splits = useSettings((s) => s.splits);
  const compact = useMediaQuery('(max-width: 599px)');
  const medium = useMediaQuery('(max-width: 1023px)');
  const railOpenModal = useUi((s) => s.railOpenModal);
  const kind = useBackendKind();
  const { data: account } = useAccount();
  const { data: labels } = useLabels();
  const scopeTitle = useScopeTitle();

  useMailSync(kind === 'demo' ? 20_000 : 30_000);
  useShortcuts();
  useReminderWatcher();
  useMailWatchers();

  // "Inbox (12) - alex@example.com - Gmail", like Gmail.
  const inboxUnread = labels?.find((l) => l.id === 'INBOX')?.unreadCount ?? 0;
  useEffect(() => {
    const title = route.view.kind === 'search' ? `Search results` : viewTitle(route.view, splits);
    const count = route.view.kind === 'folder' && route.view.folder === 'inbox' && inboxUnread ? ` (${inboxUnread.toLocaleString()})` : '';
    // Merged scopes name themselves where Gmail puts the address.
    const who = scopeTitle ?? account?.email;
    setHostTitle(`${title}${count}${who ? ` - ${who}` : ''} - Gmail`);
  }, [route.view, inboxUnread, account, splits, scopeTitle]);
  useEffect(() => setHostFavicon(inboxUnread), [inboxUnread]);

  const rail = compact ? 'hidden' : medium || !railExpanded ? 'collapsed' : 'expanded';

  // The modal rail stays mounted while it animates out.
  const modalWanted = !!railOpenModal && (compact || rail === 'collapsed');
  const [modalShown, setModalShown] = useState(modalWanted);
  const [modalMore, setModalMore] = useState(false);
  if (modalWanted && !modalShown) {
    setModalShown(true);
    setModalMore(railOpenModal === 'more');
  }
  useEffect(() => {
    if (modalWanted || !modalShown) return;
    const t = window.setTimeout(() => setModalShown(false), 240);
    return () => window.clearTimeout(t);
  }, [modalWanted, modalShown]);
  const closeModal = () => useUi.getState().set({ railOpenModal: false });

  // Shell re-renders on every rail change; keep the heavy panes out of that commit.
  const main = useMemo(() => <MainArea compact={compact} />, [compact]);
  const overlays = useMemo(
    () => (
      <>
        <ComposeDock compact={compact} />
        <QuickSettings />
        <SettingsHost />
        <CommandPalette />
        <ShortcutsDialog />
        <OnboardingHost />
      </>
    ),
    [compact],
  );
  const appRef = useRef<HTMLDivElement>(null);
  usePhoneChrome(appRef, compact && !route.threadId);
  // Docked only where the list and reading pane still fit beside it.
  const dockWide = useMediaQuery('(min-width: 1600px)');
  const geminiOpen = useGeminiPanel((s) => s.open);
  const geminiShown = useGeminiFeature('chat') && geminiOpen;
  const geminiMode = compact ? 'full' : dockWide ? 'docked' : 'sheet';
  // Another scope: the chat and its sources belonged to the last one.
  const scope = useAccounts((s) => s.scope);
  useEffect(() => useGeminiPanel.getState().reset(), [scope]);

  // No custom property changes on .app here: WebKit restyles the whole subtree for one (about 20ms a toggle).
  return (
    <div
      ref={appRef}
      className="app"
      data-rail={rail}
      data-density={density}
      data-gemini={geminiShown && geminiMode === 'docked' ? 'docked' : undefined}
      data-compact={compact || undefined}
      // Phones read a conversation under its own toolbar, like Gmail Android.
      data-reading={(compact && !!route.threadId) || undefined}
    >
      <Morph
        rootRef={appRef}
        state={`${rail}|${modalShown ? (modalWanted ? 'modal' : 'closing') : ''}`}
        speed={modalShown ? 'fast' : 'default'}
      >
      {/* The rail comes first so Tab starts at its header. */}
      {!compact && (
        <NavRail
          mode={rail === 'expanded' ? 'expanded' : 'collapsed'}
          // Only the menu button changes the rail; hover, focus and Compose never do.
          onMenu={() => {
            if (medium) useUi.getState().set({ railOpenModal: !railOpenModal });
            else updateSettings({ railExpanded: !railExpanded });
          }}
        />
      )}
      <TopBar
        compact={compact}
        brand={rail === 'collapsed'}
        onMenu={() => {
          if (compact || medium) useUi.getState().set({ railOpenModal: !railOpenModal });
          else updateSettings({ railExpanded: !railExpanded });
        }}
      />
      {modalShown && (
        <NavRail mode="modal" openMore={modalMore} closing={!modalWanted} onClose={closeModal} />
      )}
      <OfflineBanner />
      {/* Morph.tsx shows these around the main area while it moves with the rail. */}
      <div className="main-move" data-side="under" aria-hidden="true" />
      {main}
      <div className="main-move" data-side="over" aria-hidden="true" />
      {geminiShown && (
        <Suspense fallback={null}>
          <GeminiPanel mode={geminiMode} />
        </Suspense>
      )}
      {compact && !route.threadId && <CompactFab />}
      {overlays}
      </Morph>
    </div>
  );
}
