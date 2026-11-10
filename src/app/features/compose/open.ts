import { backend, keys, queryClient } from '../../data/client';
import type { Account, Address, Message, Thread } from '../../data/types';
import { myAddresses } from '../../data/hooks';
import { splitId } from '../../data/accounts/ids';
import { escapeHtml, fullDate, isMe, parseAddresses } from '../../lib/format';
import { getRoute } from '../../router/useRoute';
import { useSettingsStore } from '../../state/settings';
import { useUi, type ComposeDraft } from '../../state/ui';
import { signatureBlock, withoutQuotes } from './signatureDom';
import { startingSignature, type SignatureUse } from './signatures';

function me() {
  return queryClient.getQueryData<Account>(keys.account);
}

/** In a merged inbox, the member account. */
function ownerOf(email: string | undefined) {
  const account = me();
  if (!account?.members || !email) return account;
  const e = email.toLowerCase();
  return account.members.find((m) => m.email.toLowerCase() === e || m.sendAs?.some((a) => a.email.toLowerCase() === e)) ?? account;
}

function signatureHtml(from: string | undefined, use: SignatureUse) {
  const account = me();
  const sig = startingSignature(account, ownerOf(from), from ?? account?.email, use);
  // Gmail leaves a blank line between where you type and the signature.
  return sig ? `<br><br>${signatureBlock(sig)}` : '';
}

/** The address the mail was sent to, like Gmail; in a merged inbox always one of the owning account's. */
function replyFrom(threadId: string, m: Message): Address | undefined {
  const account = me();
  if (!account) return undefined;
  const key = splitId(threadId).key;
  const owner = (key && account.members?.find((x) => x.key === key)) || (account.members ? undefined : account);
  if (!owner) return undefined;
  const mine = owner.sendAs?.length ? owner.sendAs : [{ name: owner.name, email: owner.email }];
  const addressed = [...m.to, ...m.cc, m.from].find((a) => mine.some((x) => x.email.toLowerCase() === a.email.toLowerCase()));
  const pick = mine.find((x) => x.email.toLowerCase() === addressed?.email.toLowerCase()) ?? mine.find((x) => x.email.toLowerCase() === owner.email.toLowerCase()) ?? mine[0];
  // Only worth naming when it differs from the default sender.
  return pick && (account.members || pick.email.toLowerCase() !== account.email.toLowerCase()) ? pick : undefined;
}

export function newCompose(partial: Partial<ComposeDraft> = {}) {
  return useUi.getState().openCompose({ mode: 'new', html: partial.html ?? signatureHtml(partial.from?.email, 'new'), ...partial });
}

/** Something shared to the installed app, or files opened with it. Shared text goes in as text. */
export function composeShared({ subject = '', text = '', files }: { subject?: string; text?: string; files?: File[] }) {
  const body = text ? escapeHtml(text).replace(/\r?\n/g, '<br>') : '';
  return newCompose({
    subject,
    ...(body ? { html: body + signatureHtml(undefined, 'new') } : {}),
    ...(files?.length ? { incomingFiles: files } : {}),
  });
}

/** Its body is text the sender chose, so it goes in as text (never markup). */
export function composeFromMailto(href: string) {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return newCompose();
  }
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const params = url.searchParams;
  const to = [decode(url.pathname), ...params.getAll('to')].filter(Boolean).join(',');
  const body = params.get('body') ?? '';
  return newCompose({
    to: parseAddresses(to),
    cc: parseAddresses(params.getAll('cc').join(',')),
    bcc: parseAddresses(params.getAll('bcc').join(',')),
    subject: params.get('subject') ?? '',
    html: (body ? escapeHtml(body).replace(/\r?\n/g, '<br>') : '') + signatureHtml(undefined, 'new'),
  });
}

const strip = (s: string) => s.replace(/^((re|fwd?|aw|wg)\s*:\s*)+/i, '');

function quoteHeader(m: Message) {
  const who = m.from.name ? `${escapeHtml(m.from.name)} &lt;${escapeHtml(m.from.email)}&gt;` : escapeHtml(m.from.email);
  return `On ${fullDate(m.date)} ${who} wrote:`;
}

function quoted(m: Message) {
  const body = m.bodyHtml ?? `<div style="white-space:pre-wrap">${escapeHtml(m.bodyText ?? m.snippet)}</div>`;
  return `<div class="gmail_quote"><div class="gmail_attr">${quoteHeader(m)}<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${body}</blockquote></div>`;
}

