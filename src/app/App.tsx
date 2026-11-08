import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createBackend } from './boot';
import { BackendError, type MailBackend } from './data/backend';
import { bootAccounts, useAccounts } from './data/accounts/store';
import { queryClient } from './data/client';
import { Shell } from './features/shell/Shell';
import { BootScreen } from './features/shell/BootScreen';
import { AccountTransition } from './features/accounts/AccountTransition';
import { loadLocal } from './state/local';
import { loadSettings, useSettingsStore } from './state/settings';
import { applyStartView } from './router/useRoute';
import { ThemeProvider } from './theme/ThemeProvider';
import { useHostUiScale } from './theme/uiScale';
import { useEditor } from './features/wallpaper/editor';
import { TooltipProvider } from './ui/Tooltip';
import { SnackbarHost, snack } from './ui/Snackbar';
import { fontsReady } from './theme/fonts';
import { OnFirstOpen, preloadable, warmUp } from './warmup';

const PictureEditor = preloadable(() => import('./features/wallpaper/PictureEditor').then((m) => m.PictureEditor));

function PictureEditorHost() {
  const open = useEditor((s) => !!s.editing);
  return (
    <OnFirstOpen open={open}>
      <PictureEditor />
    </OnFirstOpen>
  );
}

type BootState = { status: 'loading' } | { status: 'ready'; backend: MailBackend } | { status: 'error'; error: BackendError };

export function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loaded = useSettingsStore((s) => s.loaded);
  const backendChoice = useSettingsStore((s) => s.settings.backend);
  // Each account, All inboxes, every circle and each narrowing of one get a fresh shell.
  const scope = useAccounts((s) => s.scope);
  const focus = useAccounts((s) => s.focus);
  useHostUiScale();

  useEffect(() => {
    void Promise.all([loadSettings(), loadLocal()]);
  }, []);

  useEffect(() => {
    if (loaded) applyStartView();
  }, [loaded]);

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    setBoot({ status: 'loading' });
    createBackend(backendChoice, useSettingsStore.getState().settings)
      .then(async ({ home, directory }) => {
        if (cancelled) return;
        // The shell's first frame waits for its fonts.
        const [{ fellBack }] = await Promise.all([bootAccounts(directory, home), fontsReady()]);
        if (cancelled) return;
        setBoot({ status: 'ready', backend: home });
        if (fellBack) snack(`Opened your inbox instead. ${fellBack}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setBoot({
          status: 'error',
          error: err instanceof BackendError ? err : new BackendError(String(err?.message ?? err), 'unknown'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [loaded, backendChoice, attempt]);

  useEffect(() => {
    if (boot.status === 'ready') warmUp();
  }, [boot.status]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          {boot.status === 'ready' ? (
            <Shell key={`${boot.backend.kind}|${scope}|${focus ?? ''}`} />
          ) : (
            <BootScreen error={boot.status === 'error' ? boot.error : undefined} onRetry={() => setAttempt((n) => n + 1)} />
          )}
          <SnackbarHost />
          <AccountTransition />
          {boot.status === 'ready' && <PictureEditorHost />}
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
