import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { backend, withRecentChanges } from '../../data/client';
import { useLabels } from '../../data/hooks';
import { CATEGORY_LABEL } from '../../data/views';
import type { Address, Label, ThreadSummary } from '../../data/types';
import type { View } from '../../router/routes';
import { participantsLine } from '../../lib/format';
import { navigate, useRoute } from '../../router/useRoute';
import { useSettings } from '../../state/settings';
import { labelChipColors } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Tabs, type TabItem } from '../../ui/Tabs';
import { ShapeIcon } from '../../ui/ShapeIcon';
import { CATEGORY_TABS, viewIdentity } from './viewIdentity';
import { countTab, unreadBadge } from './categoryCount';

/**
 * The category's unread mail in the inbox, which is what its tab lists. The category label's own count also takes in
 * archived mail, so someone who archives promotions unread would see "14,000 new" over an empty tab.
 * Gmail usually keeps the inbox tab's count beside the label's, so that comes free with the label poll. When it leaves
 * it out (Updates, on real accounts), the tab's unread threads are listed and counted, up to where the badge says 99+.
 */
export function useCategoryUnread(category: string, labels: Label[], enabled: boolean, { senders = true } = {}) {
  const label = labels.find((l) => l.id === CATEGORY_LABEL[category]);
  const inbox = labels.find((l) => l.id === 'INBOX');
  const labelUnread = label?.unreadCount ?? 0;
  const stored = label?.inboxUnreadCount;
  const known = stored !== undefined;
  const q = `in:inbox category:${category} is:unread`;
  // Counted again whenever the tab could have changed: mail read or unread (the label's count), archived, moved back
  // or arrived (the tab's total, or the inbox's when Gmail sends no tab total).
  const moved = label?.inboxTotalCount ?? `${inbox?.unreadCount} ${inbox?.totalCount}`;
  const query = useQuery({
    queryKey: known ? ['category-peek', category, `tab ${stored}`] : ['category-peek', category, 'count', labelUnread, moved],
    queryFn: known
      ? () => backend().listThreads({ q, pageSize: SENDERS_PAGE }).then((p) => ({ threads: p.threads, more: false }))
      : () => countTab((query) => backend().listThreads(query), q),
    enabled: enabled && (known ? senders && stored > 0 : labelUnread > 0),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
  const data = (known ? stored : labelUnread) > 0 ? query.data : undefined;
  if (known) return { count: stored, more: false, threads: data?.threads };
  if (labelUnread === 0) return { count: 0, more: false, threads: undefined };
  // Undefined until the first count answers, so nothing shows a guess.
  if (!data) return { count: undefined, more: false, threads: undefined };
  // What this tab read or archived since the count, ahead of Gmail's next answer. A full count is 99+ either way.
  const threads = data.more ? data.threads : unreadIn(data.threads, category);
  return { count: threads.length, more: data.more, threads };
}

function unreadIn(threads: ThreadSummary[], category: string) {
  const view = { kind: 'category', category } as View;
  return withRecentChanges({ threads }, view).threads.filter((t) => t.labelIds.includes('UNREAD'));
}

/** Enough for three different senders. */
const SENDERS_PAGE = 4;

export function CategoryTabs({ bundles }: { bundles?: boolean }) {
  const route = useRoute();
  const categories = useSettings((s) => s.categories);
  const { data: labels = [] } = useLabels();
  const dark = useResolvedDark();
  const current = route.view.kind === 'category' ? route.view.category : 'primary';
  const enabled = CATEGORY_TABS.filter((t) => t.value === 'primary' || categories[t.value]);

  const peeks = {
    promotions: useCategoryUnread('promotions', labels, categories.promotions && current !== 'promotions'),
    social: useCategoryUnread('social', labels, categories.social && current !== 'social'),
    updates: useCategoryUnread('updates', labels, categories.updates && current !== 'updates'),
    forums: useCategoryUnread('forums', labels, categories.forums && current !== 'forums'),
  };

  if (enabled.length < 2) return null;

  if (bundles) {
    // Narrow lists get Gmail Android's bundle rows instead of tabs.
    if (current !== 'primary') return null;
    return (
      <div className="seg-list bundles" role="list" aria-label="Inbox categories">
        {enabled
          .filter((t) => t.value !== 'primary')
          .map((t) => {
            const { count: unread = 0, more, threads: peek } = peeks[t.value as keyof typeof peeks];
            const colors = labelChipColors(t.hue, dark);
            // Quiet when there's nothing new: just the name, not "No new mail" three times over.
            const senders = unread > 0 && peek?.length ? participantsLine(uniqueSenders(peek)) : null;
            return (
              <div key={t.value} className="row-wrap" role="listitem">
                <button
                  type="button"
                  className={unread ? 'row bundle row--unread' : 'row bundle'}
                  onClick={() => navigate({ view: { kind: 'category', category: t.value as 'social' } })}
                >
                  <ShapeIcon
                    className="bundle__icon"
                    {...viewIdentity({ kind: 'category', category: t.value }, labels, dark)}
                    size={40}
                    iconSize={20}
                  />
                  <span className="bundle__text">
                    <span className="bundle__title">{t.label}</span>
                    {senders && <span className="bundle__senders">{senders}</span>}
                  </span>
                  {unread > 0 && (
                    <span className="tab-badge bundle__badge" style={{ background: colors.bg, color: colors.fg }}>
                      {unreadBadge(unread, more)} new
                    </span>
                  )}
                </button>
              </div>
            );
          })}
      </div>
    );
  }

  const items: TabItem[] = enabled.map((t) => {
    const { count: unread = 0, more = false, threads: peek } = t.value === 'primary' ? {} : peeks[t.value];
    const colors = labelChipColors(t.hue, dark);
    const senders = unread > 0 && peek?.length ? participantsLine(uniqueSenders(peek)) : undefined;
    return {
      value: t.value,
      label: t.label,
      icon: t.icon,
      supporting: unread > 0 && t.value !== current ? senders : undefined,
      badge:
        unread > 0 && t.value !== current ? (
          <span className="tab-badge" style={{ background: colors.bg, color: colors.fg }} aria-label={`${unreadBadge(unread, more)} new`}>
            {unreadBadge(unread, more)}
            <span className="tab-badge__suffix" aria-hidden="true"> new</span>
          </span>
        ) : undefined,
    };
  });

  return (
    <Tabs
      className="category-tabs"
      label="Inbox categories"
      items={items}
      value={current}
      onValueChange={(v) =>
        navigate({ view: v === 'primary' ? { kind: 'folder', folder: 'inbox' } : { kind: 'category', category: v as 'social' } })
      }
    />
  );
}

// A shop that sent three of the latest mails shows once.
function uniqueSenders(peek: { participants: Address[] }[]) {
  const seen = new Set<string>();
  return peek
    .flatMap((p) => p.participants.slice(-1))
    .filter((a) => !seen.has(a.name || a.email) && seen.add(a.name || a.email))
    .slice(0, 3);
}
