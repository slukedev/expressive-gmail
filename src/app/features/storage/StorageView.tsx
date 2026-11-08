import { useEffect, useMemo, useState } from 'react';
import { mail } from '../../data/actions';
import { useThreadList } from '../../data/hooks';
import { useCapabilities } from '../../data/useBackendKind';
import type { ThreadSummary } from '../../data/types';
import { fileSize, listDate, participantsLine } from '../../lib/format';
import { useMe } from '../../data/hooks';
import { classicGmail } from '../../lib/host';
import type { View } from '../../router/routes';
import { navigate, openThread } from '../../router/useRoute';
import { Avatar } from '../../ui/Avatar';
import { Button, IconButton } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { Dialog } from '../../ui/Dialog';
import { Icon, type IconName } from '../../ui/Icon';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { ShapeIcon, type ShapeName } from '../../ui/ShapeIcon';
import { fileIcon } from '../attachments/fileIcon';
import { PageMark } from '../list/PageMark';
import { countLabel, RANGES, OLD_MAIL, type Bucket } from './buckets';
import './storage.css';

const VIEW: View = { kind: 'storage' };

/** The mail that takes the most room, found with Gmail's size and age search and cleared in one step. Deleting moves to Trash, so every step can be undone. */
export function StorageView() {
  return (
    <section className="page storage" aria-labelledby="storage-title">
      <header className="page__head">
        <PageMark kind="storage" />
        <h1 id="storage-title" className="md-headline-medium md-emphasized">
          Free up space
        </h1>
        <p className="md-body-large page__lede">
          Gmail shares your Google storage with Drive and Photos.
        </p>
      </header>
      <div className="storage__cols">
        <div className="storage__col">
          <LargeMail />
        </div>
        <div className="storage__col">
          <h2 className="list-section md-label-large storage__section">Old promotions and notifications</h2>
          <div className="seg-list storage__buckets">
            {OLD_MAIL.map((b) => (
              <BucketRow key={b.id} bucket={b} />
            ))}
          </div>
          <h2 className="list-section md-label-large storage__section">Spam and Trash</h2>
          <div className="seg-list storage__buckets">
            <BinRow folder="spam" />
            <BinRow folder="trash" />
          </div>
        </div>
      </div>
    </section>
  );
}

function useBucket(bucket: Pick<Bucket, 'q'>, view: View = VIEW) {
  const list = useThreadList(view, bucket.q);
  const threads = useMemo(() => list.data?.pages.flatMap((p) => p.threads) ?? [], [list.data]);
  const first = list.data?.pages[0];
  return { list, threads, count: countLabel(threads.length, first?.resultSizeEstimate, !!list.hasNextPage, first?.resultSizeAtLeast) };
}

