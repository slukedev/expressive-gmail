import { BackendError } from '../app/data/backend';
import type { SessionTokens } from './protocol';
import { isReady, type ReadySession, type TokenSource } from './session';

/** Each account's page saves its session (the headers Gmail's sync calls carry) to extension storage, so a page signed in as one account can read another's mail with the same requests. Stays on this device. */
export const SESSIONS_KEY = 'bg.sessions';

export type StoredSessions = Record<string, SessionTokens>;

const norm = (email: string) => email.trim().toLowerCase();
const SESSION_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** What a sync call needs, nothing that only describes the page. */
function sessionToStore(tokens: SessionTokens | undefined): (SessionTokens & { email: string }) | undefined {
  if (!isReady(tokens) || !tokens.email) return undefined;
  const { syncPath, hl, xsrf, btai, btd, storageRequest, ik, email, apiKey, peopleApiKey, capturedAt } = tokens;
  return { syncPath, hl, xsrf, btai, btd, storageRequest, ik, email, apiKey, peopleApiKey, capturedAt };
}

/** The same object when nothing changed. */
export function withSession(sessions: StoredSessions | undefined, tokens: SessionTokens | undefined): StoredSessions | undefined {
  const next = sessionToStore(tokens);
  if (!next) return undefined;
  const key = norm(next.email);
  const prev = sessions?.[key];
  if (prev && prev.xsrf === next.xsrf && prev.btai === next.btai && prev.syncPath === next.syncPath && prev.ik === next.ik) return undefined;
  // Sessions not opened for weeks are long expired.
  const kept = Object.fromEntries(Object.entries(sessions ?? {}).filter(([, t]) => next.capturedAt - (t.capturedAt ?? 0) < SESSION_KEEP_MS));
  return { ...kept, [key]: next };
}

/** The slot comes from the live account list, not the saved path: slots shift when someone signs out, and Google refuses a session sent to the wrong slot. */
export function storedTokenSource(email: string, index: number, read: () => Promise<StoredSessions | undefined>, initial?: SessionTokens): TokenSource {
  let tokens = initial ? { ...initial, syncPath: `/sync/u/${index}` } : undefined;
  const missing = () =>
    new BackendError(`Open ${email} once in this browser so Expressive Gmail can read it from here.`, 'unauthenticated');
  const reload = async () => {
    const saved = (await read().catch(() => undefined))?.[norm(email)];
    if (saved) tokens = { ...saved, syncPath: `/sync/u/${index}` };
    return tokens;
  };
  return {
    current: () => tokens,
    refresh: () => void reload(),
    async waitUntilReady(_timeoutMs: number, newerThan = 0): Promise<ReadySession> {
      const fresh = isReady(tokens) && tokens.capturedAt > newerThan ? tokens : await reload();
      if (isReady(fresh) && fresh.capturedAt > newerThan) return fresh;
      throw missing();
    },
  };
}
