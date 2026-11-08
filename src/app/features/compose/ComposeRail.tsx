import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { backend } from '../../data/client';
import { useMe } from '../../data/hooks';
import type { Address, OutgoingAttachment } from '../../data/types';
import { EMAIL_RE, fileSize, firstName, isMe, listDate } from '../../lib/format';
import { navigate, useRoute } from '../../router/useRoute';
import { useUi, type ComposeDraft } from '../../state/ui';
import { IconButton } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { fileIcon } from '../attachments/fileIcon';
import { rememberBox } from './handoff';

export interface PendingFile {
  id: string;
  filename: string;
  size: number;
  loaded: number;
}

/** Line breaks where its blocks and breaks were. */
function quoteText(html: string) {
  const t = document.createElement('template');
  t.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li|h\d|tr|blockquote)>/gi, '$&\n');
  t.content.querySelectorAll('style, script').forEach((n) => n.remove());
  return (t.content.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Outside the signature and quoted mail. */
function ownWordCount(html: string) {
  const t = document.createElement('template');
  t.innerHTML = html.replace(/<br\s*\/?>/gi, ' ').replace(/<\/(div|p|li)>/gi, '$& ');
  t.content.querySelectorAll('.gmail_signature, .gmail_quote, blockquote').forEach((n) => n.remove());
  return (t.content.textContent ?? '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function Section({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return (
    <section className="compose-rail__section" aria-label={label ?? title}>
      <h3 className="compose-rail__title md-title-small">{title}</h3>
      {children}
    </section>
  );
}

/** Your latest conversations with the person you're writing to. Opening one docks the message and shows the conversation beside it. */
function Recent({ draft, person }: { draft: ComposeDraft; person: Address }) {
  const route = useRoute();
  const email = person.email.toLowerCase();
  const { data, isPending, isError } = useQuery({
    // Not under the thread lists' key: their optimistic updates expect paged data. Refetched so archived or deleted mail drops out.
    queryKey: ['compose-recent', email],
    queryFn: () => backend().listThreads({ q: `from:${email} OR to:${email}`, pageSize: 5 }),
    staleTime: 0,
  });
  const name = firstName(person);
  const threads = (data?.threads ?? []).filter((t) => t.id !== draft.threadId).slice(0, 4);
  return (
    <Section title={`Recent with ${name}`}>
      {isPending ? (
        <ul className="compose-rail__list" aria-busy="true" aria-label={`Loading your mail with ${name}`}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="compose-recent compose-recent--loading">
              <span className="sk sk--line" style={{ width: `${70 - i * 12}%` }} />
              <span className="sk sk--line sk--faint" />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <p className="compose-rail__note md-body-small">Couldn't load your mail with {name}.</p>
      ) : threads.length ? (
        <ul className="compose-rail__list">
          {threads.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="compose-recent"
                onClick={(e) => {
                  rememberBox(draft.key, e.currentTarget);
                  useUi.getState().updateCompose(draft.key, { window: 'open' });
                  navigate({ view: route.view, threadId: t.id });
                }}
              >
                <span className="compose-recent__head">
                  <span className="compose-recent__subject md-label-large">{t.subject || '(no subject)'}</span>
                  <span className="compose-recent__date md-body-small">{listDate(t.lastDate)}</span>
                </span>
                <span className="compose-recent__snippet md-body-small">{t.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="compose-rail__note md-body-small">This is your first email with {name}.</p>
      )}
    </Section>
  );
}

/** The expanded composer's side rail: the mail you're answering, your latest mail with the person, and attachments. Signature, templates and send later stay in the send row, as in the docked window. */
export function ComposeRail({
  draft,
  pending,
  onAddFiles,
  onRemove,
  onExpandQuote,
}: {
  draft: ComposeDraft;
  pending: PendingFile[];
  onAddFiles: () => void;
  onRemove: (a: OutgoingAttachment) => void;
  onExpandQuote: () => void;
}) {
  const me = useMe();
  const words = useMemo(() => ownWordCount(draft.html), [draft.html]);
  const quote = useMemo(() => (draft.quoteHtml ? quoteText(draft.quoteHtml) : ''), [draft.quoteHtml]);
  const person = [...draft.to, ...draft.cc].find((a) => EMAIL_RE.test(a.email) && !isMe(a.email, me));
  const files = draft.attachments.length + pending.length;
  const minutes = Math.max(1, Math.round(words / 230));

  return (
    <aside className="compose-rail" aria-label="Message details">
      {draft.quoteHtml && (
        <Section title={draft.mode === 'forward' ? 'Forwarding' : 'Replying to'}>
          <div className="compose-quote-card">
            <p className="compose-quote-card__text md-body-medium">{quote}</p>
            <button type="button" className="compose-quote-card__open" onClick={onExpandQuote}>
              <Icon name="edit" size={18} />
              <span className="md-label-large">{draft.mode === 'forward' ? 'Edit the forwarded message' : 'Quote it in your message'}</span>
            </button>
          </div>
          <p className="compose-rail__note md-body-small">{draft.mode === 'forward' ? 'It goes below your message as it is.' : 'It goes below your message, folded the way Gmail shows it.'}</p>
        </Section>
      )}

      {person && <Recent key={person.email.toLowerCase()} draft={draft} person={person} />}

      <Section title={files ? `Attachments · ${files}` : 'Attachments'} label="Attachments">
        <ul className="compose-tiles" aria-label="Attached files">
          {draft.attachments.map((a) => (
            <li key={a.id} className="compose-tile">
              <span className="compose-tile__preview" aria-hidden="true">
                {a.mimeType.startsWith('image/') && a.size < 8_000_000 && a.data ? (
                  <img src={`data:${a.mimeType};base64,${a.data}`} alt="" />
                ) : (
                  <Icon name={fileIcon(a.mimeType, a.filename) as IconName} size={28} />
                )}
              </span>
              <span className="compose-tile__name md-label-large" title={a.filename}>
                {a.filename}
              </span>
              <span className="compose-tile__size md-body-small">{fileSize(a.size)}</span>
              <IconButton className="compose-tile__remove" icon="close" size="xs" variant="tonal" label={`Remove ${a.filename}`} onClick={() => onRemove(a)} />
            </li>
          ))}
          {pending.map((p) => (
            <li key={p.id} className="compose-tile compose-tile--loading" aria-busy="true">
              <span className="compose-tile__preview" aria-hidden="true">
                <Icon name="attach_file" size={28} />
              </span>
              <span className="compose-tile__name md-label-large">{p.filename}</span>
              <span
                className="compose-att__progress compose-tile__progress"
                role="progressbar"
                aria-label={`Attaching ${p.filename}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={p.size ? Math.round((p.loaded / p.size) * 100) : 0}
              >
                <span style={{ transform: `scaleX(${p.size ? p.loaded / p.size : 0})` }} />
              </span>
            </li>
          ))}
          <li className="compose-tile compose-tile--add">
            <button type="button" className="compose-tile__add" onClick={onAddFiles}>
              <Icon name="attach_file_add" size={28} />
              <span className="md-label-large">{files ? 'Add more' : 'Add files'}</span>
              <span className="md-body-small compose-tile__hint">or drop them anywhere here</span>
            </button>
          </li>
        </ul>
      </Section>

      <p className="compose-rail__count md-label-medium" aria-live="off">
        {words === 1 ? '1 word' : `${words.toLocaleString()} words`}
        {words > 0 && ` · about ${minutes} min to read`}
      </p>
    </aside>
  );
}
