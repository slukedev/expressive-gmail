import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { readsAsQuestion, type GeminiRequest } from '../../data/gemini';
import { listDate } from '../../lib/format';
import { openThread } from '../../router/useRoute';
import { Button, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { useCopy } from '../../ui/feedback';
import { GeminiText, plainText } from './GeminiText';
import { useGeminiPanel } from './panel';
import { Spark } from './Spark';
import { useGeminiFeature, useGeminiRequest } from './useGemini';
import './gemini.css';

/** For searches that read as questions ("when is the lease due?"). */
export function SearchAnswer({ query }: { query: string }) {
  const enabled = useGeminiFeature('search', 'geminiSearch');
  if (!enabled || !readsAsQuestion(query)) return null;
  return <Answer key={query} query={query} />;
}

/** Height before Show more. */
const FOLD_PX = 168;

function Answer({ query }: { query: string }) {
  const request = useMemo<GeminiRequest>(() => ({ kind: 'search', query }), [query]);
  const run = useGeminiRequest(request);
  const { copied, copy } = useCopy();
  const show = useGeminiPanel((s) => s.show);
  const seed = useGeminiPanel((s) => s.seed);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const sources = run.result?.kind === 'answer' ? run.result.sources : [];

  useLayoutEffect(() => {
    if (run.phase === 'done' && bodyRef.current) setLong(bodyRef.current.scrollHeight > FOLD_PX + 24);
  }, [run.phase, run.text]);

  const busy = run.phase === 'thinking' || run.phase === 'streaming';
  if (run.unsupported) return null;
  return (
    <section className="gemini-answer" aria-label="Answer from Gemini" aria-busy={busy || undefined}>
      <header className="gemini-answer__head">
        <Spark size={20} busy={busy} />
        <h2 className="md-title-small">Gemini</h2>
      </header>
      {run.phase === 'thinking' && (
        <div className="gemini-skeleton" role="status" aria-label="Gemini is reading your mail">
          <span />
          <span />
          <span />
        </div>
      )}
      {run.phase === 'error' && (
        <div className="gemini-error">
          <p className="md-body-medium">{run.error}</p>
          <Button variant="text" icon="refresh" onClick={run.start}>
            Try again
          </Button>
        </div>
      )}
      {(run.phase === 'streaming' || run.phase === 'done') && (
        <div className="gemini-answer__body" ref={bodyRef} data-folded={(long && !expanded) || undefined} style={long && !expanded ? { maxHeight: FOLD_PX } : undefined}>
          <GeminiText text={run.text} sources={sources} onCite={(i) => openThread(sources[i]!.threadId)} />
        </div>
      )}
      {run.phase === 'done' && (
        <>
          {long && (
            <button type="button" className="gemini-answer__more md-label-large" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)}>
              {expanded ? 'Show less' : 'Show more'}
              <Icon name={expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={20} />
            </button>
          )}
          {sources.length > 0 && (
            <ul className="gemini-sources gemini-sources--inline" aria-label="Sources">
              {sources.map((s, i) => (
                <li key={s.threadId + i}>
                  <button type="button" className="gemini-source" onClick={() => openThread(s.threadId)}>
                    <span className="gemini-source__n">{i + 1}</span>
                    <span className="gemini-source__text">
                      <span className="md-title-small gemini-source__subject">{s.subject}</span>
                      <span className="md-body-small gemini-source__meta">{[s.from, s.date ? listDate(s.date) : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="gemini-actions" role="group" aria-label="Answer actions">
            <Button
              variant="tonal"
              size="xs"
              icon="forum"
              onClick={() => {
                if (run.result?.kind === 'answer') seed(query, run.result);
                show({ useThread: false });
              }}
            >
              Ask a follow-up
            </Button>
            <IconButton icon="content_copy" size="xs" label="Copy answer" confirmed={copied} confirmedLabel="Copied" onClick={() => void copy(plainText(run.text), 'Answer copied')} />
          </div>
        </>
      )}
    </section>
  );
}
