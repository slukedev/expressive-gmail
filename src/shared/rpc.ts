/** Request/response RPC over a MessagePort: the content script owns the session backend, the app frame reaches it through a port. */
import { BackendError, type BackendEvent, type MailBackend } from '../app/data/backend';

interface RpcRequest {
  kind: 'rpc:req';
  id: number;
  method: string;
  args: unknown[];
}

interface RpcResponse {
  kind: 'rpc:res';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: { message: string; code: BackendError['code']; retryable: boolean };
}

interface RpcEvent {
  kind: 'rpc:event';
  name: string;
  payload: unknown;
}

/** One hello sent before the port moved can be lost on some engines. */
interface RpcHelloRequest {
  kind: 'rpc:hello?';
}

type Envelope = RpcRequest | RpcResponse | RpcEvent | RpcHelloRequest;

interface Hello {
  kind: MailBackend['kind'];
  capabilities: MailBackend['capabilities'];
  /** Methods the far side actually has, so optional ones stay optional across the port. */
  methods?: string[];
  events?: boolean;
}

const BACKEND_EVENT = 'backend';

/** Serves `backend` on `port`. The returned function stops serving and closes the port. */
export function exposeBackend(port: MessagePort, backend: MailBackend): () => void {
  let sayHello = () => undefined as void;
  const onMessage = async (event: MessageEvent<Envelope>) => {
    const msg = event.data;
    if (msg?.kind === 'rpc:hello?') return sayHello();
    if (msg?.kind !== 'rpc:req') return;
    const fn = (backend as unknown as Record<string, unknown>)[msg.method];
    try {
      if (typeof fn !== 'function') {
        throw new BackendError(`${msg.method} is not available`, 'unsupported');
      }
      const value = await (fn as (...a: unknown[]) => unknown).apply(backend, msg.args);
      port.postMessage({ kind: 'rpc:res', id: msg.id, ok: true, value } satisfies RpcResponse);
    } catch (err) {
      const e = err instanceof BackendError ? err : new BackendError(String((err as Error)?.message ?? err), 'unknown');
      port.postMessage({
        kind: 'rpc:res',
        id: msg.id,
        ok: false,
        error: { message: e.message, code: e.code, retryable: e.retryable },
      } satisfies RpcResponse);
    }
  };
  port.addEventListener('message', onMessage);
  port.start();
  const unsubscribe = backend.subscribe?.((event) => emitEvent(port, BACKEND_EVENT, event));
  // Static fields travel once so the remote side can read them synchronously.
  const hello: Hello = {
    kind: backend.kind,
    capabilities: backend.capabilities,
    methods: METHODS.filter((m) => typeof (backend as unknown as Record<string, unknown>)[m] === 'function'),
    events: !!unsubscribe,
  };
  sayHello = () => port.postMessage({ kind: 'rpc:event', name: 'hello', payload: hello } satisfies RpcEvent);
  sayHello();
  return () => {
    port.removeEventListener('message', onMessage);
    unsubscribe?.();
    port.close();
  };
}

export function emitEvent(port: MessagePort, name: string, payload: unknown) {
  port.postMessage({ kind: 'rpc:event', name, payload } satisfies RpcEvent);
}

const METHODS = [
  'getAccount',
  'listLabels',
  'listThreads',
  'getThread',
  'modifyThreads',
  'trashThreads',
  'untrashThreads',
  'deleteThreadsForever',
  'emptyFolder',
  'snoozeThreads',
  'unsnoozeThreads',
  'muteThreads',
  'send',
  'saveDraft',
  'deleteDraft',
  'cancelScheduled',
  'getAttachment',
  'getThumbnail',
  'createLabel',
  'updateLabel',
  'deleteLabel',
  'listFilters',
  'createFilter',
  'deleteFilter',
  'searchContacts',
  'pollChanges',
  'unsubscribe',
  'listHeaders',
  'lookupPhotos',
  'accountHint',
  'geminiStatus',
  'gemini',
  'cancelGemini',
] as const;

/** Past every timeout the serving side has (45s per Gmail request, a few retries). */
const CALL_MS = 3 * 60_000;
/** Steps on Gmail's page that re-read until Gmail settles (emptying Trash, scheduling, Gemini answers). */
const LONG_CALL_MS = 10 * 60_000;
const LONG_METHODS = new Set<string>(['send', 'emptyFolder', 'deleteThreadsForever', 'cancelScheduled', 'deleteDraft', 'gemini']);

/** Resolves once the far side has said hello. */
export function connectRemoteBackend(
  port: MessagePort,
  onEvent?: (name: string, payload: unknown) => void,
  options: { timeoutMs?: number } = {},
): Promise<MailBackend> {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const listeners = new Set<(event: BackendEvent) => void>();
  let greeted = false;

  return new Promise((resolveBackend, rejectBackend) => {
    // The first hello can be lost when the port changes hands.
    const ask = setInterval(() => !greeted && port.postMessage({ kind: 'rpc:hello?' } satisfies RpcHelloRequest), 500);
    const deadline = options.timeoutMs
      ? setTimeout(() => {
          clearInterval(ask);
          if (!greeted) rejectBackend(new BackendError('The connection to this account never answered.', 'session-unavailable', true));
        }, options.timeoutMs)
      : undefined;
    port.addEventListener('message', (event: MessageEvent<Envelope>) => {
      const msg = event.data;
      if (msg?.kind === 'rpc:res') {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new BackendError(msg.error!.message, msg.error!.code, msg.error!.retryable));
      } else if (msg?.kind === 'rpc:event') {
        if (msg.name === 'hello') {
          if (greeted) return;
          greeted = true;
          clearInterval(ask);
          clearTimeout(deadline);
          const hello = msg.payload as Hello;
          const remote = { kind: hello.kind, capabilities: hello.capabilities } as Record<string, unknown>;
          // Older content scripts don't list their methods; then offer them all.
          const methods = hello.methods ? METHODS.filter((m) => hello.methods!.includes(m)) : METHODS;
          if (hello.events) {
            remote.subscribe = (listener: (event: BackendEvent) => void) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            };
          }
          for (const method of methods) {
            const ms = LONG_METHODS.has(method) ? LONG_CALL_MS : CALL_MS;
            remote[method] = (...args: unknown[]) =>
              new Promise((resolve, reject) => {
                const id = nextId++;
                // A serving side that went away (an extension update under an open tab) never answers.
                const timer = setTimeout(() => {
                  if (!pending.delete(id)) return;
                  reject(new BackendError("Gmail didn't answer in time. If this keeps happening, reload the Gmail tab.", 'network', true));
                }, ms);
                const settle = <T,>(fn: (v: T) => void) => (v: T) => {
                  clearTimeout(timer);
                  fn(v);
                };
                pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
                port.postMessage({ kind: 'rpc:req', id, method, args } satisfies RpcRequest);
              });
          }
          resolveBackend(remote as unknown as MailBackend);
        } else if (msg.name === BACKEND_EVENT) {
          for (const listener of [...listeners]) listener(msg.payload as BackendEvent);
        } else {
          onEvent?.(msg.name, msg.payload);
        }
      }
    });
    port.start();
  });
}
