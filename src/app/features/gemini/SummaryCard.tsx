import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GeminiRequest } from '../../data/gemini';
import type { Thread } from '../../data/types';
import { useSettings } from '../../state/settings';
import { Button, IconButton } from '../../ui/Button';
import { useCopy } from '../../ui/feedback';
import { GeminiText, plainText } from './GeminiText';
import { useGeminiPanel } from './panel';
import { Spark } from './Spark';
import { forgetGeminiResult, useGeminiFeature, useGeminiRequest } from './useGemini';
import './gemini.css';

/** Three messages, or a long one. */
function worthSummarizing(thread: Thread): boolean {
  const msgs = thread.messages.filter((m) => !m.isDraft);
  if (msgs.length >= 3) return true;
  return msgs.reduce((n, m) => n + (m.bodyText ?? m.snippet).length, 0) > 1500;
}

const CLAMP_PX = 168;

/** While the tab is open. */
const collapsed = new Set<string>();

/** Long conversations get it on their own when summaries are automatic; any can ask. */
export function SummaryCard({ thread }: { thread: Thread }) {
  const enabled = useGeminiFeature('summary');
  const mode = useSettings((s) => s.geminiSummaries);
  if (!enabled || !thread.messages.some((m) => !m.isDraft)) return null;
  return <Summary key={thread.id} thread={thread} auto={mode === 'auto' && worthSummarizing(thread)} />;
}

function Summary({ thread, auto }: { thread: Thread; auto: boolean }) {
  const request = useMemo<GeminiRequest>(() => ({ kind: 'summarize', threadId: thread.id }), [thread.id]);
  const [asked, setAsked] = useState(auto);
  const run = useGeminiRequest(asked ? request : null);
  const [folded, setFolded] = useState(() => collapsed.has(thread.id));
  const [feedback, setFeedback] = useState<'good' | 'bad'>();
  const { copied, copy } = useCopy();
  const show = useGeminiPanel((s) => s.show);
  // A long summary on a narrow pane shows its start; Show more opens the rest.
  const textRef = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (run.phase === 'done' && el) setLong(el.scrollHeight > CLAMP_PX + 48 && el.getBoundingClientRect().width < 560);
  }, [run.phase, run.text]);

  if (run.unsupported) return null;
  if (!asked && run.phase === 'idle') {
    return (
      <div className="gemini-summary-ask">
        <button type="button" className="gemini-summarize" onClick={() => setAsked(true)}>
          <Spark size={18} />
          <span className="md-label-large">Summarize this email</span>
        </button>
      </div>
    );
  }

  const fold = () => {
    const next = !folded;
    setFolded(next);
    if (next) collapsed.add(thread.id);
    else collapsed.delete(thread.id);
  };
  const busy = run.phase === 'thinking' || run.phase === 'streaming';
  const bodyId = `gemini-summary-${thread.id}`;

  return (
    <section className="gemini-summary" aria-label="Summary by Gemini" aria-busy={busy || undefined} data-folded={folded || undefined}>
      <header className="gemini-summary__head">
        <Spark size={20} busy={busy} />
        <h2 className="md-title-small gemini-summary__title">Summary</h2>
        <span className="gemini-summary__spacer" />
        <IconButton
          icon="keyboard_arrow_up"
          size="xs"
          className="gemini-summary__fold"
          label={folded ? 'Show summary' : 'Hide summary'}
          aria-expanded={!folded}
          aria-controls={bodyId}
          onClick={fold}
        />
      </header>
      <div className="gemini-summary__fold-wrap" id={bodyId}>
        <div className="gemini-summary__body">
          {run.phase === 'thinking' && (
            <div className="gemini-skeleton" role="status" aria-label="Gemini is summarizing">
              <span />
              <span />
              <span />
            </div>
          )}
          {(run.phase === 'streaming' || run.phase === 'done') && (
            <div ref={textRef} className="gemini-summary__text" data-clamped={(long && !more) || undefined} style={long && !more ? { maxHeight: CLAMP_PX } : undefined}>
              <GeminiText text={run.text} className="gemini-text gemini-text--summary" />
            </div>
          )}
          {run.phase === 'done' && long && (
            <button type="button" className="gemini-answer__more md-label-large" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? 'Show less' : 'Show more'}
            </button>
          )}
          {run.phase === 'error' && (
            <div className="gemini-error">
              <p className="md-body-medium">{run.error}</p>
              <Button variant="text" icon="refresh" onClick={run.start}>
                Try again
              </Button>
            </div>
          )}
          {run.phase === 'done' && (
            <div className="gemini-actions" role="group" aria-label="Summary actions">
              <Button variant="tonal" size="xs" icon="forum" onClick={() => {
                  // The summary goes first in the chat, so a follow-up builds on it.
                  useGeminiPanel.getState().seed('Summarize this email', { text: run.text, sources: [] });
                  show({ useThread: true });
                }}>
                Ask a follow-up
              </Button>
              <span className="gemini-actions__icons">
                <IconButton icon="content_copy" size="xs" label="Copy summary" confirmed={copied} confirmedLabel="Copied" onClick={() => void copy(plainText(run.text), 'Summary copied')} />
                <IconButton icon="thumb_up" size="xs" label="Good summary" selected={feedback === 'good'} onClick={() => setFeedback(feedback === 'good' ? undefined : 'good')} />
                <IconButton
                  icon="thumb_down"
                  size="xs"
                  label="Bad summary"
                  selected={feedback === 'bad'}
                  onClick={() => {
                    setFeedback(feedback === 'bad' ? undefined : 'bad');
                    // A bad one isn't kept: coming back asks again.
                    forgetGeminiResult(request);
                  }}
                />
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
