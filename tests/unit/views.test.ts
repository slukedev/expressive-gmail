import { stillInView, viewQuery } from '../../src/app/data/views';
import type { View } from '../../src/app/router/routes';
import type { Label, LabelId } from '../../src/app/data/types';

type ViewSettings = Parameters<typeof viewQuery>[1];

const ALL_TABS = { social: true, promotions: true, updates: true, forums: true };
const SOME_TABS = { social: true, promotions: false, updates: true, forums: false };
const NO_TABS = { social: false, promotions: false, updates: false, forums: false };
const SPLITS = [{ id: 'receipts', name: 'Receipts', query: 'label:Receipts OR from:billing' }];

const settings = (inboxType: ViewSettings['inboxType'], categories = SOME_TABS): ViewSettings => ({ inboxType, categories, splits: SPLITS });

describe('viewQuery', () => {
  it.each<[string, View, ViewSettings, string]>([
    ['inbox with every tab enabled', { kind: 'folder', folder: 'inbox' }, settings('categories', ALL_TABS), 'in:inbox -category:social -category:promotions -category:updates -category:forums'],
    ['inbox excludes only enabled tabs', { kind: 'folder', folder: 'inbox' }, settings('categories'), 'in:inbox -category:social -category:updates'],
    ['inbox with categories on but no tabs', { kind: 'folder', folder: 'inbox' }, settings('categories', NO_TABS), 'in:inbox'],
    ['inbox when not using categories ignores tabs', { kind: 'folder', folder: 'inbox' }, settings('unread-first', ALL_TABS), 'in:inbox'],
    ['primary is the categorized inbox', { kind: 'category', category: 'primary' }, settings('categories'), 'in:inbox -category:social -category:updates'],
    ['primary outside categories mode is the whole inbox', { kind: 'category', category: 'primary' }, settings('everything'), 'in:inbox'],
    ['a disabled tab still queries its category', { kind: 'category', category: 'promotions' }, settings('categories'), 'in:inbox category:promotions'],
    ['social', { kind: 'category', category: 'social' }, settings('everything'), 'in:inbox category:social'],
    ['starred', { kind: 'folder', folder: 'starred' }, settings('categories'), 'is:starred'],
    ['important', { kind: 'folder', folder: 'imp' }, settings('categories'), 'is:important'],
    ['snoozed', { kind: 'folder', folder: 'snoozed' }, settings('categories'), 'in:snoozed'],
    ['all mail', { kind: 'folder', folder: 'all' }, settings('categories'), 'in:all'],
    ['plain label', { kind: 'label', label: 'Receipts' }, settings('categories'), 'label:Receipts'],
    ['nested label with a space is quoted', { kind: 'label', label: 'Work/Design reviews' }, settings('categories'), 'label:"Work/Design reviews"'],
    ['label with quotes and parens drops the quotes', { kind: 'label', label: 'Say "hi" (old)' }, settings('categories'), 'label:"Say hi (old)"'],
    ['search passes through', { kind: 'search', query: 'from:ana -is:read' }, settings('categories'), 'from:ana -is:read'],
    ['known split uses its query', { kind: 'split', id: 'receipts' }, settings('categories'), 'label:Receipts OR from:billing'],
    ['deleted split falls back to the inbox', { kind: 'split', id: 'gone' }, settings('categories'), 'in:inbox'],
  ])('%s', (_name, view, s, expected) => {
    expect(viewQuery(view, s)).toBe(expected);
  });
});

describe('stillInView', () => {
  const LABELS: Label[] = [
    { id: 'Label_7', name: 'Work/Design reviews', type: 'user' },
    { id: 'Label_8', name: 'Work', type: 'user' },
  ];
  const t = (...labelIds: LabelId[]) => ({ labelIds });
  const inbox: View = { kind: 'folder', folder: 'inbox' };
  const starred: View = { kind: 'folder', folder: 'starred' };
  const sent: View = { kind: 'folder', folder: 'sent' };
  const all: View = { kind: 'folder', folder: 'all' };
  const spam: View = { kind: 'folder', folder: 'spam' };
  const drafts: View = { kind: 'folder', folder: 'drafts' };
  const scheduled: View = { kind: 'folder', folder: 'scheduled' };
  const design: View = { kind: 'label', label: 'Work/Design reviews' };
  const social: View = { kind: 'category', category: 'social' };
  const primary: View = { kind: 'category', category: 'primary' };
  const search: View = { kind: 'search', query: 'from:ana' };
  const split: View = { kind: 'split', id: 'receipts' };

  it.each<[string, View, LabelId[], boolean | undefined]>([
    ['inbox thread stays in the inbox', inbox, ['INBOX', 'UNREAD'], true],
    ['archived thread leaves the inbox', inbox, ['STARRED'], false],
    ['trashed thread leaves the inbox even with INBOX still set', inbox, ['INBOX', 'TRASH'], false],
    ['spam leaves starred', starred, ['STARRED', 'SPAM'], false],
    ['trashed thread leaves starred', starred, ['STARRED', 'TRASH'], false],
    ['unstarred thread leaves starred', starred, ['INBOX'], false],
    ['spam reply stays in sent', sent, ['SENT', 'SPAM'], true],
    ['trashed sent thread leaves sent', sent, ['SENT', 'TRASH'], false],
    ['archived thread stays in all mail', all, ['Label_8'], true],
    ['trashed thread leaves all mail', all, ['TRASH'], false],
    ['spam view keeps spam', spam, ['SPAM', 'INBOX'], true],
    ['a deleted draft leaves Drafts even with DRAFT still set', drafts, ['DRAFT', 'TRASH'], false],
    ['a deleted scheduled message leaves Scheduled', scheduled, ['SCHEDULED', 'TRASH'], false],
    ['label view keeps a labelled thread', design, ['Label_7'], true],
    ['label view drops a thread when the label is removed', design, ['Label_8'], false],
    ['label view drops a trashed thread', design, ['Label_7', 'TRASH'], false],
    ['social tab keeps an inbox social thread', social, ['INBOX', 'CATEGORY_SOCIAL'], true],
    ['archived social thread leaves the tab', social, ['CATEGORY_SOCIAL'], false],
    ['primary keeps an inbox thread', primary, ['INBOX', 'CATEGORY_PERSONAL'], true],
    ['search cannot tell after a star', search, ['STARRED'], undefined],
    ['search drops a trashed thread', search, ['TRASH'], false],
    ['split cannot tell after archiving', split, [], undefined],
    ['split drops spam', split, ['SPAM'], false],
  ])('%s', (_name, view, labelIds, expected) => {
    expect(stillInView(view, t(...labelIds), LABELS)).toBe(expected);
  });

  it('a label view for a label it does not know cannot tell', () => {
    expect(stillInView({ kind: 'label', label: 'Old name' }, t('Label_7'), LABELS)).toBeUndefined();
  });

  it('label lookup is by full name, so a parent label view does not claim a child label thread', () => {
    expect(stillInView({ kind: 'label', label: 'Work' }, t('Label_7'), LABELS)).toBe(false);
  });
});
