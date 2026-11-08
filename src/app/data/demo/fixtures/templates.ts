/** Transactional HTML (receipts, notices), with table layouts and inline styles the way real mail is built. */
import { escapeHtml, svgDataUri } from '../util';

export interface Brand {
  name: string;
  color: string;
  /** Text color on `color`. */
  ink?: string;
  mark: string;
  address: string;
}

function logo(b: Brand, size = 32): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="${b.color}"/><text x="16" y="21.5" font-family="Helvetica,Arial,sans-serif" font-size="15" font-weight="700" fill="${b.ink ?? '#fff'}" text-anchor="middle">${escapeHtml(b.mark)}</text></svg>`;
  return `<img src="${svgDataUri(svg)}" width="${size}" height="${size}" alt="${escapeHtml(b.name)}" style="display:block;border:0">`;
}

/** The first thing a mail client reads for the snippet. */
export function preheader(text: string): string {
  return `<div class="preheader" style="display:none;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeHtml(text)}</div>`;
}

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function shell(b: Brand, inner: string, pre: string, footerExtra = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f5f7">${preheader(pre)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;font-family:Helvetica,Arial,sans-serif;color:#1f1f1f">
<tr><td style="padding:24px 28px 8px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td>${logo(b)}</td><td style="padding-left:10px;font-size:16px;font-weight:700">${escapeHtml(b.name)}</td></tr></table></td></tr>
${inner}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:Helvetica,Arial,sans-serif"><tr><td style="padding:16px 28px;font-size:12px;line-height:18px;color:#6b6f76;text-align:center">${footerExtra}${escapeHtml(b.name)}, ${escapeHtml(b.address)}</td></tr></table>
</td></tr></table></body></html>`;
}

export function button(label: string, href: string, color: string, ink = '#ffffff'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:100px;background:${color}"><a href="${href}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:700;color:${ink};text-decoration:none;font-family:Helvetica,Arial,sans-serif">${escapeHtml(label)}</a></td></tr></table>`;
}

export interface NoticeOptions {
  heading: string;
  /** Paragraphs, already HTML. */
  body: string[];
  button?: { label: string; href: string };
  /** A 2FA code, big and monospace. */
  code?: string;
  /** Key/value facts shown in a light box. */
  facts?: [string, string][];
  fine?: string;
  preheader?: string;
}

export function notice(b: Brand, o: NoticeOptions): string {
  const facts = o.facts
    ? `<tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;border-radius:8px">${o.facts
        .map(
          ([k, v]) =>
            `<tr><td style="padding:8px 14px;font-size:13px;color:#6b6f76">${escapeHtml(k)}</td><td style="padding:8px 14px;font-size:13px;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`,
        )
        .join('')}</table></td></tr>`
    : '';
  const inner = `
<tr><td style="padding:16px 28px 4px;font-size:22px;line-height:28px;font-weight:700">${escapeHtml(o.heading)}</td></tr>
${o.body.map((p) => `<tr><td style="padding:8px 28px;font-size:15px;line-height:22px;color:#3c4043">${p}</td></tr>`).join('')}
${o.code ? `<tr><td style="padding:16px 28px"><div style="font-family:Menlo,Consolas,monospace;font-size:34px;letter-spacing:8px;font-weight:700;background:#f6f7f9;border-radius:8px;padding:16px;text-align:center">${escapeHtml(o.code)}</div></td></tr>` : ''}
${facts}
${o.button ? `<tr><td style="padding:16px 28px 8px">${button(o.button.label, o.button.href, b.color, b.ink)}</td></tr>` : ''}
${o.fine ? `<tr><td style="padding:16px 28px 24px;font-size:12px;line-height:18px;color:#6b6f76">${o.fine}</td></tr>` : '<tr><td style="padding:12px"></td></tr>'}`;
  return shell(b, inner, o.preheader ?? `${o.heading}. ${plain(o.body[0] ?? '')}`);
}

export interface ReceiptOptions {
  heading: string;
  intro: string;
  orderNo: string;
  date: string;
  items: { name: string; detail?: string; qty?: number; price: number }[];
  shipping?: number;
  tax?: number;
  tip?: number;
  payment: string;
  button?: { label: string; href: string };
}

const money = (n: number) => `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

export function receiptTotal(o: Pick<ReceiptOptions, 'items' | 'shipping' | 'tax' | 'tip'>): number {
  const sub = o.items.reduce((s, i) => s + i.price * (i.qty ?? 1), 0);
  return sub + (o.shipping ?? 0) + (o.tax ?? 0) + (o.tip ?? 0);
}

export function receipt(b: Brand, o: ReceiptOptions): string {
  const sub = o.items.reduce((s, i) => s + i.price * (i.qty ?? 1), 0);
  const total = receiptTotal(o);
  const row = (k: string, v: string, strong = false) =>
    `<tr><td style="padding:4px 0;font-size:14px;color:${strong ? '#1f1f1f' : '#5f6368'};${strong ? 'font-weight:700;' : ''}">${k}</td><td style="padding:4px 0;font-size:14px;text-align:right;${strong ? 'font-weight:700;' : ''}">${v}</td></tr>`;
  const inner = `
<tr><td style="padding:16px 28px 4px;font-size:22px;line-height:28px;font-weight:700">${escapeHtml(o.heading)}</td></tr>
<tr><td style="padding:4px 28px 12px;font-size:15px;line-height:22px;color:#3c4043">${o.intro}</td></tr>
<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:#6b6f76"><tr><td>Order ${escapeHtml(o.orderNo)}</td><td style="text-align:right">${escapeHtml(o.date)}</td></tr></table></td></tr>
<tr><td style="padding:12px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e3e3">
${o.items
  .map(
    (i) =>
      `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px"><div style="font-weight:600">${escapeHtml(i.name)}${i.qty && i.qty > 1 ? ` &times; ${i.qty}` : ''}</div>${i.detail ? `<div style="color:#6b6f76;font-size:13px;padding-top:2px">${escapeHtml(i.detail)}</div>` : ''}</td><td style="padding:12px 0;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;vertical-align:top">${money(i.price * (i.qty ?? 1))}</td></tr>`,
  )
  .join('')}
</table></td></tr>
<tr><td style="padding:0 28px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row('Subtotal', money(sub))}
${o.shipping != null ? row('Shipping', o.shipping ? money(o.shipping) : 'Free') : ''}
${o.tip != null ? row('Tip', money(o.tip)) : ''}
${o.tax != null ? row('Tax', money(o.tax)) : ''}
${row('Total', money(total), true)}
${row('Paid with', escapeHtml(o.payment))}
</table></td></tr>
${o.button ? `<tr><td style="padding:12px 28px 8px">${button(o.button.label, o.button.href, b.color, b.ink)}</td></tr>` : ''}
<tr><td style="padding:16px 28px 24px;font-size:12px;color:#6b6f76">Questions about this order? Just reply to this email.</td></tr>`;
  return shell(b, inner, `${o.heading}. ${plain(o.intro)} Total ${money(total)}.`);
}

/** Plain, link heavy, threaded by the tool. */
export function devNote(o: { repo: string; body: string; link: string; reason: string }): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:#1f2328">
${o.body}
<p style="font-size:12px;color:#59636e;border-top:1px solid #d1d9e0;padding-top:10px;margin-top:20px">
Reply to this email directly, <a href="${o.link}" style="color:#0969da">view it on Codehub</a>, or <a href="https://codehub.example/notifications/unsubscribe" style="color:#0969da">unsubscribe</a>.<br>
You are receiving this because ${escapeHtml(o.reason)}. ${escapeHtml(o.repo)}</p></div>`;
}

