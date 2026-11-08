import { useMemo } from 'react';
import type { GeminiRequest, GeminiResult } from '../../data/gemini';
import { findThread } from '../../data/client';
import { rawId } from '../../data/accounts/ids';
import { isMe, listDate } from '../../lib/format';
import { useMe } from '../../data/hooks';
import { openThread } from '../../router/useRoute';
import { local, useLocal } from '../../state/local';
import { updateSettings, useSettings } from '../../state/settings';
import { Button, IconButton } from '../../ui/Button';
import { Checkbox } from '../../ui/Checkbox';
import { Icon } from '../../ui/Icon';
import { snack } from '../../ui/Snackbar';
import { PageMark } from '../list/PageMark';
import { GeminiText } from './GeminiText';
import { GeminiUnavailable } from './Unavailable';
import { forgetGeminiResult, useGeminiRequest, useGeminiStatus } from './useGemini';
import './gemini.css';

type Briefing = Extract<GeminiResult, { kind: 'briefing' }>;
const REQUEST: GeminiRequest = { kind: 'briefing' };

/** What needs doing, then what's been going on, by topic. Checked-off to-dos are kept in this browser. */
export function AiInboxView() {
  const choice = useSettings((s) => s.geminiChoice);
  const status = useGeminiStatus();
  const ready = status?.ready && status.features.includes('inbox');
  return (
    <section className="page ai-inbox" aria-labelledby="ai-inbox-title">
      <header className="page__head">
        <PageMark kind="ai-inbox" />
        <h1 id="ai-inbox-title" className="md-headline-medium md-emphasized">
          AI Inbox
        </h1>
        <p className="md-body-large page__lede">Ticking a to-do off here doesn’t change your inbox.</p>
      </header>
      {status && !status.ready ? (
        <GeminiUnavailable status={status} />
      ) : status && choice === false ? (
        <div className="gemini-off" role="status">
          <h3 className="md-title-medium">Gemini is off</h3>
          <p className="md-body-medium">AI Inbox needs Gemini. Turn it back on to see your to-dos and topics.</p>
          <div className="gemini-off__actions">
            <Button variant="tonal" onClick={() => updateSettings({ geminiChoice: true })}>
              Turn on Gemini
            </Button>
          </div>
        </div>
      ) : ready ? (
        <Briefing />
      ) : status ? (
        <div className="gemini-off" role="status">
          <h3 className="md-title-medium">AI Inbox isn’t on this account yet</h3>
          <p className="md-body-medium">Google offers it with some plans and languages first. The rest of Gemini still works.</p>
        </div>
      ) : null}
    </section>
  );
}

