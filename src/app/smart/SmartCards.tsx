import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { Thread } from '../data/types';
import { openUrl } from '../lib/host';
import { useLocal } from '../state/local';
import { Button, IconButton } from '../ui/Button';
import { ConnectedButtonGroup } from '../ui/ButtonGroup';
import { Icon, type IconName } from '../ui/Icon';
import {
  PACKAGE_STEPS,
  analyzeMessage,
  googleCalendarUrl,
  packageLabel,
  type CalendarEvent,
  type Rsvp,
  type SmartInfo,
} from './extract';
import { useCopy } from '../ui/feedback';
import { loadThreadEvent, rsvp } from './rsvp';
import { rawId } from '../data/accounts/ids';
import { scopedThreadId } from '../data/accounts/threads';
import { openThread } from '../router/useRoute';
import { daysFrom } from './freshness';
import { addEvents, currentEvent, referenceKey, timeline, type TrackingEvent, type TrackingRecord } from './tracking';
import { PackageMenu } from './PackageMenu';
import { useRefreshTracking, useTracking, useTrackingRecord } from './trackingStore';
import type { PackageInfo } from './extract';
import './smart.css';

/** Like Gmail's for orders, trips and codes. */
export function SmartCards({ thread }: { thread: Thread }) {
  const last = useMemo(() => [...thread.messages].reverse().find((m) => !m.isDraft), [thread]);
  const infos = useMemo(() => (last ? analyzeMessage(last, thread.labelIds) : []), [last, thread.labelIds]);
  const hasInvite = thread.messages.some((m) => m.attachments.some((a) => a.mimeType.startsWith('text/calendar') || /\.ics$/i.test(a.filename)));
  const { data: invite } = useQuery({
    queryKey: ['thread-event', thread.id],
    queryFn: () => loadThreadEvent(thread.id),
    enabled: hasInvite && !thread.labelIds.includes('SPAM'),
    staleTime: 5 * 60_000,
  });
  const tracked = useTracking((s) => {
    const key = s.byThread[rawId(thread.id)];
    return key ? s.records[key] : undefined;
  });
  if (thread.labelIds.includes('SPAM')) return null;
  const cards: SmartInfo[] = infos.filter((i) => i.kind !== 'deal' || !thread.labelIds.includes('SPAM'));
  // An email tracked by hand gets the package card its own text wouldn't.
  if (tracked && !cards.some((c) => c.kind === 'package')) cards.unshift(trackedInfo(tracked, thread.id));
  if (!cards.length && !invite) return null;
  return (
    <div className="smart-cards">
      {invite && <EventCard event={invite.event} threadId={thread.id} />}
      {cards.map((info, i) => (
        <InfoCard key={i} info={info} thread={thread} receivedAt={last?.date ?? thread.lastDate} />
      ))}
    </div>
  );
}

function Row({ icon, label, value, copy }: { icon: IconName; label: string; value?: string; copy?: boolean }) {
  if (!value) return null;
  return (
    <div className="smart-card__row">
      <Icon name={icon} size={20} className="smart-card__row-icon" />
      <span className="smart-card__row-text">
        <span className="md-label-medium smart-card__row-label">{label}</span>
        <span className="md-body-large">{value}</span>
      </span>
      {copy && <CopyIconButton value={value} label={label} />}
    </div>
  );
}

