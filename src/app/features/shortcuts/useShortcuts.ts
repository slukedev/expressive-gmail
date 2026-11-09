import { useEffect } from 'react';
import { getVisibleThreadIds, mail, undoLast } from '../../data/actions';
import { keys, queryClient, findThread } from '../../data/client';
import { closeThread, getRoute, navigate, openThread } from '../../router/useRoute';
import type { Folder } from '../../router/routes';
import { local } from '../../state/local';
import { useSettingsStore } from '../../state/settings';
import { useUi } from '../../state/ui';
import { newCompose, replyToThread } from '../compose/open';
import { accountScope, useAccounts } from '../../data/accounts/store';
import { switchScope } from '../accounts/switch';
import { aside, isAside, useAside } from '../replylater/store';
import { nextUnread } from './nextUnread';
import { canonicalKey } from './bindings';
import { selectRangeTo, toggleOne } from '../list/select';
import { snack } from '../../ui/Snackbar';
import { focusRow, focusThread, isThreadScroller, scrollThread } from './focus';

const GO: Record<string, Folder> = { i: 'inbox', s: 'starred', b: 'snoozed', t: 'sent', d: 'drafts', a: 'all' };

function editable(el: EventTarget | null) {
  const node = el as HTMLElement | null;
  // A field in a window animating closed (inert) can keep focus for a moment; it isn't being typed in.
  return !!node && !node.closest?.('[inert]') && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName));
}

/** Selection, else the open thread, else the cursor row. */
function targets(): string[] {
  const ui = useUi.getState();
  if (ui.selected.size) return [...ui.selected];
  const route = getRoute();
  if (route.threadId) return [route.threadId];
  const ids = getVisibleThreadIds();
  return ui.cursor >= 0 && ids[ui.cursor] ? [ids[ui.cursor]] : [];
}

/** Like Gmail's u: focus goes back to the thread's row. */
function backToList(threadId: string) {
  closeThread();
  const index = getVisibleThreadIds().indexOf(threadId);
  if (index >= 0) focusRow(index);
}

type Zone = 'list' | 'tabs' | 'rail' | 'thread';

/** Widgets that already use arrow keys for themselves. */
const OWN_ARROWS = '[role="radiogroup"], [role="listbox"], [role="slider"], [role="separator"], [role="menu"], [role="combobox"], [role="tree"], [role="grid"], [role="spinbutton"]';

/** Where arrow keys act: the list, the category tabs above it, the sidebar, or the open conversation. */
function arrowZone(target: EventTarget | null, threadOpen: boolean): Zone | null {
  const el = target instanceof Element ? target : null;
  if (!el || el === document.body || el === document.documentElement) return threadOpen ? 'thread' : 'list';
  if (el.closest(OWN_ARROWS)) return null;
  if (el.closest('.category-tabs')) return 'tabs';
  if (el.closest('.list-pane')) return 'list';
  if (el.closest('nav.rail')) return 'rail';
  // An email's frame passes its keys up from inside the conversation.
  if (el.closest('.detail-pane')) return 'thread';
  return null;
}

const visible = (el: HTMLElement) => el.getClientRects().length > 0 && el.tabIndex >= 0;

/** Up and Down step through the sidebar's destinations; Right goes to the list. */
function railArrow(key: string, from: Element): boolean {
  const rail = from.closest('nav.rail');
  const items = [...(rail?.querySelectorAll<HTMLElement>('.rail-item') ?? [])].filter(visible);
  if (!items.length) return false;
  if (key === 'ArrowRight') {
    if (!getVisibleThreadIds().length) return false;
    focusRow(Math.max(useUi.getState().cursor, 0));
    return true;
  }
  const at = items.indexOf(from.closest<HTMLElement>('.rail-item')!);
  const next =
    key === 'Home' ? 0 : key === 'End' ? items.length - 1 : at < 0 ? 0 : at + (key === 'ArrowDown' ? 1 : -1);
  items[Math.max(0, Math.min(items.length - 1, next))]!.focus();
  return true;
}

/** Narrow lists show the categories as rows above the conversations instead of tabs. */
const bundleRows = () => [...document.querySelectorAll<HTMLElement>('.list-pane .bundles .bundle')].filter(visible);

/** Up past the first conversation reaches the categories: the last category row, or the open category's tab. */
function focusCategories(): boolean {
  const last = bundleRows().at(-1);
  const tab = last ?? document.querySelector<HTMLElement>('.category-tabs [role="tab"][aria-selected="true"]');
  if (!tab?.getClientRects().length) return false;
  tab.focus();
  return true;
}

