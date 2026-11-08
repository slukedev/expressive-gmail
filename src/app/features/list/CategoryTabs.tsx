import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { backend } from '../../data/client';
import { useLabels } from '../../data/hooks';
import { CATEGORY_LABEL } from '../../data/views';
import type { Address } from '../../data/types';
import { participantsLine } from '../../lib/format';
import { navigate, useRoute } from '../../router/useRoute';
import { useSettings } from '../../state/settings';
import { labelChipColors } from '../../theme/color';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Tabs, type TabItem } from '../../ui/Tabs';
import { ShapeIcon } from '../../ui/ShapeIcon';
import { CATEGORY_TABS, viewIdentity } from './viewIdentity';

// Searches again only when the category's unread count moves (label counts already poll), not on every new mail.
function useNewSenders(category: string, unread: number, enabled: boolean) {
  return useQuery({
    queryKey: ['category-peek', category, unread],
    queryFn: () => backend().listThreads({ q: `in:inbox category:${category} is:unread`, pageSize: 4 }),
    enabled: enabled && unread > 0,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function CategoryTabs({ bundles }: { bundles?: boolean }) {
  const route = useRoute();
  const categories = useSettings((s) => s.categories);
  const { data: labels = [] } = useLabels();
  const dark = useResolvedDark();
  const current = route.view.kind === 'category' ? route.view.category : 'primary';
  const enabled = CATEGORY_TABS.filter((t) => t.value === 'primary' || categories[t.value]);

  const unreadOf = (category: string) => labels.find((l) => l.id === CATEGORY_LABEL[category])?.unreadCount ?? 0;
  const peeks = {
    promotions: useNewSenders('promotions', unreadOf('promotions'), categories.promotions && current !== 'promotions'),
    social: useNewSenders('social', unreadOf('social'), categories.social && current !== 'social'),
    updates: useNewSenders('updates', unreadOf('updates'), categories.updates && current !== 'updates'),
    forums: useNewSenders('forums', unreadOf('forums'), categories.forums && current !== 'forums'),
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
            const unread = unreadOf(t.value);
            const colors = labelChipColors(t.hue, dark);
            const peek = peeks[t.value as keyof typeof peeks].data?.threads;
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
                      {unread > 99 ? '99+' : unread} new
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
    const unread = t.value === 'primary' ? 0 : unreadOf(t.value);
    const colors = labelChipColors(t.hue, dark);
    const peek = t.value !== 'primary' ? peeks[t.value].data?.threads : undefined;
    const senders = unread > 0 && peek?.length ? participantsLine(uniqueSenders(peek)) : undefined;
    return {
      value: t.value,
      label: t.label,
      icon: t.icon,
      supporting: unread > 0 && t.value !== current ? senders : undefined,
      badge:
        unread > 0 && t.value !== current ? (
          <span className="tab-badge" style={{ background: colors.bg, color: colors.fg }} aria-label={`${unread} new`}>
            {unread > 99 ? '99+' : unread}
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