function CopyIconButton({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy();
  return (
    <IconButton
      icon="content_copy"
      label={`Copy ${label.toLowerCase()}`}
      size="xs"
      confirmed={copied}
      confirmedLabel="Copied"
      onClick={() => void copy(value, `${label} copied`)}
    />
  );
}

function CopyCodeButton({ code, display }: { code: string; display: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button variant="filled" icon="content_copy" confirmed={copied} confirmedLabel="Copied" onClick={() => void copy(code, `Code ${display} copied`)}>
      Copy code
    </Button>
  );
}

function Card({
  icon,
  title,
  supporting,
  kind,
  children,
  actions,
  menu,
}: {
  icon: IconName;
  title: string;
  supporting?: string;
  kind: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  menu?: React.ReactNode;
}) {
  return (
    <section className="smart-card" data-kind={kind} aria-label={title}>
      <header className="smart-card__head">
        <span className="smart-card__badge">
          <Icon name={icon} size={20} filled />
        </span>
        <span className="smart-card__titles">
          <span className="md-title-medium">{title}</span>
          {supporting && <span className="md-body-medium smart-card__supporting">{supporting}</span>}
        </span>
        {menu && <span className="smart-card__menu">{menu}</span>}
      </header>
      {children}
      {actions && <footer className="smart-card__actions">{actions}</footer>}
    </section>
  );
}

function InfoCard({ info, thread, receivedAt }: { info: SmartInfo; thread: Thread; receivedAt: number }) {
  switch (info.kind) {
    case 'code':
      return (
        <Card kind="code" icon="password" title="Verification code" supporting={info.service}>
          <p className="smart-card__code" aria-label={`Code ${info.code.split('').join(' ')}`}>
            {info.display}
          </p>
          <p className="md-body-medium smart-card__note">Codes like this expire quickly. Never share one with anyone who asks for it.</p>
          <footer className="smart-card__actions">
            <CopyCodeButton code={info.code} display={info.display} />
          </footer>
        </Card>
      );
    case 'package':
      return <PackageCard info={info} thread={thread} receivedAt={receivedAt} />;
    case 'receipt':
      return (
        <Card
          kind="receipt"
          icon="receipt_long"
          title={`Receipt from ${info.merchant}`}
          actions={
            info.url && (
              <Button variant="tonal" icon="open_in_new" onClick={() => openUrl(info.url!)}>
                View order
              </Button>
            )
          }
        >
          <p className="smart-card__big">{info.total}</p>
          <Row icon="tag" label="Order number" value={info.orderNo} copy />
          {info.items.length > 0 && <Row icon="shopping_bag" label="Items" value={info.items.join(', ')} />}
        </Card>
      );
    case 'bill':
      return (
        <Card
          kind="bill"
          icon="request_quote"
          title={`Bill from ${info.merchant}`}
          actions={
            info.url && (
              <Button variant="tonal" icon="open_in_new" onClick={() => openUrl(info.url!)}>
                View bill
              </Button>
            )
          }
        >
          <p className="smart-card__big">{info.amount ?? 'Bill ready'}</p>
          <Row icon="event" label="Due" value={info.due} />
          <Row icon="autorenew" label="Autopay" value={info.autopay} />
        </Card>
      );
    case 'flight':
      return (
        <Card
          kind="flight"
          icon="flight"
          title={info.airline}
          supporting={info.flight}
          actions={
            info.url && (
              <Button variant="tonal" icon="open_in_new" onClick={() => openUrl(info.url!)}>
                Manage booking
              </Button>
            )
          }
        >
          {info.route && (
            <p className="smart-card__route">
              <span>{info.route.from}</span>
              <Icon name="flight" size={28} className="smart-card__route-plane" />
              <span>{info.route.to}</span>
            </p>
          )}
          <Row icon="schedule" label="Departs" value={info.when} />
          <Row icon="confirmation_number" label="Confirmation" value={info.confirmation} copy />
        </Card>
      );
    case 'stay':
      return (
        <Card
          kind="stay"
          icon="hotel"
          title={info.name}
          supporting="Reservation"
          actions={
            info.url && (
              <Button variant="tonal" icon="open_in_new" onClick={() => openUrl(info.url!)}>
                Manage reservation
              </Button>
            )
          }
        >
          <Row icon="login" label="Check-in" value={info.checkIn} />
          <Row icon="logout" label="Check-out" value={info.checkOut} />
          <Row icon="confirmation_number" label="Confirmation" value={info.confirmation} copy />
        </Card>
      );
    case 'pickup':
      return (
        <Card kind="pickup" icon="local_library" title="Ready for pickup" supporting={info.what}>
          <Row icon="event" label="Pick up by" value={info.by} />
        </Card>
      );
    case 'deal':
      return (
        <Card
          kind="deal"
          icon="sell"
          title="Offer in this email"
          actions={
            info.url && (
              <Button variant="tonal" icon="open_in_new" onClick={() => openUrl(info.url!)}>
                See the offer
              </Button>
            )
          }
        >
          {info.discount && <p className="smart-card__big">{info.discount}</p>}
          <Row icon="schedule" label="Expires" value={info.expires} />
          <Row icon="confirmation_number" label="Promo code" value={info.code} copy />
        </Card>
      );
  }
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const SHORT_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

/** "Today at 2:37 PM", "Yesterday", "Monday", "Oct 2". */
function when(at: number, now = Date.now()): string {
  const n = daysFrom(at, now);
  if (n === 0) return `Today at ${TIME.format(at)}`;
  if (n === -1) return 'Yesterday';
  if (n > -7 && n < 0) return WEEKDAY.format(at);
  return SHORT_DAY.format(at);
}

const EMPTY_RECORD: TrackingRecord = { key: '', kind: 'tracking', ref: '', events: [] };

/** From its record, for an email tracked by hand. */
function trackedInfo(record: TrackingRecord, threadId: string): PackageInfo {
  const mine = record.events.find((e) => e.threadId === rawId(threadId));
  return {
    kind: 'package',
    status: mine?.status ?? 'ordered',
    merchant: record.merchant,
    carrier: record.carrier,
    tracking: record.kind === 'tracking' ? record.ref : undefined,
    orderNo: record.kind === 'order' ? record.ref : undefined,
    trackUrl: record.trackUrl,
  };
}

/** Brought up to date by every email about the same tracking number: the newest status leads, and the steps below link to the emails that said them. */
function PackageCard({ info, thread, receivedAt }: { info: PackageInfo; thread: Thread; receivedAt: number }) {
  const raw = rawId(thread.id);
  const filed = useTracking((s) => s.byThread[raw]);
  const key = referenceKey(info) ?? filed;
  const record = useTrackingRecord(key) ?? EMPTY_RECORD;
  const checking = useTracking((s) => (key ? !!s.checking[key] : false));
  useRefreshTracking([key], true, true);
  const { latest, steps } = useMemo(() => {
    const own: TrackingEvent = { status: info.status, at: receivedAt, threadId: raw, eta: info.eta };
    const withOwn = addEvents(record, [own]);
    return { latest: currentEvent(withOwn) ?? own, steps: timeline(withOwn.events, record.manual) };
  }, [record, info.status, info.eta, receivedAt, raw]);
  const status = latest.status;
  const elsewhere = latest.threadId !== raw;
  const linked = steps.some((e) => e.threadId !== raw);
  const eta = latest.eta ?? info.eta;
  const trackUrl = info.trackUrl ?? record.trackUrl;
  const step = status === 'problem' ? 1 : PACKAGE_STEPS.findIndex((s) => s.status === status);
  const merchant = info.merchant ?? record.merchant;
  return (
    <Card
      kind="package"
      icon="local_shipping"
      title={merchant ? `Your package from ${merchant}` : 'Your package'}
      supporting={info.carrier ?? record.carrier}
      menu={<PackageMenu pkgKey={key} record={record.key ? record : undefined} status={status} seed={{ threadId: thread.id, info, at: receivedAt }} />}
      actions={
        trackUrl && (
          <Button variant="tonal" icon="open_in_new" onClick={() => openUrl(trackUrl)}>
            Track package
          </Button>
        )
      }
    >
      <p className="smart-card__big" data-tone={status}>
        {packageLabel(status)}
      </p>
      {elsewhere && (
        <p className="md-body-medium smart-card__note">
          {when(latest.at)}
          {latest.manual ? ', set by you' : latest.from ? `, from ${latest.from}` : ''}
        </p>
      )}
      <ol className="tracker" data-problem={status === 'problem' || undefined} aria-label="Delivery progress">
        {PACKAGE_STEPS.map((s, i) => (
          <li key={s.status} className="tracker__step" data-done={i <= step || undefined} data-current={i === step || undefined} aria-current={i === step ? 'step' : undefined}>
            <span className="tracker__dot">{i < step || (i === step && status === 'delivered') ? <Icon name="check" size={14} weight={500} /> : null}</span>
            <span className="md-label-medium tracker__label">{s.label}</span>
          </li>
        ))}
      </ol>
      {linked && <PackageUpdates steps={steps} latest={latest} here={raw} />}
      {checking && !linked && (
        <p className="md-body-small smart-card__note" role="status">
          Looking for newer emails about this package
        </p>
      )}
      <Row icon="schedule" label="Estimated delivery" value={status === 'delivered' ? undefined : eta} />
      <Row icon="tag" label="Tracking number" value={info.tracking} copy />
      <Row icon="receipt_long" label="Order number" value={info.tracking ? undefined : info.orderNo} copy />
    </Card>
  );
}

/** Newest first. This email is marked; the others open. */
function PackageUpdates({ steps, latest, here }: { steps: TrackingEvent[]; latest: TrackingEvent; here: string }) {
  return (
    <section className="pkg-updates" aria-labelledby={`pkg-updates-${here}`}>
      <h3 id={`pkg-updates-${here}`} className="md-title-small pkg-updates__title">
        Updates
      </h3>
      <ol className="pkg-updates__list">
        {steps.map((e) => {
          const mine = e.threadId === here;
          const meta = [when(e.at), e.manual ? 'Set by you' : e.from].filter(Boolean).join(' · ');
          const body = (
            <>
              <span className="pkg-updates__dot" aria-hidden="true" />
              <span className="pkg-updates__text">
                <span className="md-title-small">{packageLabel(e.status)}</span>
                <span className="md-body-small pkg-updates__meta">{meta}</span>
              </span>
            </>
          );
          return (
            <li key={`${e.threadId}|${e.status}`} className="pkg-updates__item" data-current={e.status === latest.status || undefined}>
              {mine || e.manual ? (
                <span className="pkg-updates__row">
                  {body}
                  {mine && <span className="md-label-medium pkg-updates__here">This email</span>}
                </span>
              ) : (
                <button
                  type="button"
                  className="pkg-updates__row pkg-updates__row--link"
                  aria-label={`${packageLabel(e.status)}, ${meta}. Open email`}
                  onClick={() => openThread(scopedThreadId(e.threadId, e.account))}
                >
                  {body}
                  <Icon name="chevron_right" size={20} className="pkg-updates__go" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const ANSWERS = [
  { value: 'ACCEPTED', label: 'Yes' },
  { value: 'TENTATIVE', label: 'Maybe' },
  { value: 'DECLINED', label: 'No' },
] as const;

function EventCard({ event, threadId }: { event: CalendarEvent; threadId: string }) {
  const saved = useLocal((s) => s.rsvps[event.uid]);
  // Shown the moment it's picked; falls back to the saved answer if sending fails.
  const [pending, setPending] = useState<Rsvp | null>(null);
  const answer = pending ?? saved;
  const fmt: Intl.DateTimeFormatOptions = event.allDay
    ? { weekday: 'long', month: 'long', day: 'numeric' }
    : { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const when = new Date(event.start).toLocaleString(undefined, fmt);
  const until = event.end && !event.allDay ? new Date(event.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : undefined;
  const past = (event.end ?? event.start) < Date.now();
  const cancelled = event.method === 'CANCEL';
  return (
    <Card kind="event" icon="event" title={event.title} supporting={cancelled ? 'This event was cancelled' : event.organizer ? `Invitation from ${event.organizer.name ?? event.organizer.email}` : 'Invitation'}>
      <Row icon="schedule" label="When" value={until ? `${when} to ${until}` : when} />
      <Row icon="location_on" label="Where" value={event.location} />
      <Row icon="group" label="Guests" value={event.attendees.length ? `${event.attendees.length} ${event.attendees.length === 1 ? 'guest' : 'guests'}` : undefined} />
      <footer className="smart-card__actions smart-card__actions--event">
        {!cancelled && !past && event.organizer && (
          <span className="smart-card__rsvp">
            <span className="md-label-large">Going?</span>
            <ConnectedButtonGroup
              label="Going?"
              size="xs"
              value={answer ?? ('' as 'ACCEPTED')}
              onChange={(v) => {
                setPending(v);
                void rsvp(threadId, v, event).finally(() => setPending(null));
              }}
              options={ANSWERS.map((a) => ({ value: a.value, label: a.label }))}
            />
          </span>
        )}
        <Button variant="text" icon="calendar_add_on" onClick={() => openUrl(googleCalendarUrl(event))}>
          Add to Google Calendar
        </Button>
      </footer>
    </Card>
  );
}
