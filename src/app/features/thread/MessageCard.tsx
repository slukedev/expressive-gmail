import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { photos } from '../../data/photos';
import { useAccount, useMe } from '../../data/hooks';
import type { Address, Message } from '../../data/types';
import { addressList, displayName, fullDate, isMe, messageDate, relative } from '../../lib/format';
import { closeThread, navigate } from '../../router/useRoute';
import { local, useLocal } from '../../state/local';
import { useSettings } from '../../state/settings';
import { Avatar } from '../../ui/Avatar';
import { Button, IconButton, cx } from '../../ui/Button';
import { Icon, type IconName } from '../../ui/Icon';
import { useCopy } from '../../ui/feedback';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { editDraft, forwardAsAttachment, replyToMessage } from '../compose/open';
import { Attachments } from './Attachments';
import { EmailBody, isDesigned } from './EmailBody';
import { setShowsOriginal, useShowsOriginal } from '../darkmail/original';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { canUnsubscribe, UnsubscribeDialog, useListHeaders } from './UnsubscribeButton';
import { Popover } from '@base-ui/react/popover';
import { downloadOriginal, printThread, showOriginal } from './print';
import { backend } from '../../data/client';
import { SenderCard } from '../../smart/SenderCard';
import { messageText, translateUrl } from '../../smart/extract';
import { openUrl } from '../../lib/host';
import { mail } from '../../data/actions';
import { snack } from '../../ui/Snackbar';
import { Dialog } from '../../ui/Dialog';
import { PhishingBanner, TranslateBanner } from '../../smart/Banners';
import { TrackOrderMenuItem } from '../../smart/TrackOrderMenu';

interface Props {
  message: Message;
  threadId: string;
  expanded: boolean;
  last: boolean;
  /** Takes the id, so the list can hand every card the same function. */
  onToggle: (id: string) => void;
  /** Its place in the stagger when revealed from the folded middle. */
  revealIndex?: number;
}

