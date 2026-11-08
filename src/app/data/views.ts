import type { Settings } from '../state/settings';
import type { View } from '../router/routes';
import type { Label, LabelId, ThreadSummary } from './types';

export const CATEGORY_LABEL: Record<string, LabelId> = {
  primary: 'CATEGORY_PERSONAL',
  social: 'CATEGORY_SOCIAL',
  promotions: 'CATEGORY_PROMOTIONS',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS',
};

function quoteLabel(name: string) {
  return /[\s"()]/.test(name) ? `"${name.replace(/"/g, '')}"` : name;
}

function enabledCategories(settings: Pick<Settings, 'categories'>) {
  return (['social', 'promotions', 'updates', 'forums'] as const).filter((c) => settings.categories[c]);
}

/** The Gmail search query behind each view. */
export function viewQuery(view: View, settings: Pick<Settings, 'inboxType' | 'categories' | 'splits'>): string {
  switch (view.kind) {
    case 'folder':
      switch (view.folder) {
        case 'inbox': {
          if (settings.inboxType !== 'categories') return 'in:inbox';
          const others = enabledCategories(settings);
          // Primary holds everything not claimed by an enabled tab, like Gmail.
          return others.length ? `in:inbox ${others.map((c) => `-category:${c}`).join(' ')}` : 'in:inbox';
        }
        case 'starred':
          return 'is:starred';
        case 'snoozed':
          return 'in:snoozed';
        case 'imp':
          return 'is:important';
        case 'sent':
          return 'in:sent';
        case 'scheduled':
          return 'in:scheduled';
        case 'drafts':
          return 'in:drafts';
        case 'all':
          return 'in:all';
        case 'spam':
          return 'in:spam';
        case 'trash':
          return 'in:trash';
      }
      break;
    case 'category':
      return view.category === 'primary' ? viewQuery({ kind: 'folder', folder: 'inbox' }, settings) : `in:inbox category:${view.category}`;
    case 'label':
      return `label:${quoteLabel(view.label)}`;
    case 'search':
      return view.query;
    case 'split':
      return settings.splits.find((s) => s.id === view.id)?.query ?? 'in:inbox';
  }
  return 'in:inbox';
}

/** For optimistic updates. Undefined when we can't tell (searches); the list keeps it until the next refetch. */
export function stillInView(view: View, thread: Pick<ThreadSummary, 'labelIds'>, labels: Label[]): boolean | undefined {
  const has = (id: LabelId) => thread.labelIds.includes(id);
  const binned = has('TRASH') || has('SPAM');
  switch (view.kind) {
    case 'folder':
      switch (view.folder) {
        case 'inbox':
          return has('INBOX') && !binned;
        case 'starred':
          return has('STARRED') && !binned;
        case 'snoozed':
          return has('SNOOZED') && !binned;
        case 'imp':
          return has('IMPORTANT') && !binned;
        case 'sent':
          return has('SENT') && !has('TRASH');
        case 'scheduled':
          return has('SCHEDULED') && !has('TRASH');
        case 'drafts':
          return has('DRAFT') && !has('TRASH');
        case 'all':
          return !binned;
        case 'spam':
          return has('SPAM');
        case 'trash':
          return has('TRASH');
      }
      break;
    case 'category':
      return has('INBOX') && !binned && (view.category === 'primary' || has(CATEGORY_LABEL[view.category]));
    case 'label': {
      const label = labels.find((l) => l.name === view.label);
      return binned ? false : label ? has(label.id) : undefined;
    }
    default:
      return binned ? false : undefined;
  }
  return undefined;
}

export function viewTitle(view: View, splits: Settings['splits']): string {
  switch (view.kind) {
    case 'folder':
      return {
        inbox: 'Inbox',
        starred: 'Starred',
        snoozed: 'Snoozed',
        imp: 'Important',
        sent: 'Sent',
        scheduled: 'Scheduled',
        drafts: 'Drafts',
        all: 'All mail',
        spam: 'Spam',
        trash: 'Trash',
      }[view.folder];
    case 'category':
      return view.category[0].toUpperCase() + view.category.slice(1);
    case 'label':
      return view.label.split('/').pop() ?? view.label;
    case 'search':
      return 'Search results';
    case 'split':
      return splits.find((s) => s.id === view.id)?.name ?? 'Split';
    case 'subscriptions':
      return 'Subscriptions';
    case 'attachments':
      return 'Attachments';
    case 'reminders':
      return 'Follow-ups';
    case 'purchases':
      return 'Purchases';
    case 'storage':
      return 'Storage';
    case 'ai-inbox':
      return 'AI Inbox';
  }
}
