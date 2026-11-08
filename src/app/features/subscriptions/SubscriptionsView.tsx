import { useInfiniteQuery } from '@tanstack/react-query';
import { PageMark } from '../list/PageMark';
import { useEffect, useMemo, useState } from 'react';
import { mail } from '../../data/actions';
import { backend } from '../../data/client';
import type { ThreadSummary } from '../../data/types';
import { isMe, listDate } from '../../lib/format';
import { useMe } from '../../data/hooks';
import { registrableDomain } from '../../data/brands';
import { navigate } from '../../router/useRoute';
import { Avatar } from '../../ui/Avatar';
import { Button, IconButton } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Dialog } from '../../ui/Dialog';
import { EmptyArt } from '../../ui/EmptyArt';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { Menu, MenuItem } from '../../ui/Menu';
import { snack } from '../../ui/Snackbar';
import { unsubscribe } from '../thread/UnsubscribeButton';

interface Sender {
  email: string;
  name?: string;
  threads: ThreadSummary[];
  unread: number;
  last: number;
}

const QUERY = '(category:promotions OR category:updates OR category:social OR category:forums) unsubscribe -in:sent newer_than:6m';
const MAX_PAGES = 4;

/** Every mailing list you get, by sender, with one-click cleanup. */
export function SubscriptionsView() {
  const [sort, setSort] = useState<'volume' | 'recent' | 'unread'>('volume');
  const [confirm, setConfirm] = useState<{ sender: Sender; action: 'archive' | 'trash' } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const q = useInfiniteQuery({
    queryKey: ['subscriptions', QUERY],
    queryFn: ({ pageParam }) => backend().listThreads({ q: QUERY, pageToken: pageParam, pageSize: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last, pages) => (pages.length < MAX_PAGES ? last.nextPageToken : undefined),
  });
  useEffect(() => {
    if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [q.hasNextPage, q.isFetchingNextPage, q]);

  const me = useMe();
  const senders = useMemo(() => {
    const map = new Map<string, Sender>();
    const all = q.data?.pages.flatMap((p) => p.threads) ?? [];
    // People you write to aren't mailing lists, even when their mail says "unsubscribe".
    const correspondents = new Set(
      all.filter((t) => t.participants.some((a) => isMe(a.email, me))).flatMap((t) => t.participants.map((a) => a.email.toLowerCase())),
    );
    for (const t of all) {
      const from = t.participants[0];
      if (!from || correspondents.has(from.email.toLowerCase())) continue;
      const key = from.email.toLowerCase();
      const s = map.get(key) ?? { email: from.email, name: from.name, threads: [], unread: 0, last: 0 };
      s.threads.push(t);
      if (t.labelIds.includes('UNREAD')) s.unread++;
      s.last = Math.max(s.last, t.lastDate);
      map.set(key, s);
    }
    // Notification services send under each person's name ("Tomás Ferreira" <notifications@codehub.example>); the list belongs to the service.
    for (const s of map.values()) {
      const [local, host = ''] = s.email.toLowerCase().split('@');
      if (!/^(notifications?|no-?reply|do-?not-?reply|alerts?|updates?)([+._-].*)?$/.test(local!)) continue;
      const brand = registrableDomain(host)?.split('.')[0];
      if (brand && !s.name?.toLowerCase().replace(/\s+/g, '').includes(brand)) s.name = brand[0]!.toUpperCase() + brand.slice(1);
    }
    const list = [...map.values()].filter((s) => !done.has(s.email.toLowerCase()));
    return list.sort((a, b) => (sort === 'volume' ? b.threads.length - a.threads.length : sort === 'recent' ? b.last - a.last : b.unread - a.unread));
  }, [q.data, sort, done, me]);

  const total = senders.reduce((n, s) => n + s.threads.length, 0);
  const neverRead = senders.filter((s) => s.unread === s.threads.length && s.threads.length > 2).length;

  const doUnsubscribe = async (s: Sender) => {
    try {
      const thread = await backend().getThread(s.threads[0].id);
      const fromSender = thread.messages.filter((m) => m.from.email.toLowerCase() === s.email.toLowerCase() && !m.isDraft);
      const msg = [...fromSender].reverse().find((m) => m.headers.listUnsubscribe) ?? fromSender.at(-1) ?? thread.messages.at(-1);
      if (!msg) return;
      if (await unsubscribe(msg)) setDone((d) => new Set(d).add(s.email.toLowerCase()));
    } catch {
      snack(`Couldn't reach ${s.name ?? s.email}. Try again in a moment.`);
    }
  };

  return (
    <section className="page" aria-labelledby="subs-title">
      <header className="page__head">
        <PageMark kind="subscriptions" />
        <h1 id="subs-title" className="md-headline-medium md-emphasized">Subscriptions</h1>
        <p className="md-body-large page__lede">
          {q.isPending
            ? 'Finding the newsletters and mailing lists you get.'
            : senders.length
              ? `${senders.length} senders sent you ${total.toLocaleString()} emails in the last six months${neverRead ? `. You haven't opened anything from ${neverRead} of them.` : '.'}`
              : ''}
        </p>
        {senders.length > 0 && (
          <div className="search-chips" role="toolbar" aria-label="Sort by">
            {(
              [
                ['volume', 'Most emails'],
                ['unread', 'Most unread'],
                ['recent', 'Most recent'],
              ] as const
            ).map(([value, label]) => (
              <Chip key={value} kind="filter" selected={sort === value} onClick={() => setSort(value)}>
                {label}
              </Chip>
            ))}
          </div>
        )}
      </header>
      {q.isPending ? (
        <div className="page__loading">
          <LoadingIndicator contained label="Finding subscriptions" />
        </div>
      ) : senders.length === 0 ? (
        <div className="empty">
          <EmptyArt icon="unsubscribe" />
          <h2 className="md-title-large empty__title">No subscriptions found</h2>
          <p className="md-body-medium empty__text">Newsletters and mailing lists from the last six months show up here.</p>
        </div>
      ) : (
        <div className="seg-list">
          {senders.map((s) => (
            <div key={s.email} className="row-wrap">
              <div className="row sub-row">
                <Avatar name={s.name} email={s.email} size={40} />
                <span className="sub-row__text">
                  <span className="md-title-small">{s.name ?? s.email}</span>
                  <span className="md-body-medium sub-row__meta">
                    {s.threads.length} {s.threads.length === 1 ? 'email' : 'emails'}
                    {s.unread ? ` · ${s.unread} unread` : ''} · last {listDate(s.last)}
                  </span>
                </span>
                <Button variant="tonal" size="xs" onClick={() => void doUnsubscribe(s)}>
                  Unsubscribe
                </Button>
                <Menu trigger={<IconButton icon="more_vert" label={`More for ${s.name ?? s.email}`} />} align="end">
                  <MenuItem icon="search" onClick={() => navigate({ view: { kind: 'search', query: `from:${s.email}` } })}>
                    Show all emails
                  </MenuItem>
                  <MenuItem icon="mark_email_read" onClick={() => void mail.markRead(s.threads.map((t) => t.id), true)}>
                    Mark all as read
                  </MenuItem>
                  <MenuItem icon="archive" onClick={() => setConfirm({ sender: s, action: 'archive' })}>
                    Archive all
                  </MenuItem>
                  <MenuItem icon="delete" danger onClick={() => setConfirm({ sender: s, action: 'trash' })}>
                    Delete all
                  </MenuItem>
                </Menu>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `${confirm.action === 'archive' ? 'Archive' : 'Delete'} ${confirm.sender.threads.length} emails?` : ''}
        description={confirm ? `Everything from ${confirm.sender.name ?? confirm.sender.email} in the last six months. You can undo right after.` : ''}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="text"
              onClick={() => {
                const c = confirm!;
                setConfirm(null);
                const ids = c.sender.threads.map((t) => t.id);
                void (c.action === 'archive' ? mail.archive(ids) : mail.trash(ids));
                setDone((d) => new Set(d).add(c.sender.email.toLowerCase()));
              }}
            >
              {confirm?.action === 'archive' ? 'Archive all' : 'Delete all'}
            </Button>
          </>
        }
      />
    </section>
  );
}