function LargeMail() {
  const huge = useBucket(RANGES[0]!);
  const big = useBucket(RANGES[1]!);
  const medium = useBucket(RANGES[2]!);
  const results = [huge, big, medium];
  const [picked, setPicked] = useState<string | null>(null);
  // Until you pick, show the biggest range that has anything.
  const settled = results.every((r) => !r.list.isPending);
  const auto = settled ? (RANGES.find((_, i) => results[i]!.threads.length > 0)?.id ?? RANGES[0]!.id) : RANGES[0]!.id;
  // Once chosen, the range stays, so deleting everything in it shows the empty state instead of jumping.
  useEffect(() => {
    if (settled && picked === null) setPicked(auto);
  }, [settled, picked, auto]);
  const active = picked ?? auto;
  const index = RANGES.findIndex((r) => r.id === active);
  const current = results[index]!;
  const [confirm, setConfirm] = useState(false);
  const range = RANGES[index]!;

  return (
    <>
      <h2 className="list-section md-label-large storage__section">Large attachments</h2>
      <div className="search-chips storage__ranges" role="toolbar" aria-label="Size">
        {RANGES.map((r, i) => {
          return (
            <Chip key={r.id} kind="filter" selected={active === r.id} onClick={() => setPicked(r.id)}>
              {r.label}
              {!results[i]!.list.isPending && <span className="storage__chip-count">{results[i]!.count}</span>}
            </Chip>
          );
        })}
      </div>
      {current.list.isPending ? (
        <div className="storage__loading">
          <LoadingIndicator size={40} label="Looking for large attachments" />
        </div>
      ) : current.list.isError ? (
        <Problem onRetry={() => void current.list.refetch()} />
      ) : current.threads.length === 0 ? (
        <p className="storage__none md-body-medium">
          <Icon name="check_circle" size={20} />
          Nothing {range.phrase} in your mail.
        </p>
      ) : (
        <>
          <div className="seg-list storage__list" role="list" aria-label={`Conversations ${range.phrase}`}>
            {current.threads.map((t) => (
              <LargeRow key={t.id} thread={t} />
            ))}
          </div>
          <div className="storage__bulk">
            <span className="md-body-medium storage__bulk-text">
              {current.count} {current.threads.length === 1 && !current.list.hasNextPage ? 'conversation' : 'conversations'} {range.phrase}
              {!current.list.hasNextPage && current.threads.every((t) => t.size) && `, ${fileSize(current.threads.reduce((sum, t) => sum + t.size!, 0))} in all`}
            </span>
            <Button variant="tonal" size="s" icon="delete" onClick={() => setConfirm(true)}>
              {current.threads.length === 1 ? 'Delete it' : current.list.hasNextPage ? `Delete these ${current.threads.length}` : `Delete all ${current.threads.length}`}
            </Button>
          </div>
          {current.list.hasNextPage && (
            <div className="storage__more">
              <Button variant="text" onClick={() => void current.list.fetchNextPage()} disabled={current.list.isFetchingNextPage}>
                {current.list.isFetchingNextPage ? 'Loading...' : 'Show more'}
              </Button>
            </div>
          )}
        </>
      )}
      <ConfirmDelete
        open={confirm}
        count={current.threads.length}
        what={`with attachments ${range.phrase}`}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void mail.trash(current.threads.map((t) => t.id));
        }}
      />
    </>
  );
}

function LargeRow({ thread }: { thread: ThreadSummary }) {
  const me = useMe();
  const from = thread.participants.at(-1);
  const files = thread.attachments.slice(0, 2);
  const more = thread.attachments.length - files.length;
  const open = () => openThread(thread.id, VIEW);
  return (
    <div className="row-wrap" role="listitem">
      <div
        className="row storage-row"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      >
        <Avatar name={from?.name} email={from?.email ?? ''} size={40} />
        <span className="storage-row__text">
          <span className="md-title-small storage-row__from">{participantsLine(thread.participants, me) || 'Unknown sender'}</span>
          <span className="md-body-medium storage-row__subject">{thread.subject || '(no subject)'}</span>
          {files.length > 0 && (
            <span className="storage-row__files">
              {files.map((f) => (
                <span key={f.id} className="storage-file md-label-large">
                  <Icon name={fileIcon(f.mimeType, f.filename) as IconName} size={18} />
                  <span className="storage-file__name">{f.filename}</span>
                </span>
              ))}
              {more > 0 && <span className="storage-file storage-file--more md-label-large">+{more}</span>}
            </span>
          )}
        </span>
        <span className="storage-row__meta">
          {thread.size ? <span className="md-label-large storage-row__size">{fileSize(thread.size)}</span> : null}
          <span className="md-label-medium storage-row__date">{listDate(thread.lastDate)}</span>
        </span>
        <IconButton
          icon="delete"
          label={`Delete ${thread.subject || 'conversation'}`}
          size="xs"
          onClick={(e) => {
            e.stopPropagation();
            void mail.trash([thread.id]);
          }}
        />
      </div>
    </div>
  );
}

const BUCKET_SHAPES: Record<string, ShapeName> = { promotions: 'Sunny', social: 'Clover4Leaf', updates: 'Cookie7Sided' };

