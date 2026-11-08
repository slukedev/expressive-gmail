import { memo, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useAccount } from '../../data/hooks';
import { findThread } from '../../data/client';
import { useRoute, openThread } from '../../router/useRoute';
import { Button, IconButton } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Icon, type IconName } from '../../ui/Icon';
import { announce, useCopy } from '../../ui/feedback';
import { listDate } from '../../lib/format';
import { GeminiText, plainText } from './GeminiText';
import { replyWith } from './insert';
import { panelBusy, useGeminiPanel, type PanelTurn } from './panel';
import { Spark } from './Spark';
import { GeminiUnavailable } from './Unavailable';
import { useGeminiStatus } from './useGemini';
import { isComposing } from '../../lib/ime';
import './gemini.css';

const THREAD_PROMPTS: { icon: IconName; text: string }[] = [
  { icon: 'notes', text: 'Summarize this email' },
  { icon: 'checklist', text: 'List the action items' },
  { icon: 'reply', text: 'Suggest a reply' },
];

const MAIL_PROMPTS: { icon: IconName; text: string }[] = [
  { icon: 'mark_email_unread', text: 'Catch me up on unread mail' },
  { icon: 'hourglass_top', text: 'What’s waiting on my reply?' },
  { icon: 'receipt_long', text: 'Find my most recent receipts' },
];

