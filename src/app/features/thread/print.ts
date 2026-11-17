import type { Message, Thread } from '../../data/types';
import { fullDate, escapeHtml } from '../../lib/format';
import { contentPolicy, sanitizeEmail } from '../../lib/sanitize';
import { useLocal } from '../../state/local';
import { useSettingsStore } from '../../state/settings';

/** The whole conversation, or only `only` (a message's own Print). */
export function printThread(thread: Pick<Thread, 'subject' | 'messages'>, me?: string, only?: string) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) return;
  // Printing never loads what the reading pane blocked.
  const { externalImages, blockTrackers } = useSettingsStore.getState().settings;
  const { trustedImageSenders } = useLocal.getState();
  const loads = (m: Message) =>
    !m.labelIds.includes('SPAM') && (externalImages === 'always' || trustedImageSenders.includes(m.from.email.toLowerCase()));
  const printed = thread.messages.filter((m) => !m.isDraft && (!only || m.id === only));
  // One policy covers the page, so a thread that mixes trusted and blocked senders allows only the trusted ones' pictures, by address.
  const remote = printed.every(loads);
  const allowed: string[] = [];
  const body = printed
    .map((m) => {
      const html = m.bodyHtml ? sanitizeEmail(m.bodyHtml, { blockRemoteImages: !loads(m), blockTrackers }) : '';
      if (html && !remote && loads(m)) {
        for (const img of new DOMParser().parseFromString(html, 'text/html').images) allowed.push(img.getAttribute('src') ?? '');
      }
      return `<hr style="border:none;height:1px;background:#c4c7c5;margin:0 0 16px"><section style="margin:0 0 24px">
      <p style="margin:0 0 4px"><b>${escapeHtml(m.from.name ?? m.from.email)}</b> &lt;${escapeHtml(m.from.email)}&gt;<span style="float:right">${fullDate(m.date)}</span></p>
      <p style="margin:0 0 12px;color:#444746">To: ${escapeHtml(m.to.map((a) => a.email).join(', '))}</p>
      ${html || `<pre style="white-space:pre-wrap;font:inherit">${escapeHtml(m.bodyText ?? '')}</pre>`}
    </section>`;
    })
    .join('');
  const policy = contentPolicy({ remote, images: allowed });
  w.document.write(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${escapeHtml(policy)}"><title>${escapeHtml(thread.subject)}</title><body style="font:14px/1.5 Arial,sans-serif;margin:32px;color:#1f1f1f">
    <p style="color:#444746">${escapeHtml(me ?? '')}</p><h1 style="font-weight:400;font-size:22px">${escapeHtml(thread.subject || '(no subject)')}</h1>${body}</body>`);
  w.document.close();
  w.focus();
  w.print();
}

export function downloadOriginal(message: Message) {
  const lines = [
    `From: ${message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}`,
    `To: ${message.to.map((a) => a.email).join(', ')}`,
    message.cc.length ? `Cc: ${message.cc.map((a) => a.email).join(', ')}` : '',
    `Subject: ${message.subject}`,
    `Date: ${new Date(message.date).toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: ${message.bodyHtml ? 'text/html' : 'text/plain'}; charset=UTF-8`,
    '',
    message.bodyHtml ?? message.bodyText ?? '',
  ].filter((l, i) => l !== '' || i > 5);
  const blob = new Blob([lines.join('\r\n')], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(message.subject || 'message').replace(/[^\w\s-]/g, '').slice(0, 60) || 'message'}.eml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** In a tab of its own. */
export function showOriginal(raw: string, subject: string) {
  const w = window.open('', '_blank', 'noopener=no');
  if (!w) return;
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Original message: ${escapeHtml(subject || '(no subject)')}</title><body style="margin:24px;background:#fff;color:#1f1f1f"><pre style="white-space:pre-wrap;word-break:break-all;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;margin:0">${escapeHtml(raw)}</pre></body>`);
  w.document.close();
}