/** Arrow keys and Home/End. They type nothing, so they work with letter shortcuts turned off. */
function arrowKey(e: KeyboardEvent): boolean {
  const { key } = e;
  if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return false;
  const route = getRoute();
  const zone = arrowZone(e.target, !!route.threadId);
  if (!zone) return false;
  const vertical = key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End';

  if (zone === 'rail') return (vertical || key === 'ArrowRight') && railArrow(key, e.target as Element);

  if (zone === 'tabs') {
    // Left and Right belong to the tabs themselves.
    if (key !== 'ArrowDown' || !getVisibleThreadIds().length) return false;
    focusRow(Math.max(useUi.getState().cursor, 0));
    return true;
  }

  if (!vertical) return false;

  if (zone === 'thread') {
    // A focused conversation scrolls the browser's own way, smooth and with key repeat.
    if (isThreadScroller(document.activeElement)) return false;
    return scrollThread(key);
  }

  const ids = getVisibleThreadIds();
  const bundle = e.target instanceof Element ? e.target.closest<HTMLElement>('.bundles .bundle') : null;
  if (bundle && (key === 'ArrowUp' || key === 'ArrowDown')) {
    const all = bundleRows();
    const next = all[all.indexOf(bundle) + (key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    else if (key === 'ArrowDown' && ids.length) focusRow(0);
    return true;
  }
  if (!ids.length) return key === 'ArrowUp' && focusCategories();
  const row = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-row-index]') : null;
  const ui = useUi.getState();
  const from = row ? Number(row.dataset.rowIndex) : ui.cursor;
  if (key === 'Home') focusRow(0);
  else if (key === 'End') focusRow(ids.length - 1);
  else if (key === 'ArrowDown') focusRow(from < 0 ? 0 : from + 1);
  else if (from <= 0) return focusCategories();
  else focusRow(from - 1);
  return true;
}

export function useShortcuts() {
  useEffect(() => {
    let prefix: 'g' | '*' | null = null;
    let prefixTimer = 0;

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // The palette works everywhere.
      if (mod && e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault();
        useUi.getState().set({ palette: !useUi.getState().palette });
        return;
      }
      const settings = useSettingsStore.getState().settings;
      if (e.defaultPrevented || editable(e.target) || mod || e.altKey) return;
      if (document.querySelector('[role="dialog"][data-open], [role="menu"]')) return;
      if (!e.shiftKey && arrowKey(e)) return e.preventDefault();
      // Enter and Esc type nothing either.
      if (!settings.keyboardShortcuts && e.key !== 'Enter' && e.key !== 'Escape') return;

      const route = getRoute();
      const ui = useUi.getState();

      if (prefix) {
        const key = e.key;
        const p = prefix;
        prefix = null;
        window.clearTimeout(prefixTimer);
        if (p === 'g' && GO[key]) {
          e.preventDefault();
          navigate({ view: { kind: 'folder', folder: GO[key] } });
        } else if (p === 'g' && key === 'r') {
          e.preventDefault();
          if (useAside.getState().items.length) aside.start();
          else snack('Nothing is set aside. Press Shift L on a conversation to reply to it later.');
        } else if (p === 'g' && key === 'k') {
          navigate({ view: { kind: 'reminders' } });
        } else if (p === 'g' && /^[0-9]$/.test(key)) {
          // g 0: All inboxes; g 1-9: your accounts in the switcher's order.
          const { accounts } = useAccounts.getState();
          const n = Number(key);
          if (accounts.length > 1 && n <= accounts.length) {
            e.preventDefault();
            void switchScope(n === 0 ? 'all' : accountScope(accounts[n - 1]!.email));
          }
        } else if (p === '*') {
          const ids = getVisibleThreadIds();
          const pick = (pred: (id: string) => boolean) => ui.setSelected(new Set(ids.filter(pred)));
          const has = (id: string, l: string) => !!findThread(id)?.labelIds.includes(l);
          if (key === 'a') pick(() => true);
          if (key === 'n') ui.clearSelection();
          if (key === 'r') pick((id) => !has(id, 'UNREAD'));
          if (key === 'u') pick((id) => has(id, 'UNREAD'));
          if (key === 's') pick((id) => has(id, 'STARRED'));
          if (key === 't') pick((id) => !has(id, 'STARRED'));
        }
        return;
      }

      // From here on keys are read as Gmail's defaults, so a rebound key runs its action and a key given away does nothing.
      const key = canonicalKey(e.key, settings.shortcutKeys);
      if (key === null) return;
      const t = targets();
      const run = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      switch (key) {
        case 'g':
        case '*':
          prefix = key;
          prefixTimer = window.setTimeout(() => (prefix = null), 1500);
          return;
        case 'c':
          return run(() => newCompose());
        case '/':
          return run(() => window.dispatchEvent(new Event('bg:focus-search')));
        case '?':
          return run(() => ui.set({ shortcutsHelp: true }));
        case 'j':
        case 'k': {
          const ids = getVisibleThreadIds();
          if (route.threadId) {
            const i = ids.indexOf(route.threadId);
            const next = ids[key === 'j' ? i + 1 : i - 1];
            if (next) run(() => openThread(next, route.view));
          } else {
            run(() => focusRow(ui.cursor < 0 ? 0 : ui.cursor + (key === 'j' ? 1 : -1)));
          }
          return;
        }
        case 'o':
        case 'Enter': {
          // A focused row opens itself, and Enter on any control presses that control.
          const onPage = e.target === document.body || e.target === document.documentElement;
          if (route.threadId || (key === 'Enter' ? !onPage : (e.target as Element).closest?.('button, a'))) return;
          const id = getVisibleThreadIds()[Math.max(ui.cursor, 0)];
          if (id)
            run(() => {
              openThread(id, route.view);
              focusThread();
            });
          return;
        }
        case 'u':
        case 'Escape': {
          if (key === 'Escape' && ui.selected.size) return run(() => ui.clearSelection());
          const open = route.threadId;
          if (open) run(() => backToList(open));
          return;
        }
        case 'x':
        case 'X': {
          const id = route.threadId ? undefined : getVisibleThreadIds()[ui.cursor];
          if (id) run(() => (key === 'X' ? selectRangeTo(id) : toggleOne(id)));
          return;
        }
        case 'z':
          return run(() => undoLast());
        case 'J':
        case 'K': {
          const ids = getVisibleThreadIds();
          const dir = key === 'J' ? 1 : -1;
          const from = route.threadId ? ids.indexOf(route.threadId) : ui.cursor;
          const next = nextUnread(ids, from, dir, (id) => !!findThread(id)?.labelIds.includes('UNREAD'));
          if (!next) return run(() => snack(dir === 1 ? 'No unread conversations below this one' : 'No unread conversations above this one'));
          if (route.threadId) return run(() => openThread(next, route.view));
          return run(() => focusRow(ids.indexOf(next)));
        }
        case 'N':
          return run(() => {
            void queryClient.invalidateQueries({ queryKey: keys.allThreads });
            void queryClient.invalidateQueries({ queryKey: keys.labels });
          });
      }

      if (!t.length) return;
      const first = findThread(t[0]);
      switch (key) {
        case 'e':
          return run(() => void mail.archive(t));
        case 'y':
          return run(() => void mail.archive(t));
        case '#':
        case 'Delete':
          return run(() => void mail.trash(t));
        case '!':
          return run(() => void mail.spam(t));
        case 's':
          return run(() => void mail.star(t, !first?.labelIds.includes('STARRED')));
        case 'I':
          return run(() => void mail.markRead(t, true));
        case 'U':
          return run(() => void mail.markRead(t, false));
        case '+':
        case '=':
          return run(() => void mail.important(t, true));
        case '-':
          return run(() => void mail.important(t, false));
        case 'm':
          return run(() => void mail.mute(t));
        case 'L': {
          const threads = t.map((id) => findThread(id)).filter((x) => !!x);
          if (!threads.length) return;
          const items = useAside.getState().items;
          return run(() => {
            if (threads.every((x) => isAside(items, x.id))) threads.forEach((x) => aside.done(x.id));
            else aside.addMany(threads);
            // Set-aside rows leave the inbox; a selection of them would linger invisibly.
            ui.clearSelection();
          });
        }
        case 'p':
          return run(() => t.forEach((id) => local.togglePin(id)));
        case 'r':
        case 'a':
        case 'f':
          if (t.length === 1) run(() => void replyToThread(t[0], key === 'r' ? 'reply' : key === 'a' ? 'reply-all' : 'forward'));
          return;
        case ';':
        case ':':
          if (route.threadId) run(() => window.dispatchEvent(new CustomEvent('bg:expand-all', { detail: key === ';' })));
          return;
        case '[':
        case ']': {
          if (!route.threadId) return;
          const ids = getVisibleThreadIds();
          const i = ids.indexOf(route.threadId);
          const next = ids[key === ']' ? i + 1 : i - 1];
          return run(() => {
            void mail.archive([route.threadId!]);
            if (next) openThread(next, route.view);
          });
        }
        case 'b':
        case 'l':
        case 'v': {
          const label = key === 'b' ? 'Snooze' : key === 'l' ? 'Labels' : 'Move to';
          const btn = document.querySelector<HTMLButtonElement>(
            route.threadId ? `.thread-toolbar [aria-label="${label}"]` : `.selection-bar [aria-label="${label}"]`,
          );
          if (btn) run(() => btn.click());
          return;
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
