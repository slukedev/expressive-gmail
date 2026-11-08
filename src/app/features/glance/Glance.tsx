import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { backend } from '../../data/client';
import { useAccount, useMe } from '../../data/hooks';
import { inCurrentScope, scopedThreadId } from '../../data/accounts/threads';
import { listDate } from '../../lib/format';
import { navigate, openThread } from '../../router/useRoute';
import { useLocal } from '../../state/local';
import { useSettings } from '../../state/settings';
import { Icon, type IconName } from '../../ui/Icon';
import { ShapeIcon, type ShapeName } from '../../ui/ShapeIcon';
import { analyzeRow, packageLabel, senderName } from '../../smart/extract';
import { billRelevance, codeRelevance, daysFrom, inviteRelevance, packageRelevance, RANK } from '../../smart/freshness';
import { useRecentPackages } from '../../smart/packages';
import { useRefreshTracking } from '../../smart/trackingStore';
import { CopyChip } from '../../smart/RowSmart';
import { GlancePicture } from '../wallpaper/Hero';

const INBOX = { kind: 'folder', folder: 'inbox' } as const;
const MAX_ITEMS = 6;
/** The board comes back whenever a conversation closes; it makes an entrance once a session. */
let entered = false;

type Kind = 'code' | 'package' | 'invite' | 'bill' | 'nudge';

interface Item {
  kind: Kind;
  /** From freshness.ts: what needs you soonest sorts first. */
  rank: number;
  threadId: string;
  title: string;
  sub: string;
  date: number;
  /** The value Copy copies. */
  code?: { code: string; display: string };
}

const LOOK: Record<Kind, { icon: IconName; shape: ShapeName; bg: string; fg: string }> = {
  code: { icon: 'password', shape: 'Cookie4Sided', bg: 'var(--md-sys-color-primary-container)', fg: 'var(--md-sys-color-on-primary-container)' },
  package: { icon: 'local_shipping', shape: 'Cookie6Sided', bg: 'var(--md-sys-color-tertiary-container)', fg: 'var(--md-sys-color-on-tertiary-container)' },
  invite: { icon: 'event', shape: 'Clover4Leaf', bg: 'var(--md-sys-color-secondary-container)', fg: 'var(--md-sys-color-on-secondary-container)' },
  bill: { icon: 'receipt_long', shape: 'Pentagon', bg: 'var(--md-sys-color-tertiary-container)', fg: 'var(--md-sys-color-on-tertiary-container)' },
  nudge: { icon: 'reply', shape: 'Cookie9Sided', bg: 'var(--md-sys-color-primary-container)', fg: 'var(--md-sys-color-on-primary-container)' },
};

function daypart(hour: number): { word: string; icon: IconName; shape: ShapeName } {
  if (hour >= 5 && hour < 12) return { word: 'morning', icon: 'wb_sunny', shape: 'Sunny' };
  if (hour >= 12 && hour < 17) return { word: 'afternoon', icon: 'partly_cloudy_day', shape: 'Cookie9Sided' };
  if (hour >= 17 && hour < 22) return { word: 'evening', icon: 'wb_twilight', shape: 'Cookie12Sided' };
  return { word: 'evening', icon: 'bedtime', shape: 'Clover8Leaf' };
}

/** So the greeting and fresh codes keep up with the clock. */
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

const SHORT_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

/** "today", "tomorrow", "Friday" within the week, else "Oct 20". */
function dayWord(day: number, now: number): string {
  const n = daysFrom(day, now);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 1 && n < 7) return WEEKDAY.format(day);
  return SHORT_DAY.format(day);
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Updated invitation: Design crit @ Monday, October 12" -> "Design crit". */
function inviteTitle(subject: string): string {
  return subject.replace(/^(updated )?invitation:\s*/i, '').split(/\s+@\s+/)[0] || subject;
}

