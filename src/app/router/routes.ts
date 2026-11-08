/** Hash routes matching Gmail's own URLs, so links work in both UIs. */
export type Folder =
  | 'inbox'
  | 'starred'
  | 'snoozed'
  | 'imp'
  | 'sent'
  | 'scheduled'
  | 'drafts'
  | 'all'
  | 'spam'
  | 'trash';

export type View =
  | { kind: 'folder'; folder: Folder }
  | { kind: 'category'; category: 'primary' | 'social' | 'promotions' | 'updates' | 'forums' }
  | { kind: 'label'; label: string }
  | { kind: 'search'; query: string }
  | { kind: 'split'; id: string }
  | { kind: 'subscriptions' }
  | { kind: 'attachments' }
  | { kind: 'reminders' }
  | { kind: 'purchases' }
  | { kind: 'storage' }
  | { kind: 'ai-inbox' };

export interface Route {
  view: View;
  threadId?: string;
  settings?: string;
}

const FOLDERS: Folder[] = ['inbox', 'starred', 'snoozed', 'imp', 'sent', 'scheduled', 'drafts', 'all', 'spam', 'trash'];
const CATEGORIES: string[] = ['primary', 'social', 'promotions', 'updates', 'forums'];

export function parseHash(hash: string): Route {
  // Gmail tacks "?compose=..." onto any view; it isn't part of the route.
  const raw = hash.replace(/^#/, '').split('?')[0];
  const [head, ...rest] = raw.split('/');
  // "+" is Gmail's space; a literal plus arrives as %2B.
  const seg = (i: number) => {
    if (rest[i] === undefined) return undefined;
    try {
      return decodeURIComponent(rest[i].replace(/\+/g, ' '));
    } catch {
      return rest[i];
    }
  };

  if (head === 'settings') return { view: { kind: 'folder', folder: 'inbox' }, settings: seg(0) ?? 'general' };
  if ((FOLDERS as string[]).includes(head)) {
    return { view: { kind: 'folder', folder: head as Folder }, threadId: seg(0) || undefined };
  }
  if (head === 'category' && seg(0)) {
    const category = seg(0) as 'primary' | 'social' | 'promotions' | 'updates' | 'forums';
    // A tab that doesn't exist would search for a category no mail has.
    if (!CATEGORIES.includes(category)) return { view: { kind: 'folder', folder: 'inbox' }, threadId: seg(1) || undefined };
    return { view: { kind: 'category', category }, threadId: seg(1) || undefined };
  }
  if (head === 'label' && seg(0)) {
    // Nested labels keep "/" in the name, with + for spaces.
    return { view: { kind: 'label', label: seg(0)! }, threadId: seg(1) || undefined };
  }
  if ((head === 'search' || head === 'advanced-search') && rest.length) {
    return { view: { kind: 'search', query: seg(0)! }, threadId: seg(1) || undefined };
  }
  if (head === 'split' && seg(0)) return { view: { kind: 'split', id: seg(0)! }, threadId: seg(1) || undefined };
  if (head === 'subscriptions') return { view: { kind: 'subscriptions' } };
  if (head === 'attachments') return { view: { kind: 'attachments' }, threadId: seg(0) || undefined };
  if (head === 'reminders') return { view: { kind: 'reminders' }, threadId: seg(0) || undefined };
  if (head === 'purchases') return { view: { kind: 'purchases' }, threadId: seg(0) || undefined };
  if (head === 'storage') return { view: { kind: 'storage' }, threadId: seg(0) || undefined };
  if (head === 'ai-inbox') return { view: { kind: 'ai-inbox' }, threadId: seg(0) || undefined };
  return { view: { kind: 'folder', folder: 'inbox' } };
}

export function viewToHash(view: View): string {
  switch (view.kind) {
    case 'folder':
      return `#${view.folder}`;
    case 'category':
      return `#category/${view.category}`;
    case 'label':
      return `#label/${encodeURIComponent(view.label).replace(/%20/g, '+')}`;
    case 'search':
      return `#search/${encodeURIComponent(view.query).replace(/%20/g, '+')}`;
    case 'split':
      return `#split/${encodeURIComponent(view.id)}`;
    case 'subscriptions':
      return '#subscriptions';
    case 'attachments':
      return '#attachments';
    case 'reminders':
      return '#reminders';
    case 'purchases':
      return '#purchases';
    case 'storage':
      return '#storage';
    case 'ai-inbox':
      return '#ai-inbox';
  }
}

export function routeToHash(route: Route): string {
  if (route.settings) return `#settings/${route.settings}`;
  const base = viewToHash(route.view);
  return route.threadId ? `${base}/${encodeURIComponent(route.threadId)}` : base;
}

/** Where a new tab starts and the Gmail logo leads. */
export function homeView(start: 'inbox' | 'all'): View {
  return { kind: 'folder', folder: start };
}

export function sameView(a: View, b: View) {
  return viewToHash(a) === viewToHash(b);
}
