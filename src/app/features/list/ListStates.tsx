import { useEffect } from 'react';
import { hostDiag } from '../../lib/host';
import { BackendError } from '../../data/backend';
import type { View } from '../../router/routes';
import { navigate } from '../../router/useRoute';
import { Button } from '../../ui/Button';
import { EmptyArt } from '../../ui/EmptyArt';
import { ShapeIcon } from '../../ui/ShapeIcon';
import { MaterialShapes, roundedPolygonToPath } from 'material-shapes-ts';
import { Diagnostics } from '../../ui/Diagnostics';
import type { IconName } from '../../ui/Icon';
import { readsAsQuestion } from '../../data/gemini';
import { useGeminiFeature } from '../gemini/useGemini';

const EMPTY: Record<string, { icon: IconName; title: string; text: string }> = {
  inbox: { icon: 'done_all', title: "You're all caught up", text: 'New mail will show up here.' },
  primary: { icon: 'done_all', title: "You're all caught up", text: 'New mail will show up here.' },
  social: { icon: 'group', title: 'Nothing in Social', text: 'Messages from social networks and media sites show up here.' },
  promotions: { icon: 'sell', title: 'Nothing in Promotions', text: 'Deals, offers and other marketing emails show up here.' },
  updates: { icon: 'info', title: 'Nothing in Updates', text: 'Confirmations, receipts, bills and statements show up here.' },
  forums: { icon: 'forum', title: 'Nothing in Forums', text: 'Messages from online groups and mailing lists show up here.' },
  starred: { icon: 'star', title: 'No starred messages', text: 'Star a conversation to find it here later.' },
  snoozed: { icon: 'schedule', title: 'Nothing snoozed', text: 'Snoozed conversations come back to your inbox when you choose.' },
  imp: { icon: 'label_important', title: 'No important messages', text: 'Mail Gmail marks as important shows up here.' },
  sent: { icon: 'send', title: 'No sent messages', text: 'Send one and it shows up here.' },
  scheduled: { icon: 'schedule_send', title: 'Nothing scheduled', text: 'Use the arrow next to Send to send a message later.' },
  drafts: { icon: 'draft', title: 'No drafts', text: 'Messages you start but don’t send are saved here.' },
  all: { icon: 'stacks', title: 'No conversations', text: 'Everything you receive, send and archive shows up here.' },
  spam: { icon: 'report', title: 'Hooray, no spam here', text: 'Messages in Spam are deleted after 30 days.' },
  trash: { icon: 'delete', title: 'Trash is empty', text: 'Messages in Trash are deleted after 30 days.' },
};

const SEARCH_EMPTY = { icon: 'search_off' as IconName, title: 'No messages matched your search', text: 'Try different words, or check the filters above.' };

export function ListEmpty({ view, filtered, onClearFilters }: { view: View; filtered?: string; onClearFilters?: () => void }) {
  if (filtered) {
    return (
      <div className="empty" role="status">
        <EmptyArt icon="filter_list" />
        <h2 className="md-title-large empty__title">Nothing matches these filters</h2>
        <p className="md-body-medium empty__text">No {filtered} conversations in this view.</p>
        {onClearFilters && (
          <Button variant="tonal" icon="close" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }
  let key = 'inbox';
  if (view.kind === 'folder') key = view.folder;
  if (view.kind === 'category') key = view.category;
  const content =
    view.kind === 'search'
      ? SEARCH_EMPTY
      : view.kind === 'label'
        ? { icon: 'label' as IconName, title: `No conversations in “${view.label.split('/').pop()}”`, text: 'Apply this label to a conversation and it shows up here.' }
        : view.kind === 'split'
          ? { icon: 'filter_alt' as IconName, title: 'Nothing in this split', text: 'Mail that matches its search will show up here.' }
          : EMPTY[key];
  if (key === 'inbox' || key === 'primary') {
    if (view.kind === 'folder' || view.kind === 'category') return <InboxZero />;
  }
  if (view.kind === 'search') return <SearchEmpty query={view.query} />;
  return (
    <div className="empty" role="status">
      <EmptyArt icon={content.icon} />
      <h2 className="md-title-large empty__title">{content.title}</h2>
      <p className="md-body-medium empty__text">{content.text}</p>
    </div>
  );
}

/** A question Gemini answers above leaves a quiet line, not a second, contradicting empty state. */
function SearchEmpty({ query }: { query: string }) {
  const content = SEARCH_EMPTY;
  const answered = useGeminiFeature('search', 'geminiSearch') && readsAsQuestion(query);
  const everywhere = () => navigate({ view: { kind: 'search', query: `${query} in:anywhere` } });
  if (answered) {
    return (
      <div className="empty empty--quiet" role="status">
        <p className="md-body-medium empty__text">No messages contain all of those words.</p>
        <Button variant="text" size="s" onClick={everywhere}>
          Search Spam and Trash too
        </Button>
      </div>
    );
  }
  return (
    <div className="empty" role="status">
      <EmptyArt icon={content.icon} />
      <h2 className="md-title-large empty__title">{content.title}</h2>
      <p className="md-body-medium empty__text">{content.text}</p>
      <Button variant="tonal" icon="stacks" onClick={everywhere}>
        Search Spam and Trash too
      </Button>
    </div>
  );
}

const SOFT_BURST = roundedPolygonToPath(MaterialShapes.SoftBurst).toSvgPathData();
const PILL = roundedPolygonToPath(MaterialShapes.Cookie4Sided).toSvgPathData();

/** Three shapes settle in around the check. */
function InboxZero() {
  return (
    <div className="empty inbox-zero" role="status">
      <span className="inbox-zero__art" aria-hidden="true">
        <ShapeIcon className="inbox-zero__shape inbox-zero__shape--a" shape="Sunny" icon="done_all" size={136} iconSize={48} bg="var(--md-sys-color-primary-container)" fg="var(--md-sys-color-on-primary-container)" />
        <svg className="inbox-zero__shape inbox-zero__shape--b" viewBox="0 0 1 1">
          <path d={SOFT_BURST} />
        </svg>
        <svg className="inbox-zero__shape inbox-zero__shape--c" viewBox="0 0 1 1">
          <path d={PILL} />
        </svg>
      </span>
      <h2 className="inbox-zero__title">You're all caught up</h2>
      <p className="md-body-large empty__text">New mail will show up here.</p>
    </div>
  );
}

export function ListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  useEffect(() => {
    hostDiag(`list failed: ${error instanceof BackendError ? `${error.code}, ` : ''}${(error as Error)?.message ?? String(error)}`);
  }, [error]);
  const offline = !navigator.onLine || (error instanceof BackendError && error.code === 'network');
  const session = error instanceof BackendError && (error.code === 'unauthenticated' || error.code === 'session-unavailable');
  return (
    <div className="empty" role="alert">
      <EmptyArt icon={offline ? 'wifi_off' : session ? 'sync_problem' : 'error'} tone="error" />
      <h2 className="md-title-large empty__title">
        {offline ? "You're offline" : session ? 'Your Gmail session ended' : "Couldn't load your mail"}
      </h2>
      <p className="md-body-medium empty__text">
        {offline
          ? 'Check your connection. Your mail will load when you’re back online.'
          : session
            ? 'Reload Gmail to sign in again.'
            : error instanceof Error
              ? error.message
              : 'Gmail didn’t respond.'}
      </p>
      <Diagnostics />
      <Button variant="tonal" icon="refresh" onClick={session ? () => window.top?.location.reload() : onRetry}>
        {session ? 'Reload Gmail' : 'Try again'}
      </Button>
    </div>
  );
}
