import type { Label } from '../../types';
import { L } from './model';

export const SYSTEM_LABELS: Label[] = [
  { id: 'INBOX', name: 'Inbox', type: 'system' },
  { id: 'STARRED', name: 'Starred', type: 'system' },
  { id: 'SNOOZED', name: 'Snoozed', type: 'system' },
  { id: 'IMPORTANT', name: 'Important', type: 'system' },
  { id: 'SENT', name: 'Sent', type: 'system' },
  { id: 'SCHEDULED', name: 'Scheduled', type: 'system' },
  { id: 'DRAFT', name: 'Drafts', type: 'system' },
  { id: 'SPAM', name: 'Spam', type: 'system' },
  { id: 'TRASH', name: 'Trash', type: 'system' },
  { id: 'UNREAD', name: 'Unread', type: 'system' },
  { id: 'CHAT', name: 'Chats', type: 'system' },
  { id: 'CATEGORY_PERSONAL', name: 'Primary', type: 'system' },
  { id: 'CATEGORY_SOCIAL', name: 'Social', type: 'system' },
  { id: 'CATEGORY_PROMOTIONS', name: 'Promotions', type: 'system' },
  { id: 'CATEGORY_UPDATES', name: 'Updates', type: 'system' },
  { id: 'CATEGORY_FORUMS', name: 'Forums', type: 'system' },
];

/** Colors are pairs from Gmail's label palette. */
export const USER_LABELS: Label[] = [
  { id: L.work, name: 'Work', type: 'user', color: { background: '#4a86e8', text: '#ffffff' } },
  { id: L.designReviews, name: 'Work/Design reviews', type: 'user', color: { background: '#a479e2', text: '#ffffff' } },
  { id: L.travel, name: 'Travel', type: 'user', color: { background: '#16a766', text: '#ffffff' } },
  { id: L.receipts, name: 'Receipts', type: 'user', color: { background: '#ffad47', text: '#ffffff' } },
  { id: L.family, name: 'Family', type: 'user', color: { background: '#fbc8d9', text: '#711a36' } },
  { id: L.sideProject, name: 'Side project', type: 'user', color: { background: '#43d692', text: '#094228' } },
  { id: L.taxes, name: 'Taxes', type: 'user', color: { background: '#cccccc', text: '#434343' }, hidden: true },
];