function BucketRow({ bucket }: { bucket: Bucket }) {
  const { list, threads, count } = useBucket(bucket);
  const [confirm, setConfirm] = useState(false);
  const n = threads.length;
  return (
    <div className="row-wrap">
      <div className="row storage-bucket">
        <ShapeIcon
          shape={BUCKET_SHAPES[bucket.id] ?? 'Cookie9Sided'}
          icon={bucket.icon}
          size={40}
          iconSize={20}
          bg="var(--md-sys-color-surface-container-highest)"
          fg="var(--md-sys-color-on-surface-variant)"
        />
        <span className="storage-bucket__text">
          <span className="md-title-small">{bucket.title}</span>
          <span className="md-body-medium storage-bucket__meta">
            {list.isPending ? 'Counting...' : list.isError ? "Couldn't check" : n ? `${count} ${n === 1 ? 'conversation' : 'conversations'}` : 'Nothing here'}
          </span>
        </span>
        {list.isError ? (
          <Button variant="text" size="s" onClick={() => void list.refetch()}>
            Try again
          </Button>
        ) : n > 0 ? (
          <>
            <Button variant="text" size="s" onClick={() => navigate({ view: { kind: 'search', query: bucket.q } })}>
              Review
            </Button>
            <Button variant="tonal" size="s" icon="delete" onClick={() => setConfirm(true)}>
              Delete
            </Button>
          </>
        ) : null}
      </div>
      <ConfirmDelete
        open={confirm}
        count={n}
        what={bucket.confirmWhat}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void mail.trash(threads.map((t) => t.id));
        }}
      />
    </div>
  );
}

function BinRow({ folder }: { folder: 'spam' | 'trash' }) {
  const view: View = { kind: 'folder', folder };
  const { list, threads, count } = useBucket({ q: `in:${folder}` }, view);
  const caps = useCapabilities();
  const [confirm, setConfirm] = useState(false);
  const n = threads.length;
  const name = folder === 'spam' ? 'Spam' : 'Trash';
  // Mail here counts against storage until it's gone for good.
  const meta = list.isPending
    ? 'Counting...'
    : n
      ? `${count} ${n === 1 ? 'conversation' : 'conversations'}. Deleted for good after 30 days.`
      : 'Empty';
  return (
    <div className="row-wrap">
      <div className="row storage-bucket">
        <ShapeIcon
          shape={folder === 'spam' ? 'Burst' : 'Pill'}
          icon={folder === 'spam' ? 'report' : 'delete'}
          size={40}
          iconSize={20}
          bg={folder === 'spam' ? 'var(--md-sys-color-error-container)' : 'var(--md-sys-color-surface-container-highest)'}
          fg={folder === 'spam' ? 'var(--md-sys-color-on-error-container)' : 'var(--md-sys-color-on-surface-variant)'}
        />
        <span className="storage-bucket__text">
          <span className="md-title-small">{name}</span>
          <span className="md-body-medium storage-bucket__meta">{meta}</span>
        </span>
        {n > 0 && (
          <Button variant="text" size="s" onClick={() => navigate({ view })}>
            Review
          </Button>
        )}
        {n > 0 &&
          (caps.deleteForever ? (
            <Button variant="tonal" size="s" icon="delete_forever" onClick={() => setConfirm(true)}>
              {folder === 'spam' ? 'Delete all' : 'Empty'}
            </Button>
          ) : (
            // This connection can't delete forever; Gmail's own page can.
            <Button variant="tonal" size="s" trailingIcon="open_in_new" onClick={classicGmail}>
              {folder === 'spam' ? 'Delete in classic Gmail' : 'Empty in classic Gmail'}
            </Button>
          ))}
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        icon="delete_forever"
        title={folder === 'spam' ? 'Delete all spam?' : 'Empty Trash?'}
        description={`Everything in ${name} will be deleted forever and the space freed. You can't undo this.`}
        actions={
          <>
            <Button variant="text" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="text"
              onClick={() => {
                setConfirm(false);
                void mail.emptyFolder(folder);
              }}
            >
              {folder === 'spam' ? 'Delete all spam' : 'Empty Trash'}
            </Button>
          </>
        }
      />
    </div>
  );
}

function ConfirmDelete({ open, count, what, onClose, onConfirm }: { open: boolean; count: number; what: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      icon="delete"
      title={count === 1 ? 'Delete 1 conversation?' : `Delete ${count} conversations?`}
      description={`Conversations ${what} move to Trash. You can undo right after, and the space is freed when Trash is emptied.`}
      actions={
        <>
          <Button variant="text" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="text" onClick={onConfirm}>
            Delete
          </Button>
        </>
      }
    />
  );
}

function Problem({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="list-notice storage__problem" role="alert">
      <Icon name="cloud_off" size={20} className="list-notice__icon" />
      <p className="md-body-medium list-notice__text">Couldn't search your mail for large attachments.</p>
      <Button variant="text" size="s" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