/** The reading pane with nothing open: what in your mail wants a look today (codes, deliveries, invites, bills, unanswered questions) and follow-ups due. Matched in the browser; packages come from the same reader as Purchases, so the two never disagree. */
export function Glance() {
  const now = useNow();
  const [entrance] = useState(() => !entered);
  useEffect(() => {
    entered = true;
  }, []);
  const me = useMe();
  const { data: account, isPending: accountPending } = useAccount();
  const smartFeatures = useSettings((s) => s.smartFeatures);
  const recent = useQuery({
    queryKey: ['glance'],
    // One request either way; a busy inbox fills 50 threads in a few days, not two weeks.
    queryFn: () => backend().listThreads({ q: 'in:inbox newer_than:14d', pageSize: 100 }),
    staleTime: 60_000,
  });
  const reminders = useLocal((s) => s.reminders);
  const overdue = reminders.filter((r) => r.due <= now && inCurrentScope(r.account));

  const { packages, loading: packagesLoading } = useRecentPackages(smartFeatures);

  const fresh = useMemo(() => {
    const out: { p: (typeof packages)[number]; rank: number; late: boolean }[] = [];
    for (const p of packages) {
      const r = packageRelevance({ status: p.info.status, updatedAt: p.date, eta: p.info.eta }, now);
      if (r) out.push({ p, ...r });
    }
    return out;
  }, [packages, now]);
  // Packages that could still change get one quiet check for newer mail about them.
  useRefreshTracking(
    fresh.filter((f) => f.p.info.status !== 'delivered').map((f) => f.p.key),
    smartFeatures,
  );

  const items = useMemo(() => {
    if (!smartFeatures) return [];
    const found: Item[] = [];
    for (const { p, rank, late } of fresh) {
      const from = p.info.merchant ?? p.info.carrier ?? senderName(p.thread.participants[p.thread.participants.length - 1] ?? { email: '' });
      const when = p.info.status === 'delivered' ? '' : p.info.eta ? (late ? `was due ${p.info.eta}` : `expected ${p.info.eta}`) : '';
      // Open the email with the newest news.
      const threadId = p.latest ? scopedThreadId(p.latest.threadId, p.latest.account) : p.thread.id;
      found.push({ kind: 'package', rank, threadId, title: late ? 'Running late' : packageLabel(p.info.status), sub: [from, when].filter(Boolean).join(' · '), date: p.date });
    }
    for (const t of recent.data?.threads ?? []) {
      const smart = analyzeRow(t, me, now);
      if (!smart) continue;
      const last = t.participants[t.participants.length - 1];
      const from = last ? senderName(last) : '';
      const base = { threadId: t.id, date: t.lastDate };
      const text = `${t.subject}\n${t.snippet}`;
      if (smart.kind === 'code') {
        const r = codeRelevance({ receivedAt: t.lastDate, text }, now);
        if (r) found.push({ ...base, ...r, kind: 'code', title: `Code ${smart.display}`, sub: from, code: smart });
      } else if (smart.kind === 'invite') {
        const r = inviteRelevance({ receivedAt: t.lastDate, subject: t.subject, snippet: t.snippet, unread: t.labelIds.includes('UNREAD') }, now);
        if (!r) continue;
        const updated = /^updated invitation/i.test(t.subject);
        const what = `${updated ? 'Updated invitation' : 'Invitation'} from ${from}`;
        found.push({ ...base, ...r, kind: 'invite', title: inviteTitle(t.subject), sub: r.day !== undefined ? `${what} · ${capital(dayWord(r.day, now))}` : what });
      } else if (smart.kind === 'bill') {
        const r = billRelevance({ receivedAt: t.lastDate, text }, now);
        if (!r) continue;
        const due = r.dueDay === undefined ? '' : daysFrom(r.dueDay, now) < 0 ? `Was due ${dayWord(r.dueDay, now)}` : `Due ${dayWord(r.dueDay, now)}`;
        found.push({ ...base, ...r, kind: 'bill', title: smart.amount ? `Bill ready · ${smart.amount}` : 'Bill ready', sub: [from, due].filter(Boolean).join(' · ') });
      } else if (smart.kind === 'nudge') {
        found.push({ ...base, rank: RANK.nudge, kind: 'nudge', title: t.subject || '(no subject)', sub: `${from} asked ${smart.days} days ago` });
      }
    }
    // A shipping email that also reads as a bill shows once, at its most urgent.
    const seen = new Set<string>();
    return found
      .sort((a, b) => a.rank - b.rank || b.date - a.date)
      .filter((i) => !seen.has(i.threadId) && seen.add(i.threadId))
      .slice(0, MAX_ITEMS);
  }, [recent.data, fresh, me, now, smartFeatures]);

  const part = daypart(new Date(now).getHours());
  const first = account?.members?.length ? '' : account?.name?.trim().split(/\s+/)[0] ?? '';
  const greeting = `Good ${part.word}${first ? `, ${first}` : ''}`;
  const date = new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const loading = recent.isPending || packagesLoading;
  // Nothing below the date shows until every source has answered, so the greeting doesn't grow a name and rows don't arrive one source at a time.
  const ready = !loading && !accountPending;

  return (
    <div className="glance" data-settled={entrance ? undefined : ''}>
      <header className="glance__head">
        <GlancePicture mark={part.shape}>
          <ShapeIcon
            className="glance__mark"
            shape={part.shape}
            icon={part.icon}
            size={88}
            iconSize={48}
            bg="var(--md-sys-color-tertiary-container)"
            fg="var(--md-sys-color-on-tertiary-container)"
          />
        </GlancePicture>
        <p className="md-label-large glance__date">{date}</p>
        <h2 className="glance__greeting" data-pending={accountPending || undefined}>
          {greeting}
        </h2>
      </header>

      {ready && items.length > 0 && (
        <section className="glance__section" aria-labelledby="glance-look">
          <h3 id="glance-look" className="list-section md-title-small">
            Worth a look
          </h3>
          <div className="seg-list">
            {items.map((item, i) => (
              <GlanceRow key={`${item.kind}-${item.threadId}`} item={item} index={i} now={now} />
            ))}
          </div>
        </section>
      )}

      {ready && overdue.length > 0 && (
        <section className="glance__section" aria-labelledby="glance-waiting">
          <h3 id="glance-waiting" className="list-section md-title-small">
            Follow-ups due
          </h3>
          <div className="seg-list">
            {overdue.map((r, i) => (
              <div key={r.threadId} className="glance-row-wrap" style={{ '--i': items.length + i } as CSSProperties}>
              <button
                type="button"
                className="row glance-row"
                onClick={() => navigate({ view: { kind: 'reminders' }, threadId: scopedThreadId(r.threadId, r.account) })}
              >
                <ShapeIcon shape="Cookie7Sided" icon="notifications_active" size={40} iconSize={20} bg="var(--md-sys-color-error-container)" fg="var(--md-sys-color-on-error-container)" />
                <span className="glance-row__text">
                  <span className="md-title-small glance-row__title" dir="auto">{r.subject || '(no subject)'}</span>
                  <span className="md-body-medium glance-row__sub">Sent {listDate(r.createdAt, now)}, nobody has replied</span>
                </span>
                <Icon name="chevron_right" size={20} className="glance-row__go" />
              </button>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  );
}

function GlanceRow({ item, index, now }: { item: Item; index: number; now: number }) {
  const look = LOOK[item.kind];
  const { code } = item;
  return (
    <div className="glance-row-wrap" style={{ '--i': index } as CSSProperties}>
      <button type="button" className="row glance-row" onClick={() => openThread(item.threadId, INBOX)}>
        <ShapeIcon shape={look.shape} icon={look.icon} size={40} iconSize={20} bg={look.bg} fg={look.fg} />
        <span className="glance-row__text">
          <span className="md-title-small glance-row__title" dir="auto">
            {item.title}
          </span>
          <span className="md-body-medium glance-row__sub" dir="auto">
            {item.sub}
          </span>
        </span>
        {!code && <span className="md-label-medium glance-row__meta">{listDate(item.date, now)}</span>}
      </button>
      {code && (
        <CopyChip
          className="smart-chip--code glance-row__action"
          aria-label={`Copy code ${code.display}`}
          text={code.code}
          spoken={`Code ${code.display} copied`}
          label="Copy"
        />
      )}
    </div>
  );
}
