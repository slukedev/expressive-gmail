import { create } from 'zustand';
import type { GeminiSource, GeminiTurn } from '../../data/gemini';
import { geminiErrorText, isStopped, runGemini, type GeminiRun } from './useGemini';

export interface PanelTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  sources?: GeminiSource[];
  /** Model turns only. */
  phase?: 'thinking' | 'streaming' | 'done' | 'error' | 'stopped';
  error?: string;
  /** So Insert in reply knows where. */
  threadId?: string;
  feedback?: 'good' | 'bad';
}

interface PanelState {
  open: boolean;
  /** The open conversation (true) or the whole mailbox. */
  useThread: boolean;
  turns: PanelTurn[];
  /** Set by suggestions and "Ask a follow-up". */
  draft: string;
  /** Bumped to move focus into the composer. */
  focusTick: number;
  show: (opts?: { prompt?: string; ask?: { text: string; threadId?: string }; useThread?: boolean }) => void;
  close: () => void;
  toggle: () => void;
  setDraft: (draft: string) => void;
  setUseThread: (on: boolean) => void;
  ask: (text: string, threadId?: string) => void;
  /** An answer from elsewhere (search), so follow-ups have it. */
  seed: (question: string, answer: { text: string; sources: GeminiSource[] }) => void;
  retry: (id: string) => void;
  stop: () => void;
  reset: () => void;
  rate: (id: string, feedback: 'good' | 'bad' | undefined) => void;
}

let seq = 0;
const turnId = () => `t${++seq}`;
let running: GeminiRun | null = null;

/** Without failed or empty answers. */
function history(turns: PanelTurn[]): GeminiTurn[] {
  return turns.filter((t) => t.role === 'user' || (t.phase === 'done' && t.text)).map((t) => ({ role: t.role, text: t.text }));
}

export const useGeminiPanel = create<PanelState>((set, get) => {
  const patch = (id: string, p: Partial<PanelTurn>) => set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...p } : t)) }));

  const answer = (modelId: string, threadId: string | undefined) => {
    running?.stop();
    // A retried earlier answer doesn't see what came after it.
    const all = get().turns;
    const turns = history(all.slice(0, Math.max(0, all.findIndex((t) => t.id === modelId))));
    const run = runGemini({ kind: 'chat', turns, ...(threadId ? { threadId } : {}) }, (text) => patch(modelId, { text, phase: 'streaming' }));
    running = run;
    run.result.then(
      (result) => {
        if (running === run) running = null;
        if (result.kind === 'answer') patch(modelId, { text: result.text, sources: result.sources, phase: 'done' });
        else patch(modelId, { phase: 'error', error: 'Gemini answered with something this panel can’t show.' });
      },
      (err) => {
        if (running === run) running = null;
        if (isStopped(err)) {
          const t = get().turns.find((x) => x.id === modelId);
          patch(modelId, { phase: t?.text ? 'done' : 'stopped' });
        } else patch(modelId, { phase: 'error', error: geminiErrorText(err) });
      },
    );
  };

  return {
    open: false,
    useThread: true,
    turns: [],
    draft: '',
    focusTick: 0,
    show: (opts = {}) => {
      set((s) => ({
        open: true,
        focusTick: s.focusTick + 1,
        ...(opts.useThread !== undefined ? { useThread: opts.useThread } : {}),
        ...(opts.prompt !== undefined ? { draft: opts.prompt } : {}),
      }));
      if (opts.ask) get().ask(opts.ask.text, opts.ask.threadId);
    },
    close: () => {
      set({ open: false });
      // Back to the spark that opened it, so focus doesn't fall to the page.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.gemini-button')?.focus({ preventScroll: true }));
    },
    toggle: () => (get().open ? get().close() : get().show()),
    setDraft: (draft) => set({ draft }),
    setUseThread: (useThread) => set({ useThread }),
    ask: (text, threadId) => {
      const q = text.trim();
      if (!q) return;
      const scoped = get().useThread ? threadId : undefined;
      const modelId = turnId();
      set((s) => ({
        draft: '',
        turns: [
          ...s.turns.map((t) => (t.phase === 'thinking' || t.phase === 'streaming' ? { ...t, phase: (t.text ? 'done' : 'stopped') as PanelTurn['phase'] } : t)),
          { id: turnId(), role: 'user', text: q, ...(scoped ? { threadId: scoped } : {}) },
          { id: modelId, role: 'model', text: '', phase: 'thinking', ...(scoped ? { threadId: scoped } : {}) },
        ],
      }));
      answer(modelId, scoped);
    },
    seed: (question, result) => {
      running?.stop();
      running = null;
      set({
        turns: [
          { id: turnId(), role: 'user', text: question },
          { id: turnId(), role: 'model', text: result.text, sources: result.sources, phase: 'done' },
        ],
      });
    },
    retry: (id) => {
      const t = get().turns.find((x) => x.id === id);
      if (!t) return;
      patch(id, { text: '', sources: undefined, phase: 'thinking', error: undefined, feedback: undefined });
      answer(id, t.threadId);
    },
    stop: () => running?.stop(),
    reset: () => {
      running?.stop();
      running = null;
      set((s) => ({ turns: [], draft: '', focusTick: s.focusTick + 1 }));
    },
    rate: (id, feedback) => patch(id, { feedback }),
  };
});

export const panelBusy = (turns: PanelTurn[]) => turns.some((t) => t.phase === 'thinking' || t.phase === 'streaming');
