import { useQueries, useQuery } from '@tanstack/react-query';
import { PageMark } from '../features/list/PageMark';
import { useMemo, type CSSProperties } from 'react';
import { backend, keys } from '../data/client';
import type { Thread } from '../data/types';
import { listDate } from '../lib/format';
import { openUrl } from '../lib/host';
import { openThread } from '../router/useRoute';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { EmptyArt } from '../ui/EmptyArt';
import { Icon } from '../ui/Icon';
import { LoadingIndicator } from '../ui/LoadingIndicator';
import { PACKAGE_STEPS, analyzeMessage, packageLabel, type BillInfo, type ReceiptInfo } from './extract';
import './smart.css';
import { packageRelevance } from './freshness';
import { PackageMenu } from './PackageMenu';
import { groupPackages, withLatest } from './packages';
import { useTracking } from './trackingStore';

const QUERY =
  '(order OR receipt OR shipped OR delivered OR "out for delivery" OR "tracking number" OR bill OR invoice) -in:spam -in:trash newer_than:1y';
const DETAIL_LIMIT = 60;

interface Found<T> {
  info: T;
  thread: Thread;
  date: number;
}

/** Packages on the way, receipts and bills, pulled from your mail. */
export function PurchasesView() {
  const list = useQuery({ queryKey: ['purchases', QUERY], queryFn: () => backend().listThreads({ q: QUERY, pageSize: DETAIL_LIMIT }), staleTime: 60_000 });
  const ids = (list.data?.threads ?? []).filter((t) => !t.labelIds.includes('CATEGORY_PROMOTIONS')).map((t) => t.id);
  const threads = useQueries({ queries: ids.map((id) => ({ queryKey: keys.thread(id), queryFn: () => backend().getThread(id), staleTime: 60_000 })) });
  const loading = list.isPending || threads.some((q) => q.isPending);
  const records = useTracking((s) => s.records);

  const { grouped, receipts, bills } = useMemo(() => {
    const receipts: Found<ReceiptInfo>[] = [];
    const bills: Found<BillInfo>[] = [];
    for (const q of threads) {
      const thread = q.data;
      if (!thread) continue;
      const last = [...thread.messages].reverse().find((m) => !m.isDraft);
      if (!last) continue;
      for (const info of analyzeMessage(last, thread.labelIds)) {
        if (info.kind === 'receipt') receipts.push({ info, thread, date: last.date });
        else if (info.kind === 'bill') bills.push({ info, thread, date: last.date });
      }
    }
    const byDate = <T,>(a: Found<T>, b: Found<T>) => b.date - a.date;
    return { grouped: groupPackages(threads.map((q) => q.data)), receipts: receipts.sort(byDate), bills: bills.sort(byDate) };
  }, [threads]);
  const packages = useMemo(() => {
    const now = Date.now();
    return (
      withLatest(grouped, records, now)
        // Not delivered, but no news for weeks: it came and nobody wrote.
        .map((p) => ({ ...p, stale: p.info.status !== 'delivered' && !packageRelevance({ status: p.info.status, updatedAt: p.date, eta: p.info.eta }, now) }))
        // Still moving first; then the rest, newest first.
        .sort((a, b) => Number(a.stale || a.info.status === 'delivered') - Number(b.stale || b.info.status === 'delivered') || b.date - a.date)
    );
  }, [grouped, records]);

  const active = packages.filter((p) => p.info.status !== 'delivered' && !p.stale).length;

  return (
    <section className="page" aria-labelledby="purchases-title">
      <header className="page__head">
        <PageMark kind="purchases" />
        <h1 id="purchases-title" className="md-headline-medium md-emphasized">
          Purchases
        </h1>
        <p className="md-body-large page__lede">
          {loading
            ? 'Gathering orders, deliveries and bills from your mail.'
            : `${active ? `${active} ${active === 1 ? 'package' : 'packages'} on the way. ` : ''}${receipts.length} ${receipts.length === 1 ? 'receipt' : 'receipts'} and ${bills.length} ${bills.length === 1 ? 'bill' : 'bills'} from the last year.`}
        </p>
      </header>
      {loading && !packages.length ? (
        <div className="page__loading">
          <LoadingIndicator contained label="Finding purchases" />
        </div>
      ) : !packages.length && !receipts.length && !bills.length ? (
        <div className="empty">
          <EmptyArt icon="shopping_bag" />
          <h2 className="md-title-large empty__title">No purchases yet</h2>
          <p className="md-body-medium empty__text">Order confirmations, shipping updates and bills from the last year show up here.</p>
        </div>
      ) : (
        <>
          {packages.length > 0 && (
            <>
              <h2 className="list-section md-label-large purchases__section">Packages</h2>
              <div className="purchases__grid">
                {packages.map(({ info, thread, date, late, stale, key, record }) => {
                  const step = info.status === 'problem' ? 1 : PACKAGE_STEPS.findIndex((s) => s.status === info.status);
                  return (
                    <article key={thread.id + (info.tracking ?? '')} className="package-tile" data-status={info.status}>
                      <span className="package-tile__icon">
                        <Icon name={info.status === 'delivered' ? 'inventory_2' : 'local_shipping'} size={24} filled />
                      </span>
                      <p className="md-label-large package-tile__from">{info.merchant ?? info.carrier ?? thread.participants.at(-1)?.name ?? 'Package'}</p>
                      <p className="package-tile__status">{packageLabel(info.status)}</p>
                      <div
                        className="package-tile__bar"
                        aria-hidden="true"
                        style={{ '--p': `${((step + 1) / PACKAGE_STEPS.length) * 100}%` } as CSSProperties}
                      >
                        <span />
                      </div>
                      <p className="md-body-small package-tile__meta">
                        {stale
                          ? `No news since ${listDate(date)}`
                          : late
                            ? `Running late, was due ${info.eta}`
                            : info.status !== 'delivered' && info.eta
                              ? `Expected ${info.eta}`
                              : `Updated ${listDate(date)}`}
                      </p>
                      <footer className="package-tile__actions">
                        {info.trackUrl && info.status !== 'delivered' && !stale && (
                          <Button variant="tonal" size="xs" onClick={() => openUrl(info.trackUrl!)}>
                            Track
                          </Button>
                        )}
                        <Button variant="text" size="xs" onClick={() => openThread(thread.id, { kind: 'purchases' })}>
                          Open email
                        </Button>
                        <span className="package-tile__menu">
                          <PackageMenu pkgKey={key} record={record} status={info.status} seed={{ threadId: thread.id, info, at: date }} />
                        </span>
                      </footer>
                    </article>
                  );
                })}
              </div>
            </>
          )}
          {bills.length > 0 && (
            <>
              <h2 className="list-section md-label-large purchases__section">Bills</h2>
              <div className="seg-list">
                {bills.map(({ info, thread, date }) => (
                  <div key={thread.id} className="row-wrap">
                    <button type="button" className="row purchase-row" onClick={() => openThread(thread.id, { kind: 'purchases' })}>
                      <Avatar name={info.merchant} email={thread.participants.at(-1)?.email ?? info.merchant} size={40} />
                      <span className="purchase-row__text">
                        <span className="md-title-small">{info.merchant}</span>
                        <span className="md-body-medium purchase-row__meta">{info.due ? `Due ${info.due}` : listDate(date)}{info.autopay ? ` · Autopay ${info.autopay.split(',')[0].toLowerCase()}` : ''}</span>
                      </span>
                      <span className="purchase-row__amount">{info.amount}</span>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {receipts.length > 0 && (
            <>
              <h2 className="list-section md-label-large purchases__section">Receipts</h2>
              <div className="seg-list">
                {receipts.map(({ info, thread, date }) => (
                  <div key={thread.id} className="row-wrap">
                    <button type="button" className="row purchase-row" onClick={() => openThread(thread.id, { kind: 'purchases' })}>
                      <Avatar name={info.merchant} email={thread.participants.at(-1)?.email ?? info.merchant} size={40} />
                      <span className="purchase-row__text">
                        <span className="md-title-small">{info.merchant}</span>
                        <span className="md-body-medium purchase-row__meta">
                          {listDate(date)}
                          {info.orderNo ? ` · Order ${info.orderNo}` : ''}
                        </span>
                      </span>
                      <span className="purchase-row__amount">{info.total}</span>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