function forwarded(m: Message) {
  const list = (as: Address[]) => as.map((a) => (a.name ? `${escapeHtml(a.name)} &lt;${escapeHtml(a.email)}&gt;` : escapeHtml(a.email))).join(', ');
  return `<div class="gmail_quote"><div class="gmail_attr">---------- Forwarded message ---------<br>From: <strong>${list([m.from])}</strong><br>Date: ${fullDate(m.date)}<br>Subject: ${escapeHtml(m.subject)}<br>To: ${list(m.to)}<br>${m.cc.length ? `Cc: ${list(m.cc)}<br>` : ''}</div><br>${m.bodyHtml ?? escapeHtml(m.bodyText ?? '')}</div>`;
}

function recipientsFor(m: Message, mode: 'reply' | 'reply-all'): { to: Address[]; cc: Address[] } {
  const mine = myAddresses(me());
  const fromMe = isMe(m.from.email, mine);
  const replyTo = m.replyTo?.length ? m.replyTo : [m.from];
  const to = fromMe ? m.to : replyTo;
  if (mode === 'reply') return { to, cc: [] };
  const seen = new Set(to.map((a) => a.email.toLowerCase()));
  mine.forEach((e) => seen.add(e));
  const cc = [...m.to, ...m.cc].filter((a) => {
    const e = a.email.toLowerCase();
    if (seen.has(e)) return false;
    seen.add(e);
    return true;
  });
  return { to, cc };
}

/** Reply picks it back up instead of starting another. */
function threadDraft(threadId: string): Message | undefined {
  const thread = queryClient.getQueryData<Thread>(keys.thread(threadId));
  return thread && [...thread.messages].reverse().find((m) => m.isDraft && !m.labelIds.includes('SCHEDULED'));
}

/** Inline in the open thread, or in a docked window when it isn't open. */
export function replyToMessage(threadId: string, m: Message, mode: 'reply' | 'reply-all' | 'forward', html?: string) {
  const inline = getRoute().threadId === threadId;
  const open = useUi.getState().composes.find((c) => c.threadId === threadId && (c.mode === 'reply' || c.mode === 'reply-all'));
  if (mode !== 'forward') {
    if (open) {
      useUi.getState().updateCompose(open.key, { window: open.window === 'minimized' ? 'open' : open.window });
      return open.key;
    }
    const draft = threadDraft(threadId);
    if (draft) return editDraft(draft);
  }
  const references = [m.headers.references, m.headers.messageId].filter(Boolean).join(' ') || undefined;
  const from = replyFrom(threadId, m);
  const base: Partial<ComposeDraft> = {
    mode,
    ...(from ? { from } : {}),
    threadId,
    inline,
    inReplyTo: m.headers.messageId,
    references,
    window: 'open',
  };
  if (mode === 'forward') {
    const draft = useUi.getState().openCompose({
      ...base,
      subject: `Fwd: ${strip(m.subject)}`,
      to: [],
      cc: [],
      html: html ?? signatureHtml(from?.email, 'reply'),
      quoteHtml: forwarded(m),
    });
    void attachOriginals(draft, m);
    return draft;
  }
  const defaultMode = useSettingsStore.getState().settings.defaultReply;
  const effective = mode === 'reply' && defaultMode === 'reply-all' && !html ? 'reply-all' : mode;
  const { to, cc } = recipientsFor(m, effective);
  return useUi.getState().openCompose({
    ...base,
    mode: effective,
    subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${strip(m.subject)}`,
    to,
    cc,
    html: (html ?? '') + signatureHtml(from?.email, 'reply'),
    quoteHtml: quoted(m),
  });
}

/** As Gmail does: recipients, subject and quoted mail follow the new choice, and what you've written stays. */
export function switchMode(key: string, mode: 'reply' | 'reply-all' | 'forward') {
  const d = useUi.getState().composes.find((c) => c.key === key);
  if (!d?.threadId || d.mode === mode) return;
  const thread = queryClient.getQueryData<Thread>(keys.thread(d.threadId));
  const sent = thread?.messages.filter((m) => !m.isDraft) ?? [];
  const m = sent.find((x) => d.inReplyTo && x.headers.messageId === d.inReplyTo) ?? sent.at(-1);
  if (!m) return useUi.getState().updateCompose(key, { mode });
  const originals = new Set(m.attachments.map((a) => a.id));
  // Files that came along with a forward don't stay on a reply.
  const attachments = d.attachments.filter((a) => !originals.has(a.id));
  // A quote you brought in goes; the new choice brings its own.
  const html = withoutQuotes(d.html);
  if (mode === 'forward') {
    useUi.getState().updateCompose(key, { mode, to: [], cc: [], bcc: [], subject: `Fwd: ${strip(m.subject)}`, quoteHtml: forwarded(m), attachments, html });
    void attachOriginals(key, m);
    return;
  }
  const { to, cc } = recipientsFor(m, mode);
  useUi.getState().updateCompose(key, {
    mode,
    to,
    cc,
    bcc: d.mode === 'forward' ? [] : d.bcc,
    subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${strip(m.subject)}`,
    quoteHtml: quoted(m),
    attachments,
    html,
  });
}