function Briefing() {
  const run = useGeminiRequest<Briefing>(REQUEST);
  const done = useLocal((s) => s.doneTodos);
  const doneSet = useMemo(() => new Set(done), [done]);
  const refresh = () => {
    forgetGeminiResult(REQUEST);
    run.start();
  };

  if (run.phase === 'thinking' || run.phase === 'streaming' || run.phase === 'idle') {
    return (
      <div className="ai-inbox__cols" aria-busy="true">
        <div className="ai-inbox__col" role="status" aria-label="Gemini is reading your mail">
          <h2 className="list-section md-label-large">To-dos</h2>
          <div className="ai-todos">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ai-todo ai-todo--loading" aria-hidden="true">
                <span />
                <span />
              </div>
            ))}
          </div>
        </div>
        <div className="ai-inbox__col" aria-hidden="true">
          <h2 className="list-section md-label-large">Topics</h2>
          <div className="ai-topic ai-topic--loading">
            <div className="gemini-skeleton">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (run.phase === 'error' || !run.result) {
    return (
      <div className="gemini-off" role="alert">
        <h3 className="md-title-medium">Gemini couldn’t read your mail</h3>
        <p className="md-body-medium">{run.error ?? 'Try again in a moment.'}</p>
        <div className="gemini-off__actions">
          <Button variant="tonal" icon="refresh" onClick={refresh}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const { todos, topics } = run.result;
  const open = todos.filter((t) => !doneSet.has(`${rawId(t.threadId)}|${t.text}`));
  const checked = todos.filter((t) => doneSet.has(`${rawId(t.threadId)}|${t.text}`));
  return (
    <div className="ai-inbox__cols">
      <div className="ai-inbox__col">
        <div className="ai-inbox__bar">
          <h2 className="list-section md-label-large">To-dos</h2>
          <IconButton icon="refresh" size="xs" label="Read my mail again" onClick={refresh} />
        </div>
        {open.length === 0 ? (
          <p className="md-body-large ai-inbox__clear">
            <Icon name="check_circle" size={24} />
            {todos.length ? 'You’ve done everything Gemini found.' : 'Nothing in your recent mail needs you.'}
          </p>
        ) : (
          <ul className="ai-todos">
            {open.map((t) => (
              <Todo key={`${t.threadId}|${t.text}`} todo={t} done={false} />
            ))}
          </ul>
        )}
        {checked.length > 0 && (
          <details className="ai-done">
            <summary className="md-label-large">
              <Icon name="keyboard_arrow_down" size={20} />
              Done ({checked.length})
            </summary>
            <ul className="ai-todos">
              {checked.map((t) => (
                <Todo key={`${t.threadId}|${t.text}`} todo={t} done />
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="ai-inbox__col">
        <h2 className="list-section md-label-large">Topics</h2>
        {topics.length === 0 ? (
          <p className="md-body-large ai-inbox__clear">Not enough recent mail to group into topics.</p>
        ) : (
          <div className="ai-topics">
            {topics.map((topic) => (
              <article key={topic.title} className="ai-topic" aria-label={topic.title}>
                <h3 className="md-title-medium ai-topic__title">{topic.title}</h3>
                <GeminiText text={topic.summary} className="gemini-text ai-topic__summary" />
                <ul className="ai-topic__threads" aria-label={`Conversations about ${topic.title}`}>
                  {topic.threadIds.slice(0, 4).map((id) => {
                    const t = findThread(id);
                    const src = topic.sources?.find((x) => x.threadId === id);
                    const date = t?.lastDate ?? src?.date;
                    return (
                      <li key={id}>
                        <button type="button" className="ai-topic__thread" onClick={() => openThread(id)}>
                          <span className="md-body-medium ai-topic__subject">{t?.subject || src?.subject || 'Open conversation'}</span>
                          {date && <span className="md-body-small ai-topic__date">{listDate(date)}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {topic.threadIds.length > 4 && <p className="md-body-small ai-topic__more">and {topic.threadIds.length - 4} more</p>}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Todo({ todo, done }: { todo: Briefing['todos'][number]; done: boolean }) {
  const t = findThread(todo.threadId);
  const me = useMe();
  const other = t ? [...t.participants].reverse().find((p) => !isMe(p.email, me)) : undefined;
  const toggle = (on: boolean) => {
    local.setTodoDone(todo.threadId, todo.text, on);
    if (on) snack('Marked done', { action: { label: 'Undo', onClick: () => local.setTodoDone(todo.threadId, todo.text, false) } });
  };
  return (
    <li className="ai-todo" data-done={done || undefined}>
      <Checkbox checked={done} onCheckedChange={toggle} label={done ? `Mark “${todo.text}” not done` : `Mark “${todo.text}” done`} />
      <button type="button" className="ai-todo__open" onClick={() => openThread(todo.threadId)}>
        <span className="md-body-large ai-todo__text">{todo.text}</span>
        <span className="md-body-small ai-todo__meta">
          {[other?.name || other?.email, t?.subject, todo.due ? `due ${listDate(todo.due)}` : ''].filter(Boolean).join(' · ')}
        </span>
      </button>
    </li>
  );
}
