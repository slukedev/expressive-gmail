import type { Label, LabelColor } from '../types';
import type { GmailLabel } from './gmail-types';

const SYSTEM_NAMES: Record<string, string> = {
  INBOX: 'Inbox',
  STARRED: 'Starred',
  UNREAD: 'Unread',
  IMPORTANT: 'Important',
  SENT: 'Sent',
  DRAFT: 'Drafts',
  SPAM: 'Spam',
  TRASH: 'Trash',
  CHAT: 'Chats',
  SNOOZED: 'Snoozed',
  SCHEDULED: 'Scheduled',
  CATEGORY_PERSONAL: 'Primary',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
};

/** The only colors labels.create/update accept (Gmail API reference, Label.color), for background and text alike. */
const GMAIL_LABEL_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#efefef', '#f3f3f3', '#ffffff',
  '#fb4c2f', '#ffad47', '#fad165', '#16a766', '#43d692', '#4a86e8', '#a479e2', '#f691b3',
  '#f6c5be', '#ffe6c7', '#fef1d1', '#b9e4d0', '#c6f3de', '#c9daf8', '#e4d7f5', '#fcdee8',
  '#efa093', '#ffd6a2', '#fce8b3', '#89d3b2', '#a0eac9', '#a4c2f4', '#d0bcf1', '#fbc8d9',
  '#e66550', '#ffbc6b', '#fcda83', '#44b984', '#68dfa9', '#6d9eeb', '#b694e8', '#f7a7c0',
  '#cc3a21', '#eaa041', '#f2c960', '#149e60', '#3dc789', '#3c78d8', '#8e63ce', '#e07798',
  '#ac2b16', '#cf8933', '#d5ae49', '#0b804b', '#2a9c68', '#285bac', '#653e9b', '#b65775',
  '#822111', '#a46a21', '#aa8831', '#076239', '#1a764d', '#1c4587', '#41236d', '#83334c',
  '#464646', '#e7e7e7', '#0d3472', '#b6cff5', '#0d3b44', '#98d7e4', '#3d188e', '#e3d7ff',
  '#711a36', '#fbd3e0', '#8a1c0a', '#f2b2a8', '#7a2e0b', '#ffc8af', '#7a4706', '#ffdeb5',
  '#594c05', '#fbe983', '#684e07', '#fdedc1', '#0b4f30', '#b3efd3', '#04502e', '#a2dcc1',
  '#c2c2c2', '#4986e7', '#2da2bb', '#b99aff', '#994a64', '#f691b2', '#ff7537', '#ffad46',
  '#662e37', '#ebdbde', '#cca6ac', '#094228', '#42d692', '#16a765',
] as const;

function hexToRgb(hex: string): [number, number, number] | undefined {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return undefined;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Squared RGB distance; unparseable input maps to gray. */
function snapLabelColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#999999';
  let best: string = GMAIL_LABEL_COLORS[0];
  let bestDistance = Infinity;
  for (const candidate of GMAIL_LABEL_COLORS) {
    const c = hexToRgb(candidate)!;
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = candidate;
    }
  }
  return best;
}

export function toGmailColor(color: LabelColor): { backgroundColor: string; textColor: string } {
  return { backgroundColor: snapLabelColor(color.background), textColor: snapLabelColor(color.text) };
}

export function toLabel(label: GmailLabel): Label {
  const type = label.type === 'system' ? 'system' : 'user';
  const out: Label = {
    id: label.id,
    name: type === 'system' ? (SYSTEM_NAMES[label.id] ?? label.name) : label.name,
    type,
  };
  if (label.color?.backgroundColor && label.color.textColor) {
    out.color = { background: label.color.backgroundColor, text: label.color.textColor };
  }
  if (label.threadsUnread !== undefined) out.unreadCount = label.threadsUnread;
  if (label.threadsTotal !== undefined) out.totalCount = label.threadsTotal;
  if (label.labelListVisibility === 'labelHide') out.hidden = true;
  return out;
}
