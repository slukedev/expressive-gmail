import {
  MAIN_SOURCE,
  PROTOCOL_VERSION,
  isRequestTokensMessage,
  type SessionTokens,
  type SessionTokensMessage,
} from './protocol';
import { probeBody, probePath, type ProbeRecord } from './photoProbe';
import { desktopUserAgent, isPhone } from '../shared/mobile';

/** Copies what Gmail's JS uses to call its sync API (GLOBALS ik/email and the headers on /sync/ requests) to the isolated world. Requests pass untouched and every hook is wrapped so a failure can't break Gmail (as InboxSDK's setup-gmail-interceptor does). */

type TokenField = Exclude<keyof SessionTokens, 'capturedAt'>;

const SYNC_HEADERS: Record<string, TokenField> = {
  'x-framework-xsrf-token': 'xsrf',
  'x-gmail-btai': 'btai',
  'x-google-btd': 'btd',
  'x-gmail-storage-request': 'storageRequest',
};

const INSTALLED = Symbol.for('better-gmail.main-hooks');

export function installMainHooks() {
  const w = window as unknown as Record<symbol, unknown>;
  if (w[INSTALLED]) return;
  w[INSTALLED] = true;

  // A phone asked for desktop Gmail (src/shared/mobile.ts); its scripts should see the browser its server did. The mobile client (/mail/mu/) is left alone.
  if (isPhone(navigator.userAgent) && /^\/mail\/(u\/|$)/.test(location.pathname)) safely(presentAsDesktop);

  const tokens: SessionTokens = { capturedAt: 0 };
  let pending = false;

  const publish = () => {
    pending = false;
    const message: SessionTokensMessage = {
      source: MAIN_SOURCE,
      version: PROTOCOL_VERSION,
      type: 'session-tokens',
      tokens: { ...tokens },
    };
    window.postMessage(message, location.origin);
  };

  const set = (field: TokenField, value: unknown) => {
    if (typeof value !== 'string' || !value || tokens[field] === value) return;
    tokens[field] = value;
    tokens.capturedAt = Date.now();
    if (!pending) {
      pending = true;
      setTimeout(() => safely(publish), 0);
    }
  };

  const shapes: Record<string, { client: number; flags: number[] }> = {};
  const onRequest = (rawUrl: string, header: (name: string) => string | null | undefined, body?: unknown) => {
    const url = new URL(rawUrl, location.href);
    if (url.origin === location.origin) {
      const match = /^(\/sync(?:\/[^?#]*?)?)\/i\/[a-z]+$/.exec(url.pathname);
      if (!match) return;
      set('syncPath', match[1]);
      set('hl', url.searchParams.get('hl'));
      for (const [name, field] of Object.entries(SYNC_HEADERS)) set(field, header(name));
    } else if (/(^|\.)google(apis)?\.com$/.test(url.hostname)) {
      // Google API keys are restricted per API, so keep the People Stack one apart.
      const key = header('x-goog-api-key') ?? url.searchParams.get('key');
      const peopleStack = /^peoplestack-pa\./.test(url.hostname);
      set(peopleStack ? 'peopleApiKey' : 'apiKey', key);
      // How Gmail calls People Stack, so the backend's calls match if Google changes them.
      const method = /\/peoplestack\.PeopleStackAutocompleteService\/(Lookup|Autocomplete)$/.exec(url.pathname)?.[1];
      const shape = peopleStack && method ? peopleStackShape(method, body) : undefined;
      if (method && shape && JSON.stringify(shapes[method]) !== JSON.stringify(shape)) {
        shapes[method] = shape;
        set('peopleStack', JSON.stringify(shapes));
      }
    }
  };

  // For Connection details > Photos. A short window, few records.
  let probed = 0;
  const probeStarted = Date.now();
  const onResponse = (rawUrl: string, text: string) => {
    if (probed >= 40 || Date.now() - probeStarted > 20 * 60_000 || text.length < 200) return;
    const url = new URL(rawUrl, location.href);
    if (!/(^|\.)google(apis|usercontent)?\.com$/.test(url.hostname)) return;
    const records: ProbeRecord[] = probeBody(probePath(url.href), text);
    if (!records.length) return;
    probed += records.length;
    window.postMessage({ source: MAIN_SOURCE, version: PROTOCOL_VERSION, type: 'photo-probe', records }, location.origin);
  };

  hookXhr(onRequest, onResponse);
  hookFetch(onRequest, onResponse);
  watchGlobals(set);

  window.addEventListener('message', (event) => {
    if (event.source === window && isRequestTokensMessage(event.data)) safely(publish);
  });
}

type RequestListener = (url: string, header: (name: string) => string | null | undefined, body?: unknown) => void;
type ResponseListener = (url: string, text: string) => void;

/**
 * The client id and flags of a People Stack body, nothing it asked about:
 * Lookup is `[client, flags, targets]`, Autocomplete `[client, query, flags, max]`.
 */
function peopleStackShape(method: string, body: unknown): { client: number; flags: number[] } | undefined {
  if (typeof body !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const client = parsed[0];
  const flags = parsed[method === 'Lookup' ? 1 : 2];
  if (typeof client !== 'number' || !Array.isArray(flags) || !flags.every((f) => typeof f === 'number')) return undefined;
  return { client, flags: flags as number[] };
}

function hookXhr(onRequest: RequestListener, onResponse: ResponseListener) {
  const proto = XMLHttpRequest.prototype;
  const urls = new WeakMap<XMLHttpRequest, string>();
  const headers = new WeakMap<XMLHttpRequest, Map<string, string>>();
  const open = proto.open;
  const setRequestHeader = proto.setRequestHeader;
  const send = proto.send;

  proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    safely(() => {
      urls.set(this, String(args[1]));
      headers.set(this, new Map());
    });
    return (open as (...a: unknown[]) => void).apply(this, args);
  } as typeof proto.open;

  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    safely(() => headers.get(this)?.set(name.toLowerCase(), value));
    return setRequestHeader.call(this, name, value);
  };

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    safely(() => {
      const url = urls.get(this);
      const sent = headers.get(this);
      if (url && sent) onRequest(url, (name) => sent.get(name), body);
      if (url) {
        this.addEventListener('load', () =>
          safely(() => {
            if (this.responseType === '' || this.responseType === 'text') onResponse(url, this.responseText);
          }),
        );
      }
    });
    return send.call(this, body);
  };
}

function hookFetch(onRequest: RequestListener, onResponse: ResponseListener) {
  const original = window.fetch;
  if (typeof original !== 'function') return;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    safely(() => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const source = init?.headers ?? (input instanceof Request ? input.headers : undefined);
      const read = new Headers(source);
      onRequest(url, (name) => read.get(name), init?.body);
    });
    const pending = original.call(this, input, init);
    safely(() => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      void pending
        .then((res) => {
          if (/json|text|javascript|protobuf/.test(res.headers.get('content-type') ?? '')) return res.clone().text().then((text) => onResponse(url, text));
        })
        .catch(() => undefined);
    });
    return pending;
  } as typeof window.fetch;
}

