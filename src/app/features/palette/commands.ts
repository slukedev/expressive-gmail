import { rawId } from '../../data/accounts/ids';
import { accountLabel, accountScope, useAccounts } from '../../data/accounts/store';
import { mail, undoableAction, undoLast } from '../../data/actions';
import { backend, findThread, keys, queryClient } from '../../data/client';
import type { Address, Contact, Label, Thread } from '../../data/types';
import { isMe } from '../../lib/format';
import { classicGmail, openUrl } from '../../lib/host';
import { REPO_URL } from '../../../shared/project';
import { describeTime, presetTime, reminderPresets, snoozePresets } from '../../lib/presets';
import type { View } from '../../router/routes';
import { closeThread, getRoute, navigate, openThread } from '../../router/useRoute';
import { local, useLocal } from '../../state/local';
import { updateSettings, type Settings } from '../../state/settings';
import { useUi } from '../../state/ui';
import { labelDotColor } from '../../theme/color';
import { uiScaleAvailable } from '../../theme/uiScale';
import { stepUiScale, UI_SCALES, uiScaleLabel } from '../../../shared/uiScale';
import type { IconName } from '../../ui/Icon';
import { snack } from '../../ui/Snackbar';
import { switchScope } from '../accounts/switch';
import { openNewCircle } from '../accounts/newCircle';
import { delegatedLabel } from '../accounts/Delegated';
import { newCompose, replyToThread } from '../compose/open';
import { getListFilters, LIST_FILTERS, viewKeyOf } from '../list/filters';
import { pauseActive, pauseInbox, pausePresets, resumeInbox } from '../pause/pause';
import { aside, isAside, useAside, visibleItems } from '../replylater/store';
import { filterLikeThese } from '../thread/filterLike';
import { printThread } from '../thread/print';
import { unsubscribe } from '../thread/UnsubscribeButton';
import type { Context, Target } from './context';
import { threadLink } from './links';
import type { After, Item, PageId, PageRef } from './types';
import { parseWhen, type WhenOptions } from './when';
import { pickWallpaperFile } from '../wallpaper/actions';
import { editCurrentPicture } from '../wallpaper/editor';
import { applyPictureColors, hasPicture } from '../wallpaper/colors';
import { geminiAvailable, geminiOn, type GeminiFeature, type GeminiStatus } from '../../data/gemini';
import { useGeminiPanel } from '../gemini/panel';
import { geminiKeys } from '../gemini/useGemini';
import { getAppHost, installApp } from '../../lib/appHost';

export interface Env {
  dark: boolean;
  /** It outlives the palette. */
  pick: (kind: 'snooze' | 'remind', ids: string[]) => void;
  whenOptions: WhenOptions;
}

const go = (view: View) => () => navigate({ view });
const CONTEXT = 'context';

