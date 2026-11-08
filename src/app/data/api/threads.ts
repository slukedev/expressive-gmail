import type { Address, Attachment, LabelId, Message, Thread, ThreadSummary } from '../types';
import { dedupeAddresses, parseAddress, parseAddressList } from './address';
import type { GmailThread } from './gmail-types';
import { decodeSnippet, header, parsePayload } from './payload';

export interface SummaryContext {
  /** E.g. the snooze helper label to SNOOZED. */
  labelAliases?: Record<string, LabelId>;
  /** Emulated snooze wake times by thread id. */
  snoozed?: Record<string, number>;
  /** Used when the newest message has none. */
  listSnippet?: string;
}

const MAX_CHIPS = 3;

function aliasLabels(ids: Iterable<string>, aliases: Record<string, LabelId> | undefined): LabelId[] {
  const out = new Set<LabelId>();
  for (const id of ids) out.add(aliases?.[id] ?? id);
  return [...out];
}

function hasFileParts(thread: GmailThread): boolean {
  return (thread.messages ?? []).some((m) => {
    const payload = m.payload;
    if (!payload) return false;
    // format=metadata drops `parts`, but a multipart/mixed message almost always carries a file.
    if (!payload.parts?.length) return (payload.mimeType ?? '').toLowerCase() === 'multipart/mixed';
    return parsePayload(payload, m.id).attachments.some((a) => !a.inline);
  });
}

export function toThreadSummary(thread: GmailThread, ctx: SummaryContext = {}): ThreadSummary {
  const messages = [...(thread.messages ?? [])].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  const real = messages.filter((m) => !(m.labelIds ?? []).includes('DRAFT'));
  const drafts = messages.length - real.length;
  const newest = real[real.length - 1] ?? messages[messages.length - 1];
  const first = messages[0];

  const labelIds = new Set<string>();
  for (const m of messages) for (const id of m.labelIds ?? []) labelIds.add(id);
  const labels = aliasLabels(labelIds, ctx.labelAliases);
  const snoozedUntil = ctx.snoozed?.[thread.id];
  if (snoozedUntil !== undefined && !labels.includes('SNOOZED')) labels.push('SNOOZED');

  const participants: Address[] = dedupeAddresses(
    real.map((m) => parseAddress(header(m.payload?.headers, 'From'))).filter((a): a is Address => !!a),
  );

  const chips: ThreadSummary['attachments'] = [];
  for (const m of messages) {
    if (!m.payload?.parts?.length) continue;
    for (const a of parsePayload(m.payload, m.id).attachments) {
      if (a.inline || chips.length >= MAX_CHIPS) continue;
      chips.push({ id: a.id, filename: a.filename, mimeType: a.mimeType, messageId: a.messageId, size: a.size || undefined });
    }
  }

  const summary: ThreadSummary = {
    id: thread.id,
    subject: header(first?.payload?.headers, 'Subject') ?? '',
    snippet: decodeSnippet(newest?.snippet || ctx.listSnippet || thread.snippet || ''),
    labelIds: labels,
    participants,
    recipients: parseAddressList(header(newest?.payload?.headers, 'To')),
    messageCount: real.length,
    draftCount: drafts,
    lastDate: Number(newest?.internalDate ?? 0),
    hasAttachments: chips.length > 0 || hasFileParts(thread),
    attachments: chips,
  };
  if (snoozedUntil !== undefined) summary.snoozedUntil = snoozedUntil;
  const size = messages.reduce((sum, m) => sum + (m.sizeEstimate ?? 0), 0);
  if (size) summary.size = size;
  return summary;
}

export function toThread(thread: GmailThread, messages: Message[], ctx: SummaryContext = {}): Thread {
  const summary = toThreadSummary(thread, ctx);
  const aliased = messages.map((m) => ({ ...m, labelIds: aliasLabels(m.labelIds, ctx.labelAliases) }));
  const files: Attachment[] = aliased.flatMap((m) => m.attachments.filter((a) => !a.inline));
  return {
    ...summary,
    hasAttachments: files.length > 0,
    attachments: files.slice(0, MAX_CHIPS).map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, messageId: a.messageId, size: a.size || undefined })),
    messages: aliased,
  };
}