/** GLOBALS is an inline script array Gmail defines early: [9] ik, [10] signed-in address. */
function watchGlobals(set: (field: TokenField, value: unknown) => void) {
  const started = Date.now();
  const timer = setInterval(() => {
    safely(() => {
      const w = window as unknown as { GLOBALS?: unknown; GM_ID_KEY?: unknown };
      const globals = Array.isArray(w.GLOBALS) ? (w.GLOBALS as unknown[]) : undefined;
      set('ik', globals?.[9] ?? w.GM_ID_KEY);
      set('email', globals?.[10]);
      if ((globals && typeof globals[9] === 'string' && typeof globals[10] === 'string') || Date.now() - started > 120_000) {
        clearInterval(timer);
      }
    });
  }, 250);
}

function presentAsDesktop() {
  const ua = desktopUserAgent(navigator.userAgent);
  const platform = /Macintosh/.test(ua) ? 'MacIntel' : 'Linux x86_64';
  const define = (name: string, value: unknown) => Object.defineProperty(Navigator.prototype, name, { get: () => value, configurable: true });
  define('userAgent', ua);
  define('appVersion', ua.replace(/^Mozilla\//, ''));
  define('platform', platform);
}

function safely(fn: () => void) {
  try {
    fn();
  } catch {
    // Swallowed on purpose: this script must be invisible to Gmail.
  }
}
