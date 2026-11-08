import { queryOptions, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendError } from '../../data/backend';
import { backend, queryClient } from '../../data/client';
import { geminiOn, geminiRecheckMs, type GeminiFeature, type GeminiRequest, type GeminiResult, type GeminiStatus } from '../../data/gemini';
import { useSettings, type Settings } from '../../state/settings';

export const geminiKeys = {
  status: ['gemini', 'status'] as const,
  /** Kept while the tab is open: summaries, replies, search answers, AI Inbox. */
  result: (request: GeminiRequest) => ['gemini', 'result', request] as const,
};

const NO_CONNECTION: GeminiStatus = { ready: false, block: 'connection' };

/** What Gmail shows for this account. Asked even with Gemini off: it reads Gmail's page and sends nothing to Gemini, and the switch needs it to know its default. */
export async function readGeminiStatus(): Promise<GeminiStatus> {
  const b = backend();
  if (!b.geminiStatus || !b.gemini) return NO_CONNECTION;
  return b.geminiStatus();
}

const statusQuery = queryOptions({
  queryKey: geminiKeys.status,
  queryFn: readGeminiStatus,
  // Gmail adds its Gemini hooks a while after its page loads: an early "no" mustn't stick for the tab's life, as it did with one five-minute read.
  staleTime: (q) => geminiRecheckMs(q.state.data) || Infinity,
  refetchInterval: (q) => geminiRecheckMs(q.state.data),
  retry: false,
});

/** Undefined while it's first asked, or when asking failed; both read as unavailable. */
export function useGeminiStatus(): GeminiStatus | undefined {
  return useQuery(statusQuery).data;
}

/** Whether the status has answered (or failed), so first-run setup knows which steps it has. */
export function useGeminiStatusSettled(): boolean {
  return useQuery(statusQuery).isFetched;
}

/** Gemini shows: Gmail offers it for this account, and the person hasn't turned it off. */
export function useGeminiOn(): boolean {
  const choice = useSettings((s) => s.geminiChoice);
  return geminiOn(choice, useGeminiStatus());
}

/** A run found Gemini (or one feature) gone: look again now rather than leave its buttons up. */
function recheckGemini() {
  void queryClient.invalidateQueries({ queryKey: geminiKeys.status });
}

type FeatureSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

/** On, and offered by this account. */
export function useGeminiFeature(feature: GeminiFeature, setting?: FeatureSetting): boolean {
  const extra = useSettings((s) => (setting ? s[setting] === true : true));
  const status = useGeminiStatus();
  const on = useGeminiOn();
  return on && extra && !!status?.ready && status.features.includes(feature);
}

let seq = 0;
const nextId = () => `g${Date.now().toString(36)}-${(seq++).toString(36)}`;

export interface GeminiRun {
  id: string;
  result: Promise<GeminiResult>;
  stop: () => void;
}

/** `onText` hears the answer so far. Stopping rejects with "Stopped" (code 'unknown'); callers treat that as quiet. */
export function runGemini(request: GeminiRequest, onText?: (text: string) => void): GeminiRun {
  const b = backend();
  const id = nextId();
  if (!b.gemini) {
    return { id, result: Promise.reject(new BackendError('Gemini isn’t available with this connection.', 'unsupported')), stop: () => undefined };
  }
  let stopped = false;
  // Text can arrive many times a frame; listeners hear the latest once per frame, only when it changed.
  let heard = '';
  let pending: string | null = null;
  let frame = 0;
  const flush = () => {
    frame = 0;
    if (pending === null || stopped) return;
    const text = pending;
    pending = null;
    onText?.(text);
  };
  const unsubscribe = onText
    ? b.subscribe?.((event) => {
        if (event.type !== 'gemini' || event.requestId !== id || stopped || event.text === heard) return;
        heard = event.text;
        pending = event.text;
        frame ||= requestAnimationFrame(flush);
      })
    : undefined;
  let rejectStop: (err: unknown) => void = () => undefined;
  const stoppedPromise = new Promise<never>((_, reject) => (rejectStop = reject));
  const asked = b.gemini(request, id).catch((err: unknown) => {
    if (err instanceof BackendError && err.code === 'unsupported') recheckGemini();
    throw err;
  });
  const result = Promise.race([asked, stoppedPromise]).finally(() => {
    unsubscribe?.();
    // A frame still waiting would put the answer back to streaming.
    cancelAnimationFrame(frame);
    pending = null;
  });
  return {
    id,
    result,
    stop: () => {
      if (stopped) return;
      stopped = true;
      void b.cancelGemini?.(id).catch(() => undefined);
      rejectStop(new BackendError('Stopped', 'unknown'));
    },
  };
}

