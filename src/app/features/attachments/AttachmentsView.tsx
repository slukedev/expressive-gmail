import { useInfiniteQuery } from '@tanstack/react-query';
import { PageMark } from '../list/PageMark';
import { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from '../../data/client';
import type { Attachment, ThreadSummary } from '../../data/types';
import { listDate, participantsLine } from '../../lib/format';
import { openThread } from '../../router/useRoute';
import { Chip } from '../../ui/Chip';
import { EmptyArt } from '../../ui/EmptyArt';
import { Icon, type IconName } from '../../ui/Icon';
import { LoadingIndicator } from '../../ui/LoadingIndicator';
import { AttachmentThumb } from './AttachmentThumb';
import { AttachmentViewer } from './AttachmentViewer';
import { fileIcon, fileKind } from './fileIcon';

type Kind = 'all' | 'image' | 'pdf' | 'doc' | 'sheet';
interface Item {
  file: Attachment & { messageId: string };
  thread: ThreadSummary;
}

/** Every file you've received, as a gallery. */
export function AttachmentsView() {
  const [kind, setKind] = useState<Kind>('all');
  const [viewing, setViewing] = useState<number | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['attachments-view'],
    queryFn: ({ pageParam }) => backend().listThreads({ q: 'has:attachment -in:chats', pageToken: pageParam, pageSize: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextPageToken,
  });
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && q.hasNextPage && !q.isFetchingNextPage && void q.fetchNextPage(), { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [q]);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const t of q.data?.pages.flatMap((p) => p.threads) ?? []) {
      for (const a of t.attachments) {
        out.push({ file: { ...a, size: a.size ?? 0 }, thread: t });
      }
    }
    return out.filter((i) => {
      const k = fileKind(i.file.mimeType, i.file.filename);
      return kind === 'all' || k === kind || (kind === 'doc' && (k === 'doc' || k === 'event'));
    });
  }, [q.data, kind]);

  const groups = useMemo(() => {
    const map = new Map<string, Item[]>();
    items.forEach((i) => {
      const key = new Date(i.thread.lastDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      map.set(key, [...(map.get(key) ?? []), i]);
    });
    return [...map.entries()];
  }, [items]);

  let index = 0;
  return (
    <section className="page" aria-labelledby="att-title">
      <header className="page__head">
        <PageMark kind="attachments" />
        <h1 id="att-title" className="md-headline-medium md-emphasized">Attachments</h1>
        <p className="md-body-large page__lede">Every file people sent you, newest first.</p>
        <div className="search-chips" role="toolbar" aria-label="File types">
          {(
            [
              ['all', 'All files', 'attach_file'],
              ['image', 'Photos', 'image'],
              ['pdf', 'PDFs', 'picture_as_pdf'],
              ['doc', 'Documents', 'description'],
              ['sheet', 'Spreadsheets', 'table_chart'],
            ] as [Kind, string, IconName][]
          ).map(([k, label, icon]) => (
            <Chip key={k} kind="filter" icon={kind === k ? undefined : icon} selected={kind === k} onClick={() => setKind(k)}>
              {label}
            </Chip>
          ))}
        </div>
      </header>
      {q.isPending ? (
        <div className="page__loading">
          <LoadingIndicator contained label="Loading attachments" />
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <EmptyArt icon="attach_file" />
          <h2 className="md-title-large empty__title">No files here</h2>
          <p className="md-body-medium empty__text">Files people send you will show up here.</p>
        </div>
      ) : (
        groups.map(([month, list]) => (
          <div key={month} className="att-group">
            <h2 className="list-section md-label-large att-group__title">{month}</h2>
            <ul className="attachments__grid attachments__grid--gallery" role="list">
              {list.map((item) => {
                const i = index++;
                return (
                  <li key={`${item.thread.id}-${item.file.id}`} className="att-card" data-kind={fileKind(item.file.mimeType, item.file.filename)}>
                    <button type="button" className="att-card__open" onClick={() => setViewing(i)} aria-label={`Preview ${item.file.filename}`}>
                      <AttachmentThumb file={item.file} iconSize={36} />
                      <span className="att-card__meta">
                        <Icon name={fileIcon(item.file.mimeType, item.file.filename) as IconName} size={20} className="att-card__type" />
                        <span className="att-card__name">{item.file.filename}</span>
                      </span>
                      <span className="att-card__size att-card__byline md-body-small">
                        <span className="att-card__byline-name">{participantsLine(item.thread.participants.slice(-1))}</span>
                        <span className="att-card__byline-date">· {listDate(item.thread.lastDate)}</span>
                      </span>
                    </button>
                    <button type="button" className="att-card__thread md-label-medium" onClick={() => openThread(item.thread.id, { kind: 'attachments' })}>
                      Open email
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
      <div ref={sentinel} />
      {q.isFetchingNextPage && (
        <div className="list-more">
          <LoadingIndicator size={40} label="Loading more files" />
        </div>
      )}
      {viewing !== null && (
        <AttachmentViewer files={items.map((i) => i.file)} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      )}
    </section>
  );
}
