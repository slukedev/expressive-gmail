export interface SignedInAccount {
  email: string;
  /** Gmail's /u/N slot. */
  index: number;
  /** The tab's own account. */
  home?: boolean;
  unread?: number;
}

export interface DelegatedMailbox {
  email: string;
  name?: string;
  photoUrl?: string;
  url: string;
}

export interface AccountsService {
  list(): Promise<SignedInAccount[]>;
  unread(indices: number[]): Promise<Record<number, number>>;
  profiles(accounts: { index: number; email: string }[]): Promise<Record<number, { name?: string; photoUrl?: string }>>;
  /** A port serving /u/N's backend, which must be signed in as `email`. */
  open(index: number, email: string): Promise<MessagePort>;
  delegated(): Promise<DelegatedMailbox[]>;
}

interface Request {
  kind: 'acct:req';
  id: number;
  method: keyof AccountsService;
  args: unknown[];
}

interface Response {
  kind: 'acct:res';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}

const METHODS = new Set<string>(['list', 'unread', 'profiles', 'open', 'delegated']);
const CALL_MS = 60_000;

export function serveAccounts(port: MessagePort, service: AccountsService): () => void {
  const onMessage = async (event: MessageEvent<Request>) => {
    const msg = event.data;
    if (msg?.kind !== 'acct:req' || !METHODS.has(msg.method)) return;
    try {
      const value = await (service[msg.method] as (...a: unknown[]) => Promise<unknown>)(...msg.args);
      if (value instanceof MessagePort) port.postMessage({ kind: 'acct:res', id: msg.id, ok: true } satisfies Response, [value]);
      else port.postMessage({ kind: 'acct:res', id: msg.id, ok: true, value } satisfies Response);
    } catch (err) {
      port.postMessage({ kind: 'acct:res', id: msg.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies Response);
    }
  };
  port.addEventListener('message', onMessage);
  port.start();
  return () => {
    port.removeEventListener('message', onMessage);
    port.close();
  };
}

export function accountsClient(port: MessagePort): AccountsService {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  port.addEventListener('message', (event: MessageEvent<Response>) => {
    const msg = event.data;
    if (msg?.kind !== 'acct:res') return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (!msg.ok) p.reject(new Error(msg.error ?? 'Account request failed'));
    else p.resolve(event.ports[0] ?? msg.value);
  });
  port.start();
  const call = <T,>(method: keyof AccountsService, args: unknown[]) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      // The page serving this can go away (an extension update under an open tab) without answering.
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error("Gmail didn't answer in time. Reload the Gmail tab if this keeps happening."));
      }, CALL_MS);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      port.postMessage({ kind: 'acct:req', id, method, args } satisfies Request);
    });
  return {
    list: () => call('list', []),
    unread: (indices) => call('unread', [indices]),
    profiles: (accounts) => call('profiles', [accounts]),
    open: (index, email) => call('open', [index, email]),
    delegated: () => call('delegated', []),
  };
}
