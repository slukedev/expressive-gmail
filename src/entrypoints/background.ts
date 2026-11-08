import { handleOAuthMessage, isOAuthMessage, getBackgroundToken } from '../background/oauth';
import { SNOOZE_ALARM, wakeSnoozed } from '../app/data/api';
import { listAccountsWithSlots } from '../session/accounts';
import { photoData } from '../session/account';
import { isThumbnailUrl } from '../session/thumbnails';
import { notificationId, notificationThread } from '../shared/notify';
import { runsApp } from '../shared/takeover';
import { DESKTOP_RULE_ID, desktopRule, isPhone } from '../shared/mobile';

export default defineBackground(() => {
  // Gmail tabs already open stay classic until reloaded, so a fresh install would otherwise show nothing.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (import.meta.env.DEV) return;
    if (reason === 'install') void browser.tabs.create({ url: 'https://mail.google.com/mail/u/0/#inbox' }).catch(() => undefined);
    // The old version's app is gone from open tabs. Popups and delegated mailboxes may hold typing.
    if (reason === 'update') {
      void browser.tabs
        .query({ url: 'https://mail.google.com/mail/*' })
        .then((tabs) => tabs.forEach((t) => t.id !== undefined && runsApp(t.url) && void browser.tabs.reload(t.id).catch(() => undefined)))
        .catch(() => undefined);
    }
  });

  // Safari: last tokens relayed per tab, so Gmail's polling doesn't resend them every second.
  const lastSent = new Map<number, string>();

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const m = message as { type?: string; threadId?: string; title?: string; body?: string; url?: string };
    if (m?.type === 'inject-main') {
      // Safari: its manifest can't declare main-world content scripts.
      const tabId = _sender.tab?.id;
      // A reloaded page starts with no tokens; relay the next ones even if they match the last.
      if (tabId !== undefined) lastSent.delete(tabId);
      if (tabId === undefined || !browser.scripting?.executeScript) {
        sendResponse({ ok: false });
        return false;
      }
      void browser.scripting
        .executeScript({ target: { tabId, frameIds: [_sender.frameId ?? 0] }, world: 'MAIN', files: ['/gmail-main-safari.js'], injectImmediately: true })
        .then(
          () => sendResponse({ ok: true }),
          (err: unknown) => sendResponse({ ok: false, error: String((err as Error)?.message ?? err) }),
        );
      return true;
    }
    if (m?.type === 'photo' && typeof m.url === 'string' && (/^https:\/\/lh\d\.google\.com\//.test(m.url) || isThumbnailUrl(m.url))) {
      // Signed-in-only photos and thumbnails, read here where the extension's host access applies.
      void photoData(m.url, 'include')
        .then((data) => sendResponse({ ok: !!data, data }))
        .catch((err: unknown) => sendResponse({ ok: false, error: String((err as Error)?.message ?? err) }));
      return true;
    }
    if (m?.type === 'bimi' && typeof (m as { domain?: unknown }).domain === 'string') {
      const domain = (m as { domain: string }).domain;
      const selector = (m as { selector?: unknown }).selector;
      const name = typeof selector === 'string' && /^[a-z0-9_-]{1,63}$/i.test(selector) ? selector : 'default';
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
        sendResponse({ ok: false });
        return false;
      }
      void fetch(`https://dns.google/resolve?name=${name}._bimi.${domain}&type=TXT`, { credentials: 'omit' })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((json: { Answer?: { data?: string }[] }) => {
          const records = (json.Answer ?? []).map((a) => String(a.data ?? '').replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
          sendResponse({ ok: true, records });
        })
        .catch((err: unknown) => sendResponse({ ok: false, error: String((err as Error)?.message ?? err) }));
      return true;
    }
    if (m?.type === 'list-accounts') {
      // Needs accounts.google.com's cookies, so it runs here.
      void listAccountsWithSlots(fetch.bind(globalThis))
        .then(({ accounts, slots }) => sendResponse({ ok: true, accounts, slots }))
        .catch((err: unknown) => sendResponse({ ok: false, error: String((err as Error)?.message ?? err) }));
      return true;
    }
    if (m?.type === 'reload-gmail-tabs') {
      void browser.tabs
        .query({ url: 'https://mail.google.com/*' })
        .then((tabs) => Promise.all(tabs.map((t) => t.id !== undefined && t.id !== _sender.tab?.id && runsApp(t.url) && browser.tabs.reload(t.id))))
        .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      return true;
    }
    if (m?.type === 'notify' && browser.notifications) {
      void browser.notifications
        .create(notificationId(m.threadId ?? ''), {
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: m.title ?? 'New mail',
          message: m.body ?? '',
        })
        .then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
      return true;
    }
    if (!isOAuthMessage(message)) return false;
    void handleOAuthMessage(message).then(sendResponse);
    return true;
  });

  browser.notifications?.onClicked.addListener((id) => {
    const threadId = notificationThread(id);
    if (!threadId) return;
    void browser.tabs
      .query({ url: 'https://mail.google.com/*' })
      .then(async (tabs) => {
        const open = () => browser.tabs.create({ url: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}` });
        const tab = tabs.filter((t) => runsApp(t.url)).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
        if (!tab?.id) {
          await open();
          return;
        }
        await browser.tabs.update(tab.id, { active: true });
        if (tab.windowId !== undefined) await browser.windows?.update(tab.windowId, { focused: true }).catch(() => undefined);
        await browser.tabs.sendMessage(tab.id, { type: 'open-thread', threadId });
      })
      // A classic-mode tab has no app to open it; focusing it is enough.
      .catch(() => undefined);
    void browser.notifications.clear(id);
  });

  // Safari: read the headers Gmail's sync calls carry, since a main-world hook can't always get past Gmail's CSP there.
  if (import.meta.env.BROWSER === 'safari' && browser.webRequest?.onSendHeaders) {
    browser.tabs.onRemoved.addListener((tabId) => lastSent.delete(tabId));
    // Safari on iOS refuses webRequest listeners from a non-persistent background; the main-world hook covers it there.
    try {
      listenForSyncHeaders();
    } catch {
      // Nothing to undo.
    }
  }
  function listenForSyncHeaders() {
    browser.webRequest.onSendHeaders.addListener(
      (details) => {
        if (details.tabId < 0) return;
        const url = new URL(details.url);
        const match = /^(\/sync(?:\/[^?#]*?)?)\/i\/[a-z]+$/.exec(url.pathname);
        if (!match) return;
        const h = new Map((details.requestHeaders ?? []).map((x) => [x.name.toLowerCase(), x.value ?? '']));
        const tokens = {
          syncPath: match[1],
          hl: url.searchParams.get('hl') ?? undefined,
          xsrf: h.get('x-framework-xsrf-token') || undefined,
          btai: h.get('x-gmail-btai') || undefined,
          btd: h.get('x-google-btd') || undefined,
          storageRequest: h.get('x-gmail-storage-request') || undefined,
        };
        const key = JSON.stringify(tokens);
        if (lastSent.get(details.tabId) === key) return;
        lastSent.set(details.tabId, key);
        // Every frame hears it; each keeps only its own account's (syncPath carries /u/N).
        void browser.tabs.sendMessage(details.tabId, { type: 'session-tokens', tokens }).catch(() => undefined);
      },
      { urls: ['https://mail.google.com/sync/*'] },
      ['requestHeaders'],
    );
  }

  // Phones: ask for desktop Gmail (src/shared/mobile.ts). A dynamic rule outlasts a restart.
  // Not every browser has declarativeNetRequest, whatever the types say.
  if (isPhone(navigator.userAgent) && (browser.declarativeNetRequest as typeof browser.declarativeNetRequest | undefined)) {
    const dnr = browser.declarativeNetRequest;
    const apply = (enabled: unknown) =>
      dnr
        .updateDynamicRules({ removeRuleIds: [DESKTOP_RULE_ID], addRules: enabled === false ? [] : [desktopRule(navigator.userAgent)] })
        .catch(() => undefined);
    void browser.storage.local.get('bg.enabled').then((s) => apply(s['bg.enabled']), () => apply(true));
    browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'bg.enabled' in changes) void apply(changes['bg.enabled']!.newValue);
    });
  }

  // API mode emulates snooze. Created once: recreating it on every wake restarts its minute, so a busy extension never sees it fire.
  void browser.alarms.get(SNOOZE_ALARM).then((alarm) => {
    if (!alarm) void browser.alarms.create(SNOOZE_ALARM, { periodInMinutes: 1 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SNOOZE_ALARM) return;
    void browser.storage.local.get('bg.settings.v1').then(async (s) => {
      const settings = s['bg.settings.v1'] as { backend?: string } | undefined;
      if (settings?.backend !== 'api') return;
      try {
        await wakeSnoozed(() => getBackgroundToken());
      } catch {
        // No silent token right now; the next alarm tries again.
      }
    });
  });
});
