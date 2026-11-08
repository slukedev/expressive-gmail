import { useEffect, useId, useState } from 'react';
import { useMe } from '../../data/hooks';
import type { ThreadSummary } from '../../data/types';
import { Button, IconButton, cx } from '../../ui/Button';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { EmptyArt } from '../../ui/EmptyArt';
import { listDate } from '../../lib/format';
import { navigate } from '../../router/useRoute';
import { scopedThreadId } from '../../data/accounts/threads';
import { aside, useAside, visibleItems, type AsideItem } from './store';
import './replylater.css';

/** --md-sys-motion-spatial-default. */
const FOLD_MS = 435;

function senderName(item: AsideItem) {
  return item.from.name?.split(/\s+/)[0] || item.from.email.split('@')[0] || 'Someone';
}

/** "Lena", "Lena and Marco", "Lena, Marco and 2 more" */
function whoLine(items: AsideItem[]): string {
  const names = [...new Set(items.map(senderName))];
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Folded, one card with the next sheets peeking out; unfolded, a segmented list. */
export function ReplyLaterStack({ threads }: { threads: ThreadSummary[] }) {
  const all = useAside((s) => s.items);
  const open = useAside((s) => s.open);
  const me = useMe();
  const items = visibleItems(all);
  const listId = useId();
  // The rows stay mounted while the fold closes, then leave.
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) return setShown(true);
    const t = window.setTimeout(() => setShown(false), FOLD_MS);
    return () => window.clearTimeout(t);
  }, [open]);

  // Answered from another device or classic Gmail: it comes off on its own.
  useEffect(() => aside.sync(threads, me), [threads, me]);

  if (!items.length) return null;
  const n = items.length;
  const faces = items.slice(0, 3);

  return (
    <section className="aside" aria-label="Reply later" data-open={open || undefined} data-many={n > 1 || undefined}>
      <div className="aside__stack">
      <div className="aside__card">
        <button
          type="button"
          className="aside__head"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => useAside.setState({ open: !open })}
        >
          <span className="aside__faces" aria-hidden="true">
            {faces.map((i) => (
              <Avatar key={i.threadId} name={i.from.name} email={i.from.email} size={32} className="aside__face" />
            ))}
          </span>
          <span className="aside__titles">
            <span className="md-title-medium aside__title">
              Reply later <span className="aside__count md-label-medium">{n}</span>
            </span>
            <span className="md-body-medium aside__who">{whoLine(items)}</span>
          </span>
          <Icon name="expand_more" size={24} className="aside__chevron" />
        </button>
        <Button variant="tonal" size="s" icon="reply" className="aside__start" onClick={aside.start} aria-label={n === 1 ? 'Reply' : 'Start replying'}>
          <span className="aside__start-long">{n === 1 ? 'Reply' : 'Start replying'}</span>
          <span className="aside__start-short">{n === 1 ? 'Reply' : 'Start'}</span>
        </Button>
      </div>
      </div>
      <div className="aside__fold" id={listId} inert={!open}>
        <div className="aside__fold-inner">
          {(open || shown) && (
            <ul className="seg-list aside__list" role="list" aria-label="Set aside to reply later">
              {items.map((item) => (
                <AsideRow key={item.threadId} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** No inbox-zero celebration while people are still waiting on you. */
export function ReplyLaterEmpty() {
  const all = useAside((s) => s.items);
  const open = useAside((s) => s.open);
  const items = visibleItems(all);
  if (!items.length) return null;
  const n = items.length;
  const who = whoLine(items);
  return (
    <div className="empty aside-empty" role="status">
      <EmptyArt icon="pending_actions" tone="tertiary" />
      <h2 className="md-title-large empty__title">{n === 1 ? '1 reply to write' : `${n} replies to write`}</h2>
      <p className="md-body-medium empty__text">
        The rest of your inbox is clear. {who} {who.includes(' and ') ? 'are' : 'is'} waiting to hear back.
      </p>
      {!open && (
        <Button variant="tonal" icon="expand_more" onClick={() => useAside.setState({ open: true })}>
          See who's waiting
        </Button>
      )}
    </div>
  );
}

function AsideRow({ item }: { item: AsideItem }) {
  const open = () => navigate({ view: { kind: 'folder', folder: 'inbox' }, threadId: scopedThreadId(item.threadId, item.account) });
  const name = item.from.name || item.from.email;
  return (
    <li className="row-wrap">
      <div
        className={cx('row', 'aside-row')}
        role="button"
        tabIndex={0}
        aria-label={`${name}, ${item.subject || '(no subject)'}. Set aside ${listDate(item.addedAt)}.`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
      >
        <Avatar name={item.from.name} email={item.from.email} size={40} />
        <span className="aside-row__text">
          <span className="md-title-small aside-row__from">{name}</span>
          <span className="md-body-medium aside-row__subject">
            {item.subject || '(no subject)'}
            {item.snippet && <span className="aside-row__snippet"> - {item.snippet}</span>}
          </span>
        </span>
        <span className="md-label-medium aside-row__when">{listDate(item.lastDate)}</span>
        <IconButton
          icon="check"
          label="Done, remove from Reply later"
          size="xs"
          className="aside-row__done"
          onClick={(e) => {
            e.stopPropagation();
            aside.done(item.threadId);
          }}
        />
      </div>
    </li>
  );
}