/** About the open email or your whole mailbox. Docked beside the reading pane on wide windows, a sheet on narrower ones, full screen on a phone. */
export function GeminiPanel({ mode }: { mode: 'docked' | 'sheet' | 'full' }) {
  const status = useGeminiStatus();
  const route = useRoute();
  const turns = useGeminiPanel((s) => s.turns);
  const useThread = useGeminiPanel((s) => s.useThread);
  const close = useGeminiPanel((s) => s.close);
  const reset = useGeminiPanel((s) => s.reset);
  const threadId = route.threadId;
  const subject = threadId ? (findThread(threadId)?.subject ?? '') : '';
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  // A floating panel is the top layer: Escape closes it first, even with focus on the page (Safari doesn't focus clicked buttons).
  useEffect(() => {
    if (mode === 'docked') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as Node | null;
      const onPage = !target || target === document.body || target === document.documentElement;
      if (!onPage && !panelRef.current?.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [mode, close]);
  const atEnd = useRef(true);

  // Follow the answer as it streams, unless you scrolled up.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  return (
    <aside className="gemini-panel" data-mode={mode} aria-label="Gemini" ref={panelRef}>
      <header className="gemini-panel__head">
        <Spark size={24} />
        <h2 className="md-title-large gemini-panel__title">Gemini</h2>
        <span className="gemini-panel__spacer" />
        {turns.length > 0 && <IconButton icon="edit_square" label="New chat" onClick={reset} />}
        <IconButton icon="close" label="Close Gemini" onClick={close} />
      </header>
      {status && !status.ready ? (
        <div className="gemini-panel__scroll">
          <GeminiUnavailable status={status} />
        </div>
      ) : (
        <>
          <div
            className="gemini-panel__scroll"
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {turns.length === 0 ? (
              <Welcome threadId={useThread ? threadId : undefined} />
            ) : (
              <ol className="gemini-chat">
                {turns.map((t) => (t.role === 'user' ? <UserTurn key={t.id} turn={t} /> : <ModelTurn key={t.id} turn={t} />))}
              </ol>
            )}
          </div>
          <Composer threadId={threadId} subject={subject} />
        </>
      )}
    </aside>
  );
}

function Welcome({ threadId }: { threadId?: string }) {
  const { data: account } = useAccount();
  const ask = useGeminiPanel((s) => s.ask);
  const first = account?.name?.split(/\s+/)[0];
  const prompts = threadId ? THREAD_PROMPTS : MAIL_PROMPTS;
  return (
    <div className="gemini-welcome">
      <p className="gemini-welcome__hello">{first ? `Hi ${first}` : 'Hi there'}</p>
      <p className="md-body-large gemini-welcome__lead">
        {threadId ? 'Ask about this conversation, or turn off “This email” to ask about all your mail.' : 'Ask about anything in your mail.'}
      </p>
      <ul className="gemini-prompts">
        {prompts.map((p) => (
          <li key={p.text}>
            <button type="button" className="gemini-prompt" onClick={() => ask(p.text, threadId)}>
              <span className="gemini-prompt__icon">
                <Icon name={p.icon} size={20} />
              </span>
              <span className="md-body-large">{p.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// While one answer streams, only its turn renders again.
const UserTurn = memo(function UserTurn({ turn }: { turn: PanelTurn }) {
  return (
    <li className="gemini-turn gemini-turn--user">
      <p className="gemini-bubble md-body-large" dir="auto">
        {turn.text}
      </p>
    </li>
  );
});

const ModelTurn = memo(function ModelTurn({ turn }: { turn: PanelTurn }) {
  const retry = useGeminiPanel((s) => s.retry);
  const rate = useGeminiPanel((s) => s.rate);
  const { copied, copy } = useCopy();
  const busy = turn.phase === 'thinking' || turn.phase === 'streaming';
  const sources = turn.sources ?? [];
  const draftReply = turn.threadId && /^Here’s a reply/i.test(turn.text) ? turn.text.replace(/^[^\n]*\n+/, '') : undefined;
  // Read out once it ends, not word by word; answers already there when the panel opens stay quiet.
  const phase = useRef(turn.phase);
  useEffect(() => {
    if (phase.current === turn.phase) return;
    phase.current = turn.phase;
    if (turn.phase === 'done' && turn.text) announce(plainText(turn.text).replace(/^[ \t]*(?:[-*]|\d+\.)[ \t]+/gm, ''));
    else if (turn.phase === 'error' && turn.error) announce(turn.error);
  }, [turn.phase, turn.text, turn.error]);
  let body: ReactNode;
  if (turn.phase === 'thinking') {
    body = (
      <div className="gemini-thinking" role="status" aria-label="Gemini is thinking">
        <span />
        <span />
        <span />
      </div>
    );
  } else if (turn.phase === 'error') {
    body = (
      <div className="gemini-error">
        <p className="md-body-medium">{turn.error}</p>
        <Button variant="text" icon="refresh" onClick={() => retry(turn.id)}>
          Try again
        </Button>
      </div>
    );
  } else if (turn.phase === 'stopped') {
    body = <p className="md-body-medium gemini-muted">You stopped this answer.</p>;
  } else {
    body = <GeminiText text={turn.text} sources={sources} onCite={(i) => openThread(sources[i]!.threadId)} />;
  }
  return (
    <li className="gemini-turn gemini-turn--model" aria-busy={busy || undefined}>
      <Spark size={20} busy={busy} className="gemini-turn__spark" />
      <div className="gemini-turn__body">
        {body}
        {turn.phase === 'done' && sources.length > 0 && (
          <ul className="gemini-sources" aria-label="Sources">
            {sources.map((s, i) => (
              <li key={s.threadId + i}>
                <button type="button" className="gemini-source" onClick={() => openThread(s.threadId)}>
                  <span className="gemini-source__n">{i + 1}</span>
                  <span className="gemini-source__text">
                    <span className="md-title-small gemini-source__subject">{s.subject}</span>
                    <span className="md-body-small gemini-source__meta">{[s.from, s.date ? listDate(s.date) : ''].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Icon name="chevron_right" size={20} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {turn.phase === 'done' && turn.text && (
          <div className="gemini-actions" role="group" aria-label="Answer actions">
            {draftReply && (
              <Button variant="tonal" size="xs" icon="reply" onClick={() => void replyWith(turn.threadId!, draftReply)}>
                Use in reply
              </Button>
            )}
            <IconButton icon="content_copy" size="xs" label="Copy" confirmed={copied} confirmedLabel="Copied" onClick={() => void copy(plainText(turn.text))} />
            <IconButton icon="thumb_up" size="xs" label="Good response" selected={turn.feedback === 'good'} onClick={() => rate(turn.id, turn.feedback === 'good' ? undefined : 'good')} />
            <IconButton icon="thumb_down" size="xs" label="Bad response" selected={turn.feedback === 'bad'} onClick={() => rate(turn.id, turn.feedback === 'bad' ? undefined : 'bad')} />
            <IconButton icon="refresh" size="xs" label="Ask again" onClick={() => retry(turn.id)} />
          </div>
        )}
      </div>
    </li>
  );
});

function Composer({ threadId, subject }: { threadId?: string; subject: string }) {
  const draft = useGeminiPanel((s) => s.draft);
  const setDraft = useGeminiPanel((s) => s.setDraft);
  const ask = useGeminiPanel((s) => s.ask);
  const stop = useGeminiPanel((s) => s.stop);
  const useThread = useGeminiPanel((s) => s.useThread);
  const setUseThread = useGeminiPanel((s) => s.setUseThread);
  const focusTick = useGeminiPanel((s) => s.focusTick);
  // A boolean, so streaming text doesn't render the composer again.
  const busy = useGeminiPanel((s) => panelBusy(s.turns));
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusTick) ref.current?.focus();
  }, [focusTick]);

  // Up to six lines, then scrolls.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 16)}px`;
  }, [draft]);

  const send = () => {
    if (busy || !draft.trim()) return;
    ask(draft, threadId);
  };

  return (
    <form
      className="gemini-composer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="gemini-composer__context">
        {threadId ? (
          <Chip
            kind="filter"
            icon="mail"
            selected={useThread}
            aria-pressed={useThread}
            onClick={() => setUseThread(!useThread)}
            title={useThread ? `Asking about “${subject}”. Turn off to ask about all your mail.` : 'Ask about the open email'}
          >
            <span className="gemini-composer__subject">{useThread ? subject || 'This email' : 'This email'}</span>
          </Chip>
        ) : (
          <span className="md-label-large gemini-composer__scope">
            <Icon name="inbox" size={18} />
            All your mail
          </span>
        )}
      </div>
      <div className="gemini-composer__field">
        <textarea
          ref={ref}
          rows={1}
          className="gemini-composer__input md-body-large"
          placeholder={threadId && useThread ? 'Ask about this email' : 'Ask Gemini about your mail'}
          aria-label="Ask Gemini"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !isComposing(e)) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <IconButton icon="stop" variant="filled" label="Stop answering" onClick={stop} />
        ) : (
          <IconButton icon="arrow_upward" variant="filled" label="Send" type="submit" disabled={!draft.trim()} />
        )}
      </div>
      <p className="md-body-small gemini-composer__note">Gemini can make mistakes, so check anything important.</p>
    </form>
  );
}