async function attachOriginals(key: string, m: Message) {
  const files = m.attachments.filter((a) => !a.inline);
  if (!files.length) return;
  try {
    const attachments = await Promise.all(
      files.map(async (a) => {
        const { data } = await backend().getAttachment(m.id, a.id);
        return { id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size, data };
      }),
    );
    // Switched to a reply while the files loaded, or already attached.
    const current = useUi.getState().composes.find((c) => c.key === key);
    if (!current || current.mode !== 'forward') return;
    const have = new Set(current.attachments.map((a) => a.id));
    const fresh = attachments.filter((a) => !have.has(a.id));
    if (fresh.length) useUi.getState().updateCompose(key, { attachments: [...current.attachments, ...fresh] });
  } catch {
    // Forward still works without them.
  }
}

export async function replyToThread(threadId: string, mode: 'reply' | 'reply-all' | 'forward') {
  const thread = await queryClient.fetchQuery<Thread>({ queryKey: keys.thread(threadId), queryFn: () => backend().getThread(threadId) });
  const last = [...thread.messages].reverse().find((m) => !m.isDraft);
  if (last) replyToMessage(threadId, last, mode);
}

/** Every message in the conversation, oldest first, with their files. */
export function forwardAll(thread: Thread) {
  const messages = thread.messages.filter((m) => !m.isDraft);
  const last = messages.at(-1);
  if (!last) return;
  const draft = useUi.getState().openCompose({
    mode: 'forward',
    threadId: thread.id,
    inline: false,
    window: 'open',
    subject: `Fwd: ${strip(thread.subject || last.subject)}`,
    html: signatureHtml(replyFrom(thread.id, last)?.email, 'reply'),
    quoteHtml: messages.map(forwarded).join('<br>'),
  });
  for (const m of messages) void attachOriginals(draft, m);
  return draft;
}

/** The original's source goes along as an .eml file. */
export async function forwardAsAttachment(threadId: string, m: Message) {
  const raw = await backend().getRawMessage!(m.id);
  const bytes = new TextEncoder().encode(raw);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const name = `${(m.subject || 'message').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'message'}.eml`;
  return useUi.getState().openCompose({
    mode: 'forward',
    threadId,
    inline: false,
    window: 'open',
    subject: `Fwd: ${strip(m.subject)}`,
    html: signatureHtml(replyFrom(threadId, m)?.email, 'reply'),
    attachments: [{ id: crypto.randomUUID(), filename: name, mimeType: 'message/rfc822', size: bytes.length, data: btoa(bin) }],
  });
}

/** The Drafts folder's click: the conversation's draft in a compose window (the one already open, if any). False when there's no draft any more. */
export async function openDraftOf(threadId: string): Promise<boolean> {
  const thread =
    queryClient.getQueryData<Thread>(keys.thread(threadId)) ??
    (await queryClient.fetchQuery({ queryKey: keys.thread(threadId), queryFn: () => backend().getThread(threadId) }));
  const draft = thread && [...thread.messages].reverse().find((m) => m.isDraft && !m.labelIds.includes('SCHEDULED'));
  if (!draft) return false;
  const ui = useUi.getState();
  const open = ui.composes.find((c) => c.draftId === draft.id || c.draftMessageId === draft.id);
  if (open) ui.updateCompose(open.key, { window: 'open' });
  else editDraft(draft);
  return true;
}

/** Inline in its open thread, otherwise in a window. */
export function editDraft(m: Message) {
  const inline = !!m.threadId && getRoute().threadId === m.threadId && !!m.headers.inReplyTo;
  return useUi.getState().openCompose({
    mode: m.headers.inReplyTo ? 'reply' : 'new',
    inline,
    window: 'open',
    draftMessageId: m.id,
    // Keeps a merged inbox's draft with the account it was written in.
    ...(me()?.members ? { from: m.from } : {}),
    draftId: m.id,
    threadId: m.threadId,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    subject: m.subject,
    html: m.bodyHtml ?? escapeHtml(m.bodyText ?? '').replace(/\n/g, '<br>'),
    inReplyTo: m.headers.inReplyTo,
    references: m.headers.references,
  });
}
