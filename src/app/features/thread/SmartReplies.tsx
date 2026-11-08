import { useMemo } from 'react';
import type { GeminiRequest, GeminiResult } from '../../data/gemini';
import type { Message, Thread } from '../../data/types';
import { useSettings } from '../../state/settings';
import { analyzeMessage } from '../../smart/extract';
import { useMe } from '../../data/hooks';
import { isMe } from '../../lib/format';
import { Icon } from '../../ui/Icon';
import { replyToMessage } from '../compose/open';
import { plainText } from '../gemini/GeminiText';
import { replyWith } from '../gemini/insert';
import { Spark } from '../gemini/Spark';
import { useGeminiFeature, useGeminiRequest } from '../gemini/useGemini';
import '../gemini/gemini.css';

/** From simple local rules (nothing leaves the browser), only when the last message asks something. */
export function suggestReplies(text: string): string[] {
  const t = text.toLowerCase();
  if (/\b(thank(s| you)|appreciate)\b/.test(t) && !/\?/.test(t)) return ['You’re welcome!', 'Happy to help.', 'Anytime!'];
  if (/\b(can you|could you|would you|are you able|do you have time|available)\b/.test(t)) return ['Sure, I can do that.', 'Let me check and get back to you.', 'Sorry, I can’t this time.'];
  if (/\b(does that work|sounds? good|what do you think)\b|\b(okay|ok|thoughts)\?/.test(t)) return ['Sounds good!', 'Works for me.', 'Let me think about it.'];
  if (/\b(meet|call|lunch|coffee|tomorrow|next week)\b/.test(t) && /\?/.test(t)) return ['Yes, that works.', 'Can we do another time?', 'Let me check my calendar.'];
  if (/\?/.test(t)) return ['Yes', 'No', 'Let me check.'];
  return [];
}

/** Without the quoted history. */
function ownText(text: string) {
  const lines = text.split('\n');
  const cut = lines.findIndex((l) => /^On .+wrote:\s*$/.test(l.trim()) || l.startsWith('>') || /^-{2,}\s*(Original|Forwarded)/i.test(l));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n');
}

/** Mailboxes nobody reads replies from. */
const AUTOMATED = /^(no-?reply|do-?not-?reply|notifications?|notify|alerts?|updates?|news(letter)?|info|itinerary|bookings?|reservations?|billing|invoices?|receipts?|orders?|shipping|tracking|delivery|security|mailer-daemon|postmaster|bounces?)([-+._].*)?$/i;

export function isAutomated(m: Message, labelIds: string[]): boolean {
  if (labelIds.some((l) => l === 'CATEGORY_PROMOTIONS' || l === 'CATEGORY_UPDATES' || l === 'CATEGORY_SOCIAL')) return true;
  if (m.headers.listUnsubscribe) return true;
  return AUTOMATED.test(m.from.email.split('@')[0] ?? '');
}

/** With Gemini they're whole replies written for this conversation, each showing how it begins; without it, short answers from local rules. */
export function SmartReplies({ thread }: { thread: Thread }) {
  const me = useMe();
  const smartFeatures = useSettings((s) => s.smartFeatures);
  const gemini = useGeminiFeature('replies', 'geminiReplies');
  const real = thread.messages.filter((m) => !m.isDraft);
  const last = real[real.length - 1];
  // A summary card already says what this mail is about; a canned reply on top reads as noise.
  const hasCard = useMemo(
    () =>
      smartFeatures &&
      !!last &&
      (analyzeMessage(last, thread.labelIds).length > 0 ||
        thread.messages.some((m) => m.attachments.some((a) => a.mimeType.startsWith('text/calendar') || /\.ics$/i.test(a.filename)))),
    [smartFeatures, last, thread],
  );
  if (!last || isMe(last.from.email, me)) return null;
  if (isAutomated(last, thread.labelIds) || hasCard) return null;
  // Reply picks the started draft back up, so a suggestion would have nowhere to go.
  if (thread.messages.some((m) => m.isDraft)) return null;
  if (gemini) return <GeminiReplies key={thread.id} thread={thread} last={last} />;
  return <QuickReplies thread={thread} last={last} />;
}

function QuickReplies({ thread, last }: { thread: Thread; last: Message }) {
  const replies = suggestReplies(ownText(last.bodyText ?? last.snippet)).slice(0, 3);
  if (!replies.length) return null;
  return (
    <div className="reply-suggest" role="group" aria-label="Suggested replies">
      {replies.map((r) => (
        <button key={r} type="button" className="reply-suggest__quick" onClick={() => replyToMessage(thread.id, last, 'reply', `<p>${r}</p>`)}>
          <Icon name="reply" size={18} className="reply-suggest__glyph" />
          <span className="md-label-large">{r}</span>
        </button>
      ))}
    </div>
  );
}

function GeminiReplies({ thread, last }: { thread: Thread; last: Message }) {
  const request = useMemo<GeminiRequest>(() => ({ kind: 'replies', threadId: thread.id }), [thread.id]);
  const run = useGeminiRequest<Extract<GeminiResult, { kind: 'replies' }>>(request);
  if (run.phase === 'thinking' || run.phase === 'streaming') {
    return (
      <div className="reply-suggest" aria-busy="true" aria-label="Gemini is writing suggested replies" role="status">
        {[0, 1].map((i) => (
          <span key={i} className="reply-suggest__card reply-suggest__card--loading" aria-hidden="true">
            <span />
            <span />
          </span>
        ))}
      </div>
    );
  }
  // Gemini had nothing (or failed): the quick answers still help.
  if (run.phase === 'error' || (run.phase === 'done' && !run.result?.replies.length)) return <QuickReplies thread={thread} last={last} />;
  if (run.phase !== 'done' || !run.result) return null;
  return (
    <div className="reply-suggest" role="group" aria-label="Suggested replies by Gemini">
      {run.result.replies.slice(0, 3).map((r) => {
        let preview = plainText(r.text).replace(/^(hi|hey|hello|dear)\b[^\n]*\n+/i, '').replace(/\s+/g, ' ').trim();
        // "Thanks, everyone" over "Thanks, everyone. This was...": show what comes after.
        const head = r.label.replace(/[.!]+$/, '').toLowerCase();
        if (preview.toLowerCase().startsWith(head)) preview = preview.slice(head.length).replace(/^[\s.,!]+/, '');
        return (
          <button
            key={r.label}
            type="button"
            className="reply-suggest__card"
            onClick={() => void replyWith(thread.id, r.text)}
            aria-label={`Reply: ${r.label}. ${preview}`}
          >
            <Spark size={18} className="reply-suggest__spark" />
            <span className="reply-suggest__label md-title-small">{r.label}</span>
            <span className="reply-suggest__preview md-body-small">{preview}</span>
          </button>
        );
      })}
    </div>
  );
}
