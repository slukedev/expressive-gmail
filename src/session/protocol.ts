/** Messages between the main-world token capture script and the isolated-world backend. Dependency free: it's bundled into the main-world script. */

export const MAIN_SOURCE = 'better-gmail/main';
export const ISOLATED_SOURCE = 'better-gmail/isolated';
export const PROTOCOL_VERSION = 1;

export interface SessionTokens {
  /** Path prefix of Gmail's own sync calls, e.g. "/sync/u/0". */
  syncPath?: string;
  /** UI language. */
  hl?: string;
  /** X-Framework-Xsrf-Token header. */
  xsrf?: string;
  /** X-Gmail-BTAI header (client capability blob). */
  btai?: string;
  /** X-Google-BTD header. */
  btd?: string;
  /** X-Gmail-Storage-Request header, when Gmail sends one. */
  storageRequest?: string;
  /** GLOBALS[9], the "ik" key used by /mail/u/N/?ui=2 URLs (attachments). */
  ik?: string;
  /** GLOBALS[10], the signed-in address. */
  email?: string;
  /** X-Goog-Api-Key Gmail last sent to any other Google API. Keys are restricted per API, so this is a last resort. */
  apiKey?: string;
  /** X-Goog-Api-Key Gmail sent to the People Stack service (contacts autocomplete). */
  peopleApiKey?: string;
  /**
   * The shape of Gmail's own People Stack calls, without what it asked about:
   * JSON `{"Lookup": {"client": 134, "flags": [1, 2]}, "Autocomplete": {...}}`.
   */
  peopleStack?: string;
  capturedAt: number;
}

export interface SessionTokensMessage {
  source: typeof MAIN_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'session-tokens';
  tokens: SessionTokens;
}

export interface RequestTokensMessage {
  source: typeof ISOLATED_SOURCE;
  version: typeof PROTOCOL_VERSION;
  type: 'request-tokens';
}

const TOKEN_KEYS = ['syncPath', 'hl', 'xsrf', 'btai', 'btd', 'storageRequest', 'ik', 'email', 'apiKey', 'peopleApiKey', 'peopleStack'] as const;

export function isSessionTokensMessage(data: unknown): data is SessionTokensMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Partial<SessionTokensMessage>;
  if (msg.source !== MAIN_SOURCE || msg.version !== PROTOCOL_VERSION || msg.type !== 'session-tokens') return false;
  const tokens = msg.tokens as unknown as Record<string, unknown> | undefined;
  if (!tokens || typeof tokens !== 'object' || typeof tokens.capturedAt !== 'number') return false;
  return TOKEN_KEYS.every((key) => tokens[key] === undefined || typeof tokens[key] === 'string');
}

export function isRequestTokensMessage(data: unknown): data is RequestTokensMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as Partial<RequestTokensMessage>;
  return msg.source === ISOLATED_SOURCE && msg.version === PROTOCOL_VERSION && msg.type === 'request-tokens';
}
