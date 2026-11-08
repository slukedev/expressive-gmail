import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { ThreadSummary } from '../data/types';
import type { Me } from '../lib/format';
import { Icon, type IconName } from '../ui/Icon';
import { analyzeRow, packageLabel, type RowSmart } from './extract';
import { recordForThread, useThreadPackageStatus } from './trackingStore';
import { rsvp } from './rsvp';
import { openTracking } from './actions';
import { ConnectedButtonGroup } from '../ui/ButtonGroup';
import { SwapIcon, SwapText, useCopy } from '../ui/feedback';
import { cx } from '../ui/Button';
import type { Rsvp } from './extract';

const stop = (e: MouseEvent) => e.stopPropagation();

/** The glyph turns to a check, the label rolls to "Copied" and the chip takes tertiary until it settles back. */
export function CopyChip({
  text,
  spoken,
  label,
  className,
  children,
  ...rest
}: {
  text: string;
  spoken: string;
  /** Without one, only the glyph and colour change. */
  label?: ReactNode;
  className?: string;
  children?: ReactNode;
  'aria-label'?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      className={cx('smart-chip', className)}
      data-confirmed={copied || undefined}
      onClick={(e) => {
        stop(e);
        void copy(text, spoken);
      }}
      {...rest}
    >
      <SwapIcon from="content_copy" to="check" on={copied} size={18} />
      {children}
      {label !== undefined && <SwapText on={copied} idle={label} done="Copied" />}
    </button>
  );
}

/** With a package at its newest known status: a "Shipped" email reads "Delivered" once any email about that package says so. */
export function useRowSmart(thread: ThreadSummary, me: Me, enabled: boolean): RowSmart | null {
  const base = useMemo(() => (enabled ? analyzeRow(thread, me) : null), [thread, me, enabled]);
  // Rows with nothing of their own to say can still be a package tracked by hand.
  const latest = useThreadPackageStatus(thread.id, enabled && (!base || base.kind === 'package'));
  return useMemo((): RowSmart | null => {
    if (!latest) return base;
    if (!base) return { kind: 'package', status: latest };
    return base.kind === 'package' && latest !== base.status ? { ...base, status: latest } : base;
  }, [base, latest]);
}

/** Shown in place of the preview ("Out for delivery", "Received 4 days ago. Reply?"). */
export function RowSmartLine({ smart }: { smart: RowSmart }) {
  if (smart.kind === 'package') {
    const icon: IconName = smart.status === 'delivered' ? 'inventory_2' : smart.status === 'problem' ? 'error' : 'local_shipping';
    return (
      <span className="row__smart" data-tone={smart.status}>
        <Icon name={icon} size={18} filled />
        {packageLabel(smart.status)}
      </span>
    );
  }
  if (smart.kind === 'bill') {
    return (
      <span className="row__smart" data-tone="bill">
        <Icon name="receipt_long" size={18} />
        Bill ready{smart.amount ? ` · ${smart.amount}` : ''}
      </span>
    );
  }
  return null;
}

/** A package tracked by hand with no number or link has nothing to open. */
function canTrack(threadId: string) {
  const record = recordForThread(threadId);
  return !record?.userAdded || record.kind === 'tracking' || !!record.trackUrl;
}

/** Copy a code, answer an invite, track a package, grab a deal. */
export function RowSmartChips({ smart, thread }: { smart: RowSmart; thread: ThreadSummary }) {
  if (smart.kind === 'code') {
    return (
      <CopyChip className="smart-chip--code" text={smart.code} spoken={`Code ${smart.display} copied`} label="Copy code">
        <span className="smart-chip__code">{smart.display}</span>
      </CopyChip>
    );
  }
  if (smart.kind === 'invite') {
    return (
      <InviteChips threadId={thread.id} />
    );
  }
  if (smart.kind === 'package' && smart.status !== 'delivered' && canTrack(thread.id)) {
    return (
      <button type="button" className="smart-chip" onClick={(e) => (stop(e), void openTracking(thread.id))}>
        <Icon name="local_shipping" size={18} />
        Track package
      </button>
    );
  }
  if (smart.kind === 'deal') {
    // The discount and deadline only inform: a click opens the row. The code chip copies.
    return (
      <span className="smart-chips">
        {smart.discount && (
          <span className="smart-chip smart-chip--static smart-chip--deal">
            <Icon name="sell" size={18} />
            {smart.discount}
          </span>
        )}
        {smart.expires && (
          <span className="smart-chip smart-chip--static">
            <Icon name="schedule" size={18} />
            {smart.expires}
          </span>
        )}
        {smart.code && (
          <CopyChip text={smart.code} spoken={`Promo code ${smart.code} copied`}>
            {smart.code}
          </CopyChip>
        )}
      </span>
    );
  }
  return null;
}

/** The answer shows at once and stays unless sending fails. */
function InviteChips({ threadId }: { threadId: string }) {
  const [answer, setAnswer] = useState<Rsvp | ''>('');
  return (
    <span className="smart-chips" onClick={stop}>
      <ConnectedButtonGroup
        label="Reply to invitation"
        size="xs"
        value={answer as Rsvp}
        onChange={(value) => {
          const was = answer;
          setAnswer(value);
          void rsvp(threadId, value).then((ok) => {
            if (!ok) setAnswer(was);
          });
        }}
        options={[
          { value: 'ACCEPTED', label: 'Yes', icon: 'check' },
          { value: 'TENTATIVE', label: 'Maybe', icon: 'help' },
          { value: 'DECLINED', label: 'No', icon: 'close' },
        ]}
      />
    </span>
  );
}