/** For "Block Priya". */
function firstName(a: Address) {
  return (a.name?.trim().split(/\s+/)[0] || a.email).replace(/^["']|["']$/g, '');
}

/** From the list's view of the thread. */
function otherSender(target: Target, me: string[]): Address | undefined {
  const t = target.threads[0];
  return t ? [...t.participants].reverse().find((p) => !isMe(p.email, me)) : undefined;
}

async function fullThread(id: string): Promise<Thread> {
  return queryClient.fetchQuery<Thread>({ queryKey: keys.thread(id), queryFn: () => backend().getThread(id) });
}

function copy(text: string, done: string) {
  void navigator.clipboard.writeText(text).then(
    () => snack(done),
    () => snack("Couldn't copy. Your browser blocked the clipboard."),
  );
}

const BULK = ['CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];

// Actions on the target

export function contextItems(ctx: Context, env: Env): Item[] {
  const target = ctx.target;
  if (!target) return [];
  const { ids, threads, name } = target;
  const one = ids.length === 1;
  const group = target.heading;
  const every = (l: string) => threads.length > 0 && threads.every((t) => t.labelIds.includes(l));
  const some = (l: string) => threads.some((t) => t.labelIds.includes(l));
  const out: Item[] = [];
  const add = (item: Omit<Item, 'group'>) => out.push({ group, boost: 8, ...item, id: `${CONTEXT}:${item.id}` });

  if (one && target.source !== 'open') {
    add({ id: 'open', title: `Open ${name}`, icon: 'mail', shortcut: 'o', run: () => openThread(ids[0]!, getRoute().view) });
  }
  if (every('TRASH')) add({ id: 'restore', title: `Restore ${name}`, icon: 'restore_from_trash', keywords: 'untrash undelete back', run: () => void mail.untrash(ids) });
  else if (every('SPAM')) add({ id: 'not-spam', title: `Not spam: ${name}`, icon: 'report', keywords: 'inbox', run: () => void mail.notSpam(ids) });
  else if (some('INBOX')) add({ id: 'archive', title: `Archive ${name}`, icon: 'archive', shortcut: 'e', keywords: 'done remove from inbox', run: () => void mail.archive(ids) });
  else add({ id: 'to-inbox', title: `Move ${name} to Inbox`, icon: 'move_to_inbox', keywords: 'unarchive', run: () => void mail.moveToInbox(ids) });

  if (every('TRASH')) {
    if (ctx.caps.deleteForever) add({ id: 'delete-forever', title: `Delete ${name} forever`, icon: 'delete_forever', keywords: 'permanently remove', run: () => void mail.deleteForever(ids) });
  } else add({ id: 'delete', title: `Delete ${name}`, icon: 'delete', shortcut: '#', keywords: 'trash bin remove', run: () => void mail.trash(ids) });

  if (every('SNOOZED')) add({ id: 'unsnooze', title: `Unsnooze ${name}`, icon: 'alarm_on', keywords: 'wake back to inbox', run: () => void mail.unsnooze(ids) });
  else add({ id: 'snooze', title: `Snooze ${name}`, icon: 'schedule', shortcut: 'b', keywords: 'later remind defer tomorrow', page: { id: 'snooze', title: 'Snooze' } });
  if (one && every('SCHEDULED')) {
    add({ id: 'cancel-send', title: `Cancel send: ${name}`, icon: 'cancel_schedule_send', keywords: 'scheduled unschedule draft', run: () => void mail.cancelScheduled(ids[0]!) });
  }

  if (ctx.caps.send && one) {
    add({ id: 'reply', title: `Reply to ${name}`, icon: 'reply', shortcut: 'r', keywords: 'respond answer', run: () => void replyToThread(ids[0]!, 'reply') });
    add({ id: 'reply-all', title: `Reply all to ${name}`, icon: 'reply_all', shortcut: 'a', keywords: 'respond everyone', run: () => void replyToThread(ids[0]!, 'reply-all') });
    add({ id: 'forward', title: `Forward ${name}`, icon: 'forward', shortcut: 'f', keywords: 'send on share', run: () => void replyToThread(ids[0]!, 'forward') });
  }

  add({ id: 'label', title: `Label ${name} as…`, icon: 'label', shortcut: 'l', keywords: 'tag add label', page: { id: 'label', title: 'Label as' } });
  add({ id: 'move', title: `Move ${name} to…`, icon: 'drive_file_move', shortcut: 'v', keywords: 'folder file', page: { id: 'move', title: 'Move to' } });
  const userLabels = new Set(ctx.labels.filter((l) => l.type === 'user').map((l) => l.id));
  if (threads.some((t) => t.labelIds.some((l) => userLabels.has(l)))) {
    add({ id: 'unlabel', title: `Remove a label from ${name}`, icon: 'label_off', keywords: 'unlabel untag', page: { id: 'unlabel', title: 'Remove label' } });
  }

  const unread = every('UNREAD');
  add({
    id: unread ? 'read' : 'unread',
    title: unread ? `Mark ${name} as read` : `Mark ${name} as unread`,
    icon: unread ? 'mark_email_read' : 'mark_email_unread',
    shortcut: unread ? 'Shift I' : 'Shift U',
    keywords: 'seen new',
    run: () => {
      void mail.markRead(ids, unread);
      if (!unread && target.source === 'open') closeThread();
    },
  });
  const starred = every('STARRED');
  add({ id: starred ? 'unstar' : 'star', title: starred ? `Remove star from ${name}` : `Star ${name}`, icon: 'star', shortcut: 's', keywords: 'favorite flag', run: () => void mail.star(ids, !starred) });
  const important = every('IMPORTANT');
  add({
    id: important ? 'not-important' : 'important',
    title: important ? `Mark ${name} as not important` : `Mark ${name} as important`,
    icon: 'label_important',
    shortcut: important ? '-' : '+',
    keywords: 'priority',
    run: () => void mail.important(ids, !important),
  });
  if (ctx.caps.mute) add({ id: 'mute', title: `Mute ${name}`, icon: 'notifications_off', shortcut: 'm', keywords: 'ignore silence', run: () => void mail.mute(ids) });
  if (!every('SPAM')) add({ id: 'spam', title: `Report ${name} as spam`, icon: 'report', shortcut: '!', keywords: 'junk', run: () => void mail.spam(ids) });

  const pinned = useLocal.getState().pinned;
  const allPinned = ids.every((id) => pinned.includes(rawId(id)));
  add({
    id: allPinned ? 'unpin' : 'pin',
    title: allPinned ? `Unpin ${name}` : `Pin ${name} to the top`,
    icon: 'keep',
    shortcut: 'p',
    keywords: 'stick keep top',
    run: () => ids.forEach((id) => (pinned.includes(rawId(id)) === allPinned ? local.togglePin(id) : undefined)),
  });

  if (threads.length) {
    const items = useAside.getState().items;
    const allAside = threads.every((t) => isAside(items, t.id));
    add({
      id: allAside ? 'reply-later-off' : 'reply-later',
      title: allAside ? `Take ${name} off Reply later` : `Reply later to ${name}`,
      icon: 'pending_actions',
      shortcut: 'Shift L',
      keywords: 'set aside stack hey later',
      run: () => {
        if (allAside) threads.forEach((t) => aside.done(t.id));
        else aside.addMany(threads);
        useUi.getState().clearSelection();
      },
    });
  }

  if (one) {
    const reminder = useLocal.getState().reminders.find((r) => r.threadId === rawId(ids[0]!));
    add({
      id: 'remind',
      title: reminder ? `Follow-up on ${name}: ${describeTime(reminder.due)}` : `Remind me if nobody replies to ${name}`,
      icon: reminder ? 'notifications_active' : 'alarm_add',
      keywords: 'follow up nudge reminder',
      page: { id: 'remind', title: 'Remind me' },
    });
    const sender = otherSender(target, ctx.me);
    if (sender) {
      const blocked = useLocal.getState().blocked.includes(sender.email.toLowerCase());
      add({
        id: blocked ? 'unblock' : 'block',
        title: blocked ? `Unblock ${firstName(sender)}` : `Block ${firstName(sender)}`,
        meta: sender.email,
        icon: 'block',
        keywords: 'sender spam stop',
        run: () => {
          if (blocked) {
            local.unblock(sender.email);
            snack(`${firstName(sender)} is unblocked`);
          } else {
            local.block(sender.email);
            snack(`Blocked ${sender.email}`, { action: { label: 'Undo', onClick: () => local.unblock(sender.email) } });
          }
        },
      });
      add({ id: 'filter-like', title: `Filter messages like ${name}`, meta: `From ${sender.email}`, icon: 'filter_alt', keywords: 'rule create filter sender', run: () => filterLikeThese(sender.email) });
      if (threads[0]?.labelIds.some((l) => BULK.includes(l))) {
        add({
          id: 'unsubscribe',
          title: `Unsubscribe from ${firstName(sender)}`,
          meta: sender.email,
          icon: 'unsubscribe',
          keywords: 'newsletter list stop emails',
          run: () =>
            void fullThread(ids[0]!)
              .then((t) => {
                const m = [...t.messages].reverse().find((x) => !x.isDraft && !isMe(x.from.email, ctx.me));
                if (m) void unsubscribe(m);
              })
              .catch(() => snack("Couldn't load the conversation. Try again.")),
        });
      }
    }
    add({
      id: 'print',
      title: `Print ${name}`,
      icon: 'print',
      keywords: 'paper pdf',
      run: () =>
        void fullThread(ids[0]!)
          .then((t) => printThread(t, ctx.me[0]))
          .catch(() => snack("Couldn't load the conversation to print. Try again.")),
    });
    const link = threadLink(ids[0]!);
    if (link) {
      add({ id: 'new-tab', title: `Open ${name} in a new tab`, icon: 'open_in_new', keywords: 'window browser', run: () => openUrl(link) });
      add({ id: 'copy-link', title: `Copy link to ${name}`, icon: 'link', keywords: 'url share clipboard', run: () => copy(link, 'Link copied') });
    }
  }
  if (target.source === 'selection') add({ id: 'deselect', title: 'Clear selection', icon: 'deselect', shortcut: 'Esc', keywords: 'select none unselect', run: () => useUi.getState().clearSelection() });
  if (target.source === 'open') {
    add({ id: 'back', title: 'Back to the list', icon: 'arrow_back', shortcut: 'u', keywords: 'close conversation', run: () => closeThread() });
    add({ id: 'expand', title: 'Expand all messages', icon: 'expand_more', shortcut: ';', keywords: 'open show', run: () => void window.dispatchEvent(new CustomEvent('bg:expand-all', { detail: true })) });
    add({ id: 'collapse', title: 'Collapse all messages', icon: 'expand_less', shortcut: ':', keywords: 'close hide', run: () => void window.dispatchEvent(new CustomEvent('bg:expand-all', { detail: false })) });
    const i = ctx.listIds.indexOf(ids[0]!);
    const older = i >= 0 ? ctx.listIds[i + 1] : undefined;
    const newer = i > 0 ? ctx.listIds[i - 1] : undefined;
    if (older) add({ id: 'older', title: 'Older conversation', icon: 'chevron_right', shortcut: 'j', keywords: 'next', run: () => openThread(older, ctx.route.view) });
    if (newer) add({ id: 'newer', title: 'Newer conversation', icon: 'chevron_left', shortcut: 'k', keywords: 'previous', run: () => openThread(newer, ctx.route.view) });
  }
  void env;
  return out;
}

// Settings: switches that flip in place, and choices that open a short list

interface ToggleDef {
  key: keyof Settings;
  title: string;
  icon: IconName;
  keywords?: string;
}

const TOGGLES: ToggleDef[] = [
  { key: 'showAvatars', title: 'Sender images', icon: 'account_circle', keywords: 'avatars photos pictures' },
  { key: 'showSnippets', title: 'Message previews', icon: 'view_agenda', keywords: 'snippets preview line' },
  { key: 'showLabelChips', title: 'Label tags in the list', icon: 'sell', keywords: 'chips labels rows' },
  { key: 'smartFeatures', title: 'Smart chips and cards', icon: 'bolt', keywords: 'codes packages tracking invites bills' },
  { key: 'groupByDate', title: 'Group by date', icon: 'calendar_today', keywords: 'sections today yesterday' },
  { key: 'glance', title: 'At a glance', icon: 'wb_sunny', keywords: 'greeting worth a look reading pane empty' },
  { key: 'advanceToUnread', title: 'Skip to unread after archiving', icon: 'mark_email_unread', keywords: 'auto-advance next unread classic' },
  { key: 'hoverActions', title: 'Hover actions', icon: 'more_horiz', keywords: 'quick buttons row' },
  { key: 'keyboardShortcuts', title: 'Keyboard shortcuts', icon: 'keyboard', keywords: 'hotkeys keys' },
  { key: 'sendAndArchive', title: 'Send and archive', icon: 'send', keywords: 'reply archive' },
  { key: 'attachmentReminder', title: 'Attachment reminder', icon: 'attach_file', keywords: 'forgot attach' },
  { key: 'blockTrackers', title: 'Block email trackers', icon: 'shield', keywords: 'pixels privacy tracking' },
  { key: 'darkEmails', title: 'Dark emails', icon: 'dark_mode', keywords: 'darken messages night' },
  { key: 'railExpanded', title: 'Expanded navigation', icon: 'menu_open', keywords: 'rail sidebar menu collapse' },
];

interface ChoiceDef {
  key: keyof Settings;
  title: string;
  icon: IconName;
  keywords?: string;
  options: [Settings[keyof Settings], string, IconName?][];
  available?: () => boolean;
}

const CHOICES: ChoiceDef[] = [
  { key: 'themeMode', title: 'Theme', icon: 'dark_mode', keywords: 'dark light mode appearance night', options: [['system', 'System default', 'brightness_auto'], ['light', 'Light', 'light_mode'], ['dark', 'Dark', 'dark_mode']] },
  { key: 'density', title: 'Density', icon: 'density_medium', keywords: 'compact comfortable spacing rows', options: [['default', 'Default', 'density_medium'], ['comfortable', 'Comfortable', 'density_large'], ['compact', 'Compact', 'density_small']] },
  { key: 'uiScale', title: 'Interface size', icon: 'format_size', keywords: 'zoom scale bigger smaller larger text', options: UI_SCALES.map((v) => [v, uiScaleLabel(v)]), available: uiScaleAvailable },
  { key: 'readingPane', title: 'Reading pane', icon: 'vertical_split', keywords: 'split preview layout right', options: [['auto', 'Automatic', 'vertical_split'], ['right', 'Right of the list', 'splitscreen_right'], ['none', 'No split', 'view_agenda']] },
  { key: 'inboxType', title: 'Inbox type', icon: 'inbox_customize', keywords: 'categories sort priority unread first', options: [['categories', 'Categories'], ['everything', 'Everything'], ['unread-first', 'Unread first'], ['important-first', 'Important first'], ['starred-first', 'Starred first']] },
  { key: 'undoSendSeconds', title: 'Undo send', icon: 'undo', keywords: 'unsend recall cancel seconds', options: [[0, 'Off'], [5, '5 seconds'], [10, '10 seconds'], [20, '20 seconds'], [30, '30 seconds']] },
  { key: 'defaultReply', title: 'Default reply', icon: 'reply_all', keywords: 'reply all', options: [['reply', 'Reply', 'reply'], ['reply-all', 'Reply all', 'reply_all']] },
  { key: 'afterAction', title: 'After archiving or deleting', icon: 'arrow_forward', keywords: 'advance next older newer', options: [['auto', 'Automatic'], ['older', 'Go to the older conversation'], ['newer', 'Go to the newer conversation'], ['list', 'Go back to the list']] },
  { key: 'externalImages', title: 'Images from senders', icon: 'image', keywords: 'pictures remote external', options: [['always', 'Always show'], ['ask', 'Ask first']] },
  { key: 'pageSize', title: 'Conversations per page', icon: 'view_list', keywords: 'page size load', options: [[25, '25'], [50, '50'], [100, '100']] },
  { key: 'appBadge', title: 'Icon badge', icon: 'notifications_active', keywords: 'app badge unread count dot dock taskbar', options: [['count', 'Unread count'], ['dot', 'Dot'], ['off', 'Off']], available: () => getAppHost().badge },
  { key: 'accountMarker', title: 'Account marker', icon: 'all_inbox', keywords: 'badge dot chip all inboxes', options: [['badge', 'Badge on the photo'], ['dot', 'Dot'], ['chip', 'Chip'], ['off', 'None']] },
];

export function settingItems(s: Settings): Item[] {
  const out: Item[] = TOGGLES.map((t) => {
    const on = !!s[t.key];
    return {
      id: `setting:${t.key}`,
      title: t.title,
      group: 'Settings',
      icon: t.icon,
      keywords: `setting turn on off toggle ${t.keywords ?? ''}`,
      toggle: on,
      run: (): After => {
        updateSettings({ [t.key]: !on } as Partial<Settings>);
        return 'stay';
      },
      alt: { label: on ? 'Turn off and close' : 'Turn on and close', run: () => updateSettings({ [t.key]: !on } as Partial<Settings>) },
    };
  });
  // Only where Gmail offers it: a switch that can't turn anything on isn't offered.
  const geminiStatus = queryClient.getQueryData<GeminiStatus>(geminiKeys.status);
  if (geminiAvailable(geminiStatus)) {
    const on = geminiOn(s.geminiChoice, geminiStatus);
    out.splice(TOGGLES.findIndex((t) => t.key === 'smartFeatures') + 1, 0, {
      id: 'setting:gemini',
      title: 'Gemini',
      group: 'Settings',
      icon: 'forum',
      keywords: 'setting turn on off toggle ai assistant summaries help me write suggested replies disable hide',
      toggle: on,
      run: (): After => {
        updateSettings({ geminiChoice: !on });
        return 'stay';
      },
      alt: { label: on ? 'Turn off and close' : 'Turn on and close', run: () => updateSettings({ geminiChoice: !on }) },
    });
  }
  out.push({
    id: 'setting:categories',
    title: 'Sort into categories',
    group: 'Settings',
    icon: 'category',
    keywords: 'setting tabs promotions social updates',
    toggle: s.inboxType === 'categories',
    run: (): After => {
      updateSettings({ inboxType: s.inboxType === 'categories' ? 'everything' : 'categories' });
      return 'stay';
    },
  });
  out.push({
    id: 'setting:picture',
    title: hasPicture() ? 'Change picture…' : 'Add a picture…',
    group: 'Settings',
    icon: 'add_photo_alternate',
    keywords: 'setting picture photo image upload at a glance profile',
    run: () => void pickWallpaperFile(),
  });
  if (hasPicture())
    out.push({
      id: 'setting:picture-edit',
      title: 'Crop and shape picture…',
      group: 'Settings',
      icon: 'crop',
      keywords: 'setting picture photo crop zoom shape cookie circle at a glance profile',
      run: () => void editCurrentPicture(),
    });
  if (hasPicture())
    out.push({
      id: 'setting:picture-colors',
      title: 'Use colors from this picture',
      group: 'Settings',
      icon: 'palette',
      keywords: 'setting picture photo theme material you colors profile',
      run: () => void applyPictureColors(),
    });
  if (uiScaleAvailable()) {
    const sizes: [string, string, IconName, 1 | -1][] = [
      ['smaller', 'Smaller interface', 'zoom_out', -1],
      ['larger', 'Larger interface', 'zoom_in', 1],
    ];
    for (const [id, title, icon, by] of sizes) {
      const next = stepUiScale(s.uiScale, by);
      if (next === s.uiScale) continue;
      out.push({
        id: `setting:ui-${id}`,
        title,
        meta: uiScaleLabel(s.uiScale),
        group: 'Settings',
        icon,
        keywords: 'setting zoom scale interface size text',
        run: () => updateSettings({ uiScale: next }),
      });
    }
  }
  if (getAppHost().installable && !getAppHost().standalone)
    out.push({
      id: 'setting:install-app',
      title: 'Install app',
      group: 'Settings',
      icon: 'install_desktop',
      keywords: 'setting pwa install app window desktop dock taskbar launcher',
      run: () =>
        void installApp().then((outcome) => {
          if (outcome === 'unavailable') snack('Install it from your browser’s menu instead.');
        }),
    });
  for (const c of CHOICES) {
    if (c.available && !c.available()) continue;
    const current = c.options.find(([v]) => v === s[c.key]);
    out.push({
      id: `choice:${c.key}`,
      title: `${c.title}…`,
      meta: current?.[1],
      group: 'Settings',
      icon: c.icon,
      keywords: `setting change ${c.keywords ?? ''}`,
      page: { id: `choice:${c.key}`, title: c.title },
    });
  }
  return out;
}

function choiceItems(key: string, s: Settings): Item[] {
  const c = CHOICES.find((x) => x.key === key);
  if (!c) return [];
  return c.options.map(([value, label, icon]) => ({
    id: `choice:${key}:${String(value)}`,
    title: label,
    group: c.title,
    icon: icon ?? c.icon,
    current: s[c.key] === value,
    run: () => updateSettings({ [c.key]: value } as Partial<Settings>),
  }));
}

// Places, accounts and everything else

const FOLDERS: [View, string, IconName, string?, string?][] = [
  [{ kind: 'folder', folder: 'inbox' }, 'Inbox', 'inbox', 'g i'],
  [{ kind: 'folder', folder: 'starred' }, 'Starred', 'star', 'g s'],
  [{ kind: 'folder', folder: 'snoozed' }, 'Snoozed', 'schedule', 'g b'],
  [{ kind: 'folder', folder: 'imp' }, 'Important', 'label_important'],
  [{ kind: 'folder', folder: 'sent' }, 'Sent', 'send', 'g t'],
  [{ kind: 'folder', folder: 'scheduled' }, 'Scheduled', 'schedule_send'],
  [{ kind: 'folder', folder: 'drafts' }, 'Drafts', 'draft', 'g d'],
  [{ kind: 'folder', folder: 'all' }, 'All mail', 'stacks', 'g a', 'archive archived everything'],
  [{ kind: 'folder', folder: 'spam' }, 'Spam', 'report', undefined, 'junk'],
  [{ kind: 'folder', folder: 'trash' }, 'Trash', 'delete', undefined, 'bin deleted'],
  [{ kind: 'category', category: 'promotions' }, 'Promotions', 'sell'],
  [{ kind: 'category', category: 'social' }, 'Social', 'group'],
  [{ kind: 'category', category: 'updates' }, 'Updates', 'info'],
  [{ kind: 'category', category: 'forums' }, 'Forums', 'forum'],
  [{ kind: 'reminders' }, 'Follow-ups', 'alarm', 'g k', 'reminders nudges waiting reply'],
  [{ kind: 'purchases' }, 'Purchases', 'shopping_bag', undefined, 'orders packages receipts bills tracking deliveries'],
  [{ kind: 'subscriptions' }, 'Subscriptions', 'unsubscribe', undefined, 'newsletters unsubscribe cleanup senders'],
  [{ kind: 'attachments' }, 'Attachments', 'attach_file', undefined, 'files photos documents gallery'],
  [{ kind: 'storage' }, 'Free up space', 'cloud', undefined, 'storage quota full large big attachments files clean up delete'],
];

/** Cmd+Enter on Spam, Trash or a label. */
function moveHere(ctx: Context, view: View): Item['alt'] {
  const t = ctx.target;
  if (!t) return undefined;
  if (view.kind === 'folder' && view.folder === 'inbox') return { label: 'Move here', run: () => void mail.moveToInbox(t.ids) };
  if (view.kind === 'folder' && view.folder === 'spam') return { label: 'Move here', run: () => void mail.spam(t.ids) };
  if (view.kind === 'folder' && view.folder === 'trash') return { label: 'Move here', run: () => void mail.trash(t.ids) };
  return undefined;
}

export function goItems(ctx: Context): Item[] {
  return FOLDERS.map(([view, title, icon, shortcut, keywords]) => ({
    id: `go:${title}`,
    title,
    group: 'Go to',
    icon,
    shortcut,
    keywords: `go open folder ${keywords ?? ''}`,
    run: go(view),
    alt: moveHere(ctx, view),
  }));
}

function labelColor(l: Label, dark: boolean) {
  return l.color ? labelDotColor(l.color.background, dark) : undefined;
}

function userLabels(ctx: Context): Label[] {
  return ctx.labels
    .filter((l) => l.type === 'user' && !l.name.startsWith('['))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function labelGoItems(ctx: Context, env: Env): Item[] {
  return userLabels(ctx).map((l) => ({
    id: `go:label:${l.name}`,
    title: l.name,
    group: 'Labels',
    icon: 'label' as const,
    iconColor: labelColor(l, env.dark),
    meta: l.unreadCount ? `${l.unreadCount.toLocaleString()} unread` : undefined,
    keywords: 'label go',
    run: go({ kind: 'label', label: l.name }),
    alt: ctx.target ? { label: 'Move here', run: () => void mail.moveTo(ctx.target!.ids, l.id, l.name) } : undefined,
  }));
}

export function actionItems(ctx: Context, env: Env, s: Settings): Item[] {
  const ui = useUi.getState();
  const out: Item[] = [];
  const add = (item: Omit<Item, 'group'> & { group?: string }) => out.push({ group: 'Actions', ...item });
  if (ctx.caps.send) add({ id: 'compose', title: 'Compose a new message', icon: 'edit', shortcut: 'c', keywords: 'write new email send', run: () => void newCompose() });
  if (ctx.caps.send) add({ id: 'write-to', title: 'Write to…', icon: 'person', keywords: 'compose email someone contact to', page: { id: 'write', title: 'Write to' } });
  add({ id: 'search', title: 'Search mail', icon: 'search', shortcut: '/', keywords: 'find', run: () => void window.dispatchEvent(new Event('bg:focus-search')) });
  add({ id: 'search-options', title: 'Search options', icon: 'manage_search', keywords: 'advanced search from to subject date size', run: () => void window.dispatchEvent(new CustomEvent('bg:advanced-search', { detail: '' })) });
  const undo = undoableAction();
  add({ id: 'undo', title: undo ? `Undo: ${undo}` : 'Undo last action', icon: 'undo', shortcut: 'z', keywords: 'revert take back undo', run: undoLast });
  add({ id: 'refresh', title: 'Refresh', icon: 'refresh', shortcut: 'Shift N', keywords: 'reload sync check new mail', run: () => void queryClient.invalidateQueries({ queryKey: keys.allThreads }) });
  if (ctx.listIds.length) {
    add({ id: 'select-all', title: 'Select all conversations', icon: 'select_all', shortcut: '* a', keywords: 'select every', run: () => ui.setSelected(new Set(ctx.listIds)) });
    add({ id: 'select-unread', title: 'Select unread conversations', icon: 'mark_email_unread', shortcut: '* u', keywords: 'select', run: () => ui.setSelected(new Set(ctx.listIds.filter((id) => !!findThread(id)?.labelIds.includes('UNREAD')))) });
  }
  if (visibleItems(useAside.getState().items).length) {
    add({ id: 'aside-start', title: 'Work through Reply later', icon: 'pending_actions', shortcut: 'g r', keywords: 'set aside reply stack start', run: aside.start });
  }
  const gemini = queryClient.getQueryData<GeminiStatus>(geminiKeys.status);
  const offers = (f: GeminiFeature) => geminiOn(s.geminiChoice, gemini) && !!gemini?.ready && gemini.features.includes(f);
  if (offers('chat')) {
    add({ id: 'gemini', title: 'Ask Gemini', icon: 'forum', keywords: 'ai assistant chat question side panel', run: () => useGeminiPanel.getState().show() });
    if (ctx.route.threadId) {
      const threadId = ctx.route.threadId;
      add({ id: 'gemini-summarize', title: 'Summarize this conversation', icon: 'notes', keywords: 'gemini ai summary tldr recap', run: () => useGeminiPanel.getState().show({ useThread: true, ask: { text: 'Summarize this email', threadId } }) });
    }
  }
  if (offers('inbox')) out.push({ id: 'go:ai-inbox', title: 'AI Inbox', group: 'Go to', icon: 'checklist', keywords: 'gemini to-dos todo topics catch up briefing', run: go({ kind: 'ai-inbox' }) });
  if (pauseActive(s.inboxPause)) add({ id: 'resume', title: 'Resume inbox', icon: 'play_arrow', keywords: 'unpause pause focus', run: resumeInbox });
  else add({ id: 'pause', title: 'Pause inbox…', icon: 'pause', keywords: 'focus do not disturb hold new mail', page: { id: 'pause', title: 'Pause inbox' } });
  for (const f of LIST_FILTERS) {
    const on = getListFilters(ctx.route.view);
    const has = on.includes(f.id);
    add({
      id: `filter:${f.id}`,
      title: has ? `Stop showing only ${f.label.toLowerCase()}` : `Show only ${f.label.toLowerCase()}`,
      icon: f.icon,
      keywords: 'filter only list',
      run: () => ui.setListFilters(has ? on.filter((x) => x !== f.id) : [...on, f.id], viewKeyOf(ctx.route.view)),
    });
  }
  for (const sp of s.splits) {
    out.push({ id: `go:split:${sp.id}`, title: sp.name, group: 'Go to', icon: 'filter_alt', keywords: `split ${sp.query}`, run: go({ kind: 'split', id: sp.id }) });
  }

  const { accounts, scope, delegated } = useAccounts.getState();
  if (accounts.length > 1) {
    if (scope !== 'all') out.push({ id: 'scope:all', title: 'Open All inboxes', group: 'Accounts', icon: 'all_inbox', shortcut: 'g 0', keywords: 'unified merged every account combined switch', run: () => void switchScope('all') });
    for (const c of s.circles) {
      if (scope !== `circle:${c.id}`) out.push({ id: `scope:${c.id}`, title: `Open the ${c.name} circle`, group: 'Accounts', icon: 'join', keywords: 'circle group accounts switch', run: () => void switchScope(`circle:${c.id}`) });
    }
    accounts.forEach((a, i) => {
      const to = accountScope(a.email);
      if (scope === to) return;
      const label = accountLabel(a, s);
      out.push({
        id: `scope:${a.email}`,
        title: `Switch to ${label}`,
        group: 'Accounts',
        icon: 'account_circle',
        avatar: { name: a.name, email: a.email },
        meta: label === a.email ? undefined : a.email,
        shortcut: i < 9 ? `g ${i + 1}` : undefined,
        keywords: `account switch ${a.email} ${a.name ?? ''}`,
        run: () => void switchScope(to),
      });
    });
    out.push({ id: 'new-circle', title: 'New circle', group: 'Accounts', icon: 'join', keywords: 'group accounts create', run: () => openNewCircle() });
  }
  for (const d of delegated) {
    const label = delegatedLabel(d);
    out.push({
      id: `delegated:${d.email}`,
      title: `Open ${label}`,
      group: 'Accounts',
      icon: 'open_in_new',
      avatar: { name: d.name, email: d.email },
      meta: label === d.email ? 'Delegated' : d.email,
      keywords: `delegated delegate shared mailbox account ${d.email} ${d.name ?? ''}`,
      run: () => openUrl(d.url),
    });
  }

  // Templates go into the open compose window.
  if (ctx.composing) {
    for (const t of s.templates) {
      out.push({ id: `template:${t.id}`, title: `Insert ${t.name}`, group: 'Templates', icon: 'text_snippet', meta: t.subject, keywords: `template snippet insert ${t.shortcut}`, run: () => void insertTemplate(t.html, t.subject) });
    }
  }

  const more: Omit<Item, 'group'>[] = [
    { id: 'quick-settings', title: 'Quick settings', icon: 'tune', keywords: 'appearance theme density', run: () => ui.set({ quickSettings: true }) },
    { id: 'settings', title: 'All settings', icon: 'settings', keywords: 'preferences options', run: () => ui.set({ settingsSection: 'general' }) },
    ...(ctx.caps.labelsEdit ? [{ id: 'settings:labels', title: 'Manage labels', icon: 'label' as const, keywords: 'settings labels edit colors', run: () => ui.set({ settingsSection: 'labels' }) }] : []),
    { id: 'settings:sidebar', title: 'Customize sidebar', icon: 'side_navigation', keywords: 'settings sidebar menu rail reorder hide folders more', run: () => ui.set({ settingsSection: 'sidebar' }) },
    { id: 'settings:splits', title: 'Manage splits', icon: 'filter_alt', keywords: 'settings splits', run: () => ui.set({ settingsSection: 'splits' }) },
    { id: 'settings:templates', title: 'Manage templates', icon: 'text_snippet', keywords: 'settings templates canned responses', run: () => ui.set({ settingsSection: 'templates' }) },
    { id: 'settings:accounts', title: 'Manage accounts', icon: 'manage_accounts', keywords: 'settings accounts circles', run: () => ui.set({ settingsSection: 'accounts' }) },
    { id: 'settings:connection', title: 'Connection settings', icon: 'sync', keywords: `settings backend session api${import.meta.env.DEV ? ' demo' : ''}`, run: () => ui.set({ settingsSection: 'connection' }) },
    { id: 'all-settings', title: 'Find a setting…', icon: 'toggle_on', keywords: 'settings switches toggles preferences', page: { id: 'setting', title: 'Settings' } },
    { id: 'shortcuts', title: 'Keyboard shortcuts', icon: 'keyboard', shortcut: '?', keywords: 'help keys hotkeys', page: { id: 'help', title: 'Shortcuts' } },
    { id: 'repo', title: 'Expressive Gmail on GitHub', icon: 'code', keywords: 'source code repository open source issues bug report contribute', run: () => openUrl(REPO_URL) },
    { id: 'classic', title: 'Switch to classic Gmail', icon: 'swap_horiz', keywords: 'old original', run: classicGmail },
  ];
  for (const m of more) out.push({ group: 'Settings', ...m });
  void env;
  return out;
}

/** Where the caret was in the compose window, as the Templates menu does. */
let lastEditor: { el: HTMLElement; range: Range | null } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('focusout', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el?.classList?.contains('editor__content')) return;
    const sel = window.getSelection();
    lastEditor = { el, range: sel && sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null };
  });
}

function insertTemplate(html: string, subject?: string) {
  const el = lastEditor?.el.isConnected ? lastEditor.el : document.querySelector<HTMLElement>('.compose .editor__content, .editor__content');
  if (!el) return snack('Open a message to insert a template into');
  window.setTimeout(() => {
    el.focus();
    const sel = window.getSelection();
    if (sel && lastEditor?.el === el && lastEditor.range) {
      sel.removeAllRanges();
      sel.addRange(lastEditor.range);
    }
    document.execCommand('insertHTML', false, html);
    if (subject) {
      const ui = useUi.getState();
      const draft = [...ui.composes].reverse().find((c) => c.window !== 'minimized');
      if (draft && !draft.subject) ui.updateCompose(draft.key, { subject });
    }
  }, 0);
}

// Pages

export interface PageInput {
  query: string;
  contacts: Contact[];
}

/** Names what the rows act on. */
function heading(kind: 'snooze' | 'remind' | 'pause' | 'label' | 'move' | 'unlabel', t: Target | null): string {
  const name = t?.name ?? '';
  switch (kind) {
    case 'snooze':
      return `Snooze ${name} until`;
    case 'remind':
      return `Remind me if nobody replies to ${name}`;
    case 'pause':
      return 'Pause inbox';
    case 'label':
      return `Label ${name} as`;
    case 'move':
      return `Move ${name} to`;
    case 'unlabel':
      return `Remove a label from ${name}`;
  }
}

function whenRow(kind: 'snooze' | 'remind' | 'pause', query: string, ctx: Context, env: Env, act: (at: number) => void): Item | null {
  const when = parseWhen(query, ctx.now, { ...env.whenOptions, defaultHour: kind === 'remind' ? 9 : 8 });
  if (!when) return null;
  const verb = kind === 'snooze' ? 'Snooze until' : kind === 'remind' ? 'Remind me' : 'Pause until';
  return {
    id: `${kind}:typed`,
    title: `${verb} ${describeTime(when.at, ctx.now)}`,
    meta: when.past ? 'That time has already passed' : relative(when.at, ctx.now),
    group: heading(kind, ctx.target),
    icon: 'event',
    pinned: true,
    disabled: when.past,
    ephemeral: true,
    run: () => act(when.at),
  };
}

/** So a misread is obvious. */
function relative(at: number, now: Date): string {
  const mins = Math.round((at - now.getTime()) / 60_000);
  if (mins < 60) return `In ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `In ${hours} hour${hours === 1 ? '' : 's'}`;
  // Days count by the calendar: Saturday afternoon is 3 days from Wednesday, however late it is.
  const midnight = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(at) - midnight(now.getTime())) / 86_400_000);
  if (days < 14) return `In ${days} days`;
  const weeks = Math.round(days / 7);
  if (days < 60) return `In ${weeks} weeks`;
  return `In ${Math.round(days / 30)} months`;
}

function personItems(p: Address, ctx: Context): Item[] {
  const who = firstName(p);
  const group = p.name ? `${p.name}` : p.email;
  const items: Item[] = [];
  if (ctx.caps.send) items.push({ id: 'person:write', title: `Write to ${who}`, meta: p.email, group, icon: 'edit', keywords: 'email compose', ephemeral: true, run: () => void newCompose({ to: [p] }) });
  items.push(
    { id: 'person:with', title: `Conversations with ${who}`, group, icon: 'forum', keywords: 'search mail from to', ephemeral: true, run: () => runSearch(`from:${p.email} OR to:${p.email}`) },
    { id: 'person:from', title: `Mail from ${who}`, group, icon: 'inbox', keywords: 'search sent by', ephemeral: true, run: () => runSearch(`from:${p.email}`) },
    { id: 'person:attachments', title: `Files from ${who}`, group, icon: 'attach_file', keywords: 'attachments documents', ephemeral: true, run: () => runSearch(`from:${p.email} has:attachment`) },
    { id: 'person:copy', title: 'Copy address', meta: p.email, group, icon: 'content_copy', keywords: 'clipboard email', ephemeral: true, run: () => copy(p.email, `Copied ${p.email}`) },
  );
  return items;
}

export function runSearch(query: string) {
  local.addRecentSearch(query);
  navigate({ view: { kind: 'search', query } });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactItems(contacts: Contact[], query: string, ctx: Context, group: string, mode: 'write' | 'person'): Item[] {
  const list: Address[] = contacts.slice(0, 8);
  const typed = query.trim();
  if (EMAIL.test(typed) && !list.some((c) => c.email.toLowerCase() === typed.toLowerCase())) list.unshift({ email: typed });
  return list.map((c) => {
    const person: PageRef = { id: 'person', title: c.name ?? c.email, person: c };
    const write = () => void newCompose({ to: [{ ...(c.name ? { name: c.name } : {}), email: c.email }] });
    return mode === 'write' && ctx.caps.send
      ? { id: `write:${c.email}`, title: c.name ?? c.email, meta: c.name ? c.email : undefined, group, avatar: c, ephemeral: true, run: write, alt: { label: 'Conversations with', run: () => runSearch(`from:${c.email} OR to:${c.email}`) } }
      : { id: `person:${c.email}`, title: c.name ?? c.email, meta: c.name ? c.email : undefined, group, avatar: c, ephemeral: true, page: person, alt: ctx.caps.send ? { label: 'Write to', run: write } : undefined };
  });
}

/** That don't depend on the text typed. */
export function pageItems(page: PageRef, ctx: Context, env: Env, s: Settings): Item[] {
  const t = ctx.target;
  const id: PageId = page.id;
  if (id === 'snooze' && t) {
    const items: Item[] = snoozePresets(ctx.now).map((p) => ({
      id: `snooze:${p.id}`,
      title: p.label,
      meta: presetTime(p.at, ctx.now),
      group: heading('snooze', t),
      icon: 'schedule',
      run: () => void mail.snooze(t.ids, p.at, describeTime(p.at)),
    }));
    items.push({ id: 'snooze:pick', title: 'Pick date and time', group: heading('snooze', t), icon: 'calendar_month', run: () => env.pick('snooze', t.ids) });
    return items;
  }
  if (id === 'remind' && t) {
    const tid = t.ids[0]!;
    const has = useLocal.getState().reminders.some((r) => r.threadId === rawId(tid));
    const items: Item[] = reminderPresets(ctx.now).map((p) => ({
      id: `remind:${p.id}`,
      title: p.label,
      meta: presetTime(p.at, ctx.now),
      group: heading('remind', t),
      icon: 'alarm_add',
      run: () => setReminder(t, p.at),
    }));
    items.push({ id: 'remind:pick', title: 'Pick date and time', group: heading('remind', t), icon: 'calendar_month', run: () => env.pick('remind', t.ids) });
    if (has) items.push({ id: 'remind:remove', title: 'Remove reminder', group: heading('remind', t), icon: 'close', run: () => void (local.setReminder(null, tid), snack('Follow-up reminder removed')) });
    return items;
  }
  if (id === 'pause') {
    return pausePresets(ctx.now).map((p) => ({ id: `pause:${p.id}`, title: p.label, group: heading('pause', t), icon: 'pause', meta: p.until ? presetTime(p.until, ctx.now) : undefined, run: () => pauseInbox(p.until) }));
  }
  if (id === 'label' || id === 'move' || id === 'unlabel') {
    const labels = userLabels(ctx);
    if (!t) {
      return labels.map((l) => ({ id: `go:label:${l.name}`, title: l.name, group: 'Labels', icon: 'label', iconColor: labelColor(l, env.dark), run: go({ kind: 'label', label: l.name }) }));
    }
    if (id === 'move') {
      const system: Item[] = [
        { id: 'move:inbox', title: 'Inbox', group: heading('move', t), icon: 'inbox', run: () => void mail.moveToInbox(t.ids) },
        { id: 'move:spam', title: 'Spam', group: heading('move', t), icon: 'report', run: () => void mail.spam(t.ids) },
        { id: 'move:trash', title: 'Trash', group: heading('move', t), icon: 'delete', keywords: 'delete bin', run: () => void mail.trash(t.ids) },
      ];
      return system.concat(labels.map((l) => ({ id: `move:${l.name}`, title: l.name, group: heading('move', t), icon: 'label', iconColor: labelColor(l, env.dark), run: () => void mail.moveTo(t.ids, l.id, l.name) })));
    }
    const on = (l: Label) => t.threads.length > 0 && t.threads.every((x) => x.labelIds.includes(l.id));
    if (id === 'unlabel') {
      return labels
        .filter((l) => t.threads.some((x) => x.labelIds.includes(l.id)))
        .map((l) => ({ id: `unlabel:${l.name}`, title: l.name, group: heading('unlabel', t), icon: 'label_off', iconColor: labelColor(l, env.dark), run: () => void mail.addLabels(t.ids, [], [l.id], `Label "${l.name}" removed`) }));
    }
    return labels.map((l) => {
      const has = on(l);
      return {
        id: `label:${l.name}`,
        title: l.name,
        group: heading('label', t),
        icon: 'label' as const,
        iconColor: labelColor(l, env.dark),
        current: has,
        meta: has ? 'Already applied. Enter takes it off' : undefined,
        run: () => void (has ? mail.addLabels(t.ids, [], [l.id], `Label "${l.name}" removed`) : mail.addLabels(t.ids, [l.id], [], `Label "${l.name}" added`)),
        alt: { label: 'Move here', run: () => void mail.moveTo(t.ids, l.id, l.name) },
      };
    });
  }
  if (id.startsWith('choice:')) return choiceItems(id.slice('choice:'.length), s);
  if (id === 'setting') return settingItems(s).map((i) => ({ ...i, group: i.toggle === undefined ? 'Options' : 'Switches' }));
  if (id === 'go') return goItems(ctx).concat(labelGoItems(ctx, env));
  if (id === 'switch') return actionItems(ctx, env, s).filter((i) => i.group === 'Accounts');
  if (id === 'template') return actionItems(ctx, env, s).filter((i) => i.group === 'Templates');
  if (id === 'person' && page.person) return personItems(page.person, ctx);
  return [];
}

/** A parsed time, a label to create. */
export function typedItems(page: PageRef, input: PageInput, ctx: Context, env: Env): Item[] {
  const t = ctx.target;
  const q = input.query.trim();
  const out: Item[] = [];
  // A typed time that lands on a preset is that preset; it ranks first instead of showing twice.
  if (page.id === 'snooze' && t && q) {
    const row = whenRow('snooze', q, ctx, env, (at) => void mail.snooze(t.ids, at, describeTime(at)));
    const preset = row && snoozePresets(ctx.now).find((p) => row.title.endsWith(describeTime(p.at, ctx.now)));
    if (row) out.push(preset ? { ...row, id: `snooze:${preset.id}`, title: preset.label, meta: presetTime(preset.at, ctx.now), ephemeral: false } : row);
  }
  if (page.id === 'remind' && t && q) {
    const row = whenRow('remind', q, ctx, env, (at) => setReminder(t, at));
    if (row) out.push(row);
  }
  if (page.id === 'pause' && q) {
    const row = whenRow('pause', q, ctx, env, (at) => pauseInbox(at));
    if (row) out.push(row);
  }
  if ((page.id === 'label' || page.id === 'move') && t && q && ctx.caps.labelsEdit) {
    const fresh = /^new label\s+/i.test(q);
    const name = q.replace(/^new label\s+/i, '').trim();
    const exists = ctx.labels.some((l) => l.name.toLowerCase() === name.toLowerCase());
    if (name && !exists) {
      const move = page.id === 'move';
      out.push({
        id: `${page.id}:create`,
        title: move ? `Move to new label “${name}”` : `Label as new label “${name}”`,
        meta: 'Creates the label',
        group: heading(move ? 'move' : 'label', t),
        icon: 'new_label',
        pinned: fresh,
        ephemeral: true,
        run: () => void createLabelThen(name, (l) => (move ? mail.moveTo(t.ids, l.id, l.name) : mail.addLabels(t.ids, [l.id], [], `Label "${l.name}" added`))),
      });
    }
  }
  if (page.id === 'write' || (page.id === 'person' && !page.person)) {
    out.push(...contactItems(input.contacts, q, ctx, page.id === 'write' ? 'Write to' : 'People', page.id === 'write' ? 'write' : 'person'));
  }
  return out;
}

async function createLabelThen(name: string, then: (l: Label) => Promise<void>) {
  try {
    const label = await backend().createLabel({ name });
    await queryClient.invalidateQueries({ queryKey: keys.labels });
    await then(label);
  } catch (err) {
    snack(err instanceof Error && err.message ? err.message : `Couldn't create “${name}”.`);
  }
}

function setReminder(t: Target, due: number) {
  const id = t.ids[0]!;
  const summary = t.threads[0];
  local.setReminder({ threadId: id, subject: summary?.subject ?? '', due, messageCount: summary?.messageCount ?? 1, createdAt: Date.now() }, id);
  snack(`We'll remind you ${describeTime(due)} if nobody replies`);
}