export const isStopped = (err: unknown) => err instanceof Error && err.message === 'Stopped';

export const GEMINI_UNAVAILABLE = 'Gemini isn’t available on this account.';

/** Short and plain. Gmail's own wording for a missing feature is long, and the status recheck hides the surface anyway. */
export function geminiErrorText(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  if (err instanceof BackendError && err.code === 'unsupported') return GEMINI_UNAVAILABLE;
  if (err instanceof BackendError && err.code === 'network') return message || 'Gemini couldn’t be reached. Try again.';
  return message || 'Gemini couldn’t answer that. Try again.';
}

type GeminiPhase = 'idle' | 'thinking' | 'streaming' | 'done' | 'error';

export interface GeminiState<R extends GeminiResult = GeminiResult> {
  phase: GeminiPhase;
  /** So far while streaming, then the final text. */
  text: string;
  result?: R;
  error?: string;
  /** Show nothing rather than an error. */
  unsupported?: boolean;
}

/** With `keep` the result lasts for the tab's life, so coming back shows a summary without asking again. `start` reruns it (Retry, Recreate). */
export function useGeminiRequest<R extends GeminiResult = GeminiResult>(request: GeminiRequest | null, options: { keep?: boolean; auto?: boolean } = {}) {
  const { keep = true, auto = true } = options;
  const key = request ? JSON.stringify(request) : '';
  const cached = request && keep ? (resultCache.get(key) as R | undefined) : undefined;
  const [state, setState] = useState<GeminiState<R>>(() => (cached ? { phase: 'done', text: textOf(cached), result: cached } : { phase: 'idle', text: '' }));
  const run = useRef<GeminiRun | null>(null);
  const keyRef = useRef(key);

  const start = useCallback(() => {
    if (!request) return;
    run.current?.stop();
    const k = JSON.stringify(request);
    setState({ phase: 'thinking', text: '' });
    const r = runGemini(request, (text) => keyRef.current === k && setState((s) => ({ ...s, phase: 'streaming', text })));
    run.current = r;
    r.result.then(
      (result) => {
        if (keyRef.current !== k) {
          if (keep && (textOf(result) || result.kind !== 'answer')) remember(k, result);
          return;
        }
        // An answer ending emptier than it streamed keeps what was shown.
        setState((s) => {
          const final = textOf(result) || s.text;
          const kept = (result.kind === 'answer' || result.kind === 'draft') && final !== textOf(result) ? ({ ...result, text: final } as R) : (result as R);
          if (keep && (final || result.kind !== 'answer')) remember(k, kept);
          return { phase: 'done', text: final, result: kept };
        });
      },
      (err) => {
        if (keyRef.current !== k) return;
        setState((s) => {
          // Stopped, or failed after words arrived: what came stays.
          if (isStopped(err) || s.text) return { ...s, phase: s.text ? 'done' : 'idle' };
          return { phase: 'error', text: '', error: geminiErrorText(err), unsupported: err instanceof BackendError && err.code === 'unsupported' };
        });
      },
    );
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different request: show its kept result, or ask.
  useEffect(() => {
    keyRef.current = key;
    const kept = request && keep ? (resultCache.get(key) as R | undefined) : undefined;
    if (kept) setState({ phase: 'done', text: textOf(kept), result: kept });
    else if (request && auto) start();
    else setState({ phase: 'idle', text: '' });
    return () => run.current?.stop();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => run.current?.stop(), []);
  return { ...state, start, stop };
}

function textOf(result: GeminiResult): string {
  return result.kind === 'answer' || result.kind === 'draft' ? result.text : '';
}

/** Newest last, for this tab and the account in view. */
const RESULT_LIMIT = 80;
const kept = new Map<string, GeminiResult>();
let keptFor: unknown;
const resultCache = {
  get(key: string) {
    return keptFor === backend() ? kept.get(key) : undefined;
  },
  set(key: string, value: GeminiResult) {
    if (keptFor !== backend()) {
      kept.clear();
      keptFor = backend();
    }
    kept.delete(key);
    kept.set(key, value);
    while (kept.size > RESULT_LIMIT) kept.delete(kept.keys().next().value!);
  },
  delete(key: string) {
    kept.delete(key);
  },
};

function remember(key: string, result: GeminiResult) {
  resultCache.set(key, result);
}

/** Recreate and a bad-response report ask again. */
export function forgetGeminiResult(request: GeminiRequest) {
  resultCache.delete(JSON.stringify(request));
}
