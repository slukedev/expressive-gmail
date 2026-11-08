import type { MailBackend } from './data/backend';
import { BackendError } from './data/backend';
import { connectRemoteBackend } from '../shared/rpc';
import { withLocalSnooze } from './data/localSnooze';
import { singleAccountDirectory, type AccountDirectory } from './data/accounts/directory';
import { createSessionDirectory } from './data/accounts/session';
import type { Settings } from './state/settings';

const inExtension = (() => {
  const g = globalThis as unknown as { chrome?: { runtime?: { id?: string } }; browser?: { runtime?: { id?: string } } };
  return Boolean(g.browser?.runtime?.id ?? g.chrome?.runtime?.id);
})();

const embedded = typeof window !== 'undefined' && window.parent !== window;

/** The content script answers "ready" at once (it doesn't wait for Gmail), so a long wait means it's gone: fail in seconds. */
function waitForSessionPorts(timeoutMs: number): Promise<{ backend: MessagePort; accounts?: MessagePort }> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new BackendError('Gmail did not finish loading.', 'session-unavailable', true));
    }, timeoutMs);
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent || event.origin !== 'https://mail.google.com') return;
      const data = event.data as { source?: string; type?: string };
      if (data?.source !== 'better-gmail/content' || data.type !== 'port' || !event.ports[0]) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve({ backend: event.ports[0], ...(event.ports[1] ? { accounts: event.ports[1] } : {}) });
    }
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ source: 'better-gmail/app', type: 'ready' }, 'https://mail.google.com');
  });
}

export type BackendChoice = Settings['backend'];

export interface Connected {
  /** The account this tab opened with. */
  home: MailBackend;
  /** Every account the source can reach. */
  directory: AccountDirectory;
}

/** And the directory of the other accounts. */
export async function createBackend(choice: BackendChoice, settings: Settings): Promise<Connected> {
  // The demo mailbox is for development only; release builds leave it out, and a saved 'demo' choice uses the session.
  if (import.meta.env.DEV && (!inExtension || choice === 'demo')) {
    const { createDemoBackend, createDemoDirectory } = await import('./data/demo');
    const params = new URLSearchParams(window.location.search);
    const options = {
      latencyMs: params.has('latency') ? Number(params.get('latency')) : inExtension ? 150 : 250,
      empty: params.has('empty'),
      failRate: params.has('chaos') ? 0.3 : 0,
      unreadBoost: params.has('unread') ? Number(params.get('unread')) || 1234 : 0,
      contactsFail: params.get('contacts') === 'fail',
      writeLagMs: params.has('lag') ? Number(params.get('lag')) || 3000 : 0,
      noDeleteForever: params.has('nodelete'),
      noSchedule: params.get('schedule') === 'off',
      noLabelEdit: params.get('labels') === 'readonly',
      gemini: (['plan', 'smart-features', 'fail'] as const).find((m) => m === params.get('gemini')) ?? ('ready' as const),
      ...(params.has('geminiDelay') ? { geminiDelayMs: Number(params.get('geminiDelay')) || 0 } : {}),
    };
    const home = createDemoBackend(options);
    const failing = params.get('accountfail');
    return {
      home,
      directory: createDemoDirectory(home, options, {
        single: params.get('accounts') === '1',
        noDelegated: params.get('delegated') === '0',
        ...(failing === 'studio' || failing === 'makes' ? { failing } : {}),
      }),
    };
  }
  if (choice === 'api') {
    const { createApiBackend, createTokenProvider, setClientId } = await import('./data/api');
    if (settings.oauthClientId) await setClientId(settings.oauthClientId);
    const home = createApiBackend(createTokenProvider());
    return { home, directory: singleAccountDirectory(home) };
  }
  if (!embedded) {
    throw new BackendError('Open Gmail to use your account. Session mode runs inside mail.google.com.', 'session-unavailable');
  }
  const { backend: port, accounts } = await waitForSessionPorts(15_000);
  const home = withLocalSnooze(await connectRemoteBackend(port));
  return { home, directory: accounts ? createSessionDirectory(accounts, home) : singleAccountDirectory(home) };
}