export const MessageCard = memo(function MessageCard({ message, threadId, expanded, last, onToggle, revealIndex }: Props) {
  const reveal = revealIndex === undefined ? undefined : ({ '--reveal-i': revealIndex } as CSSProperties);
  const { data: account } = useAccount();
  const mine = useMe();
  const me = account?.email;
  const fromMe = isMe(message.from.email, mine);
  const name = displayName(message.from, mine);
  const externalImages = useSettings((s) => s.externalImages);
  const trusted = useLocal((s) => s.trustedImageSenders.includes(message.from.email.toLowerCase()));
  const [showImages, setShowImages] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const blocked = useLocal((s) => s.blocked.includes(message.from.email.toLowerCase()));
  const spam = message.labelIds.includes('SPAM');
  const loadImages = !spam && (externalImages === 'always' || trusted || showImages);
  const listHeaders = useListHeaders(message);
  // A sender whose verified logo lives under its own selector names it here.
  useEffect(() => photos.bimiSelector(message.from.email, listHeaders.bimiSelector), [message.from.email, listHeaders.bimiSelector]);
  const dark = useResolvedDark();
  const darkEmails = useSettings((s) => s.darkEmails);
  const original = useShowsOriginal(message.id);
  // Only emails with their own colors get darkened, so only they get the switch. Show original and Forward as attachment need the real source.
  const raw = typeof backend().getRawMessage === 'function';
  const themable = dark && darkEmails && !!message.bodyHtml && isDesigned(message.bodyHtml);
  const unsubscribable = !message.isDraft && expanded && canUnsubscribe(message, listHeaders);
  const unread = message.labelIds.includes('UNREAD');

  if (message.isDraft) {
    return (
      <div data-mid={message.id} className="msg msg--collapsed msg--draft" onClick={() => editDraft(message)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), editDraft(message))}>
        <Avatar name={account?.name} email={me ?? 'me'} photoUrl={account?.photoUrl} size={32} />
        <span className="msg__name">
          <span className="msg__draft">Draft</span>
        </span>
        <span className="msg__snippet">{message.snippet || 'Empty draft'}</span>
        <span className="msg__date">{relative(message.date)}</span>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div
        data-mid={message.id}
        data-reveal={reveal ? '' : undefined}
        style={reveal}
        className={cx('msg', 'msg--collapsed', unread && 'msg--unread')}
        onClick={() => onToggle(message.id)}
        role="button"
        tabIndex={0}
        aria-expanded={false}
        aria-label={`Message from ${name}, ${fullDate(message.date)}${unread ? ', unread' : ''}`}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle(message.id))}
      >
        <Avatar name={message.from.name} email={message.from.email} size={32} morph="avatar" />
        <span className="msg__name" data-morph="name">
          {name}
        </span>
        <span className="msg__snippet">{message.snippet}</span>
        {message.attachments.some((a) => !a.inline) && <Icon name="attach_file" size={16} className="msg__clip" />}
        <span className="msg__date" title={fullDate(message.date)}>
          {relative(message.date)}
        </span>
      </div>
    );
  }

  return (
    <div data-mid={message.id} data-reveal={reveal ? '' : undefined} style={reveal} className="msg msg--expanded" data-last={last || undefined}>
      <header
        className="msg__head"
        onClick={(e) => {
          // Menus and dialogs are portaled but their clicks still bubble here through React.
          if (!e.currentTarget.contains(e.target as Node)) return;
          if ((e.target as HTMLElement).closest('button, a, [role="menuitem"], [role="dialog"], [tabindex]')) return;
          onToggle(message.id);
        }}
      >
        <Avatar name={message.from.name} email={message.from.email} size={40} morph="avatar" />
        <div className="msg__who">
          <div className="msg__line" data-when={relative(message.date)}>
            <SenderCard person={message.from}>
              <span className="msg__from" tabIndex={0} data-morph="name">
                {fromMe ? (account?.name ?? 'me') : (message.from.name ?? message.from.email)}
              </span>
            </SenderCard>
            {/* The address stays out of the way until you point at the header or tab into it. */}
            {message.from.name && <span className="msg__email">&lt;{message.from.email}&gt;</span>}
          </div>
          <Recipients message={message} me={me} />
        </div>
        <div className="msg__actions">
          <span className="msg__when" title={fullDate(message.date)}>
            <span className="msg__when-full">{messageDate(message.date)}</span>
            <span className="msg__when-short">{relative(message.date)}</span>
          </span>
          {unsubscribable && (
            <Button variant="text" size="xs" className="msg__unsubscribe" onClick={() => setUnsubscribing(true)}>
              Unsubscribe
            </Button>
          )}
          <IconButton icon="reply" label="Reply" onClick={() => replyToMessage(threadId, message, 'reply')} />
          <Menu trigger={<IconButton icon="more_vert" label="More" />} align="end">
            <MenuItem icon="reply" onClick={() => replyToMessage(threadId, message, 'reply')}>Reply</MenuItem>
            <MenuItem icon="reply_all" onClick={() => replyToMessage(threadId, message, 'reply-all')}>Reply all</MenuItem>
            <MenuItem icon="forward" onClick={() => replyToMessage(threadId, message, 'forward')}>Forward</MenuItem>
            {raw && (
              <MenuItem
                icon="forward_to_inbox"
                onClick={() => void forwardAsAttachment(threadId, message).catch(() => snack("Couldn't attach this message. Try Forward instead."))}
              >
                Forward as attachment
              </MenuItem>
            )}
            {unsubscribable && (
              <MenuItem icon="unsubscribe" onClick={() => setUnsubscribing(true)}>
                Unsubscribe
              </MenuItem>
            )}
            <MenuSeparator />
            <MenuItem
              icon="mark_email_unread"
              onClick={() => {
                // Unread is kept per conversation, so the whole conversation turns unread.
                void mail.markRead([threadId], false, true);
                closeThread();
              }}
            >
              Mark unread from here
            </MenuItem>
            <MenuItem icon="print" onClick={() => printThread({ subject: message.subject, messages: [message] }, me, message.id)}>
              Print
            </MenuItem>
            <TrackOrderMenuItem threadId={threadId} />
            <MenuSeparator />
            <MenuItem icon="filter_alt" onClick={() => navigate({ view: { kind: 'search', query: `from:${message.from.email}` } })}>
              Find emails from {firstWord(message.from)}
            </MenuItem>
            <MenuItem icon="translate" onClick={() => openUrl(translateUrl(`${message.subject}\n\n${messageText(message).text}`))}>
              Translate message
            </MenuItem>
            {themable && (
              <MenuItem icon={original ? 'dark_mode' : 'light_mode'} onClick={() => setShowsOriginal(message.id, !original)}>
                {original ? 'View in dark theme' : 'View in light theme'}
              </MenuItem>
            )}
            {raw && (
              <MenuItem
                icon="code"
                onClick={() =>
                  void backend()
                    .getRawMessage!(message.id)
                    .then((src) => showOriginal(src, message.subject))
                    .catch(() => snack("Couldn't load the original message. Try again."))
                }
              >
                Show original
              </MenuItem>
            )}
            <MenuItem icon="download" onClick={() => downloadOriginal(message)}>Download message</MenuItem>
            {!fromMe && (
              <>
                <MenuSeparator />
                <MenuItem icon="block" onClick={() => setBlocking(true)}>
                  {blocked ? `Unblock ${firstWord(message.from)}` : `Block ${firstWord(message.from)}`}
                </MenuItem>
                <MenuItem
                  icon="gpp_maybe"
                  danger
                  onClick={() => {
                    void mail.spam([threadId]);
                    snack('Reported as phishing and moved to Spam');
                  }}
                >
                  Report phishing
                </MenuItem>
              </>
            )}
          </Menu>
          {unsubscribable && <UnsubscribeDialog message={{ ...message, headers: listHeaders }} open={unsubscribing} onOpenChange={setUnsubscribing} />}
          <Dialog
            open={blocking}
            onOpenChange={setBlocking}
            icon="block"
            title={blocked ? `Unblock ${message.from.name ?? message.from.email}?` : `Block ${message.from.name ?? message.from.email}?`}
            description={
              blocked
                ? `New messages from ${message.from.email} will come to your inbox again.`
                : `New messages from ${message.from.email} will go to Spam. You can unblock them in Settings.`
            }
            actions={
              <>
                <Button variant="text" onClick={() => setBlocking(false)}>
                  Cancel
                </Button>
                <Button
                  variant="text"
                  onClick={() => {
                    setBlocking(false);
                    if (blocked) {
                      local.unblock(message.from.email);
                      snack(`${firstWord(message.from)} is unblocked`);
                    } else {
                      local.block(message.from.email);
                      snack(`Blocked ${message.from.email}`, { action: { label: 'Undo', onClick: () => local.unblock(message.from.email) } });
                    }
                  }}
                >
                  {blocked ? 'Unblock' : 'Block'}
                </Button>
              </>
            }
          />
        </div>
      </header>
      <PhishingBanner message={message} />
      <TranslateBanner message={message} />
      {!loadImages && !spam && hasRemoteImages(message.bodyHtml) && (
        <div className="msg__banner">
          <Icon name="image" size={20} />
          <span className="md-body-medium">Images are hidden.</span>
          <Button variant="text" size="xs" onClick={() => setShowImages(true)}>
            Show images
          </Button>
          <Button variant="text" size="xs" onClick={() => local.trustImages(message.from.email)}>
            Always show from {firstWord(message.from)}
          </Button>
        </div>
      )}
      <EmailBody message={message} loadImages={loadImages} linksOff={spam} />
      {message.attachments.some((a) => !a.inline) && <Attachments message={message} />}
    </div>
  );
});

function firstWord(a: Address) {
  return a.name?.split(/\s+/)[0] ?? a.email;
}

function hasRemoteImages(html?: string) {
  return !!html && /<img[^>]+src=["']?https?:/i.test(html);
}

function Recipients({ message, me }: { message: Message; me?: string }) {
  const mine = useMe();
  const to = addressList(message.to, me) || 'undisclosed recipients';
  const cc = message.cc.length ? `, cc: ${addressList(message.cc, me)}` : '';
  return (
    <Popover.Root>
      <Popover.Trigger className="msg__to" onClick={(e) => e.stopPropagation()}>
        <span>to {to}{cc}</span>
        <Icon name="arrow_drop_down" size={18} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={16} className="m3-menu-positioner">
          <Popover.Popup className="details-popover" aria-label="Message details">
            <People label="From" people={[message.from]} mine={mine} />
            {!!message.replyTo?.length && <People label="Reply to" people={message.replyTo} mine={mine} />}
            <People label="To" people={message.to} mine={mine} />
            {message.cc.length > 0 && <People label="Cc" people={message.cc} mine={mine} />}
            {message.bcc.length > 0 && <People label="Bcc" people={message.bcc} mine={mine} />}
            <dl className="details-popover__facts">
              <Fact icon="schedule" label="Date">
                {fullDate(message.date)}
              </Fact>
              <Fact icon="mail" label="Subject">
                {message.subject || '(no subject)'}
              </Fact>
              {message.headers.listId && (
                <Fact icon="forum" label="Mailing list">
                  {message.headers.listId}
                </Fact>
              )}
            </dl>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function People({ label, people, mine }: { label: string; people: Address[]; mine: string[] }) {
  return (
    <section className="details-popover__group" aria-label={label}>
      <h3 className="md-label-medium details-popover__label">
        {label}
        {people.length > 2 && <span className="details-popover__count">{people.length}</span>}
      </h3>
      {people.length ? (
        people.map((p) => <Person key={p.email} person={p} you={isMe(p.email, mine)} />)
      ) : (
        <p className="md-body-medium details-popover__none">Undisclosed recipients</p>
      )}
    </section>
  );
}

function Person({ person, you }: { person: Address; you: boolean }) {
  const { copied, copy } = useCopy();
  const title = person.name ?? person.email;
  return (
    <div className="details-popover__person">
      <Avatar name={person.name} email={person.email} size={32} />
      <div className="details-popover__names">
        <span className="md-title-small">
          {title}
          {you && <span className="details-popover__you"> (you)</span>}
        </span>
        {person.name && <span className="md-body-small details-popover__email">{person.email}</span>}
      </div>
      <IconButton
        icon="content_copy"
        label={`Copy ${person.email}`}
        tooltip="Copy address"
        size="xs"
        className="details-popover__copy"
        confirmed={copied}
        confirmedLabel="Copied"
        onClick={() => void copy(person.email, 'Email address copied')}
      />
    </div>
  );
}

function Fact({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="details-popover__fact">
      <Icon name={icon} size={20} />
      <dt className="md-label-medium">{label}</dt>
      <dd className="md-body-medium">{children}</dd>
    </div>
  );
}
