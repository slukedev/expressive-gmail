import { browser } from 'wxt/browser';
import { accountIndexFromPath, readGlobalsFromDocument } from '../session/account';

/** Safari: tokens the background read from Gmail's request headers, relayed in the main-world hook's format, plus the hook itself. */
export function startSafariTokens(diag: (line: string) => void = () => undefined) {
  let globals: { ik?: string; email?: string } | null = null;
  let logged = '';
  browser.runtime.onMessage.addListener((message: { type?: string; tokens?: Record<string, string | undefined> }) => {
    if (message?.type !== 'session-tokens' || !message.tokens) return;
    // The tab's hidden account frames share the relay; keep this account's calls only.
    const syncPath = message.tokens.syncPath;
    if (syncPath && accountIndexFromPath(syncPath) !== accountIndexFromPath(location.pathname)) return;
    globals ??= readGlobalsFromDocument(document);
    // Gmail polls every second or so: note the first tokens and any change of account, not each poll.
    if (syncPath !== logged) {
      logged = syncPath ?? '';
      diag(`tokens from request headers${syncPath ? ` (${syncPath})` : ''}`);
    }
    window.postMessage(
      { source: 'better-gmail/main', version: 1, type: 'session-tokens', tokens: { ...globals, ...message.tokens, capturedAt: Date.now() } },
      location.origin,
    );
  });
  // The scripting API isn't bound by Gmail's CSP; the nonce route is for Safari versions without it.
  void browser.runtime
    .sendMessage({ type: 'inject-main' })
    .then((res: { ok?: boolean; error?: string } | undefined) => {
      diag(res?.ok ? 'main-world hook injected' : `scripting injection failed: ${res?.error ?? 'no response'}`);
      if (!res?.ok) injectMainWorld(browser.runtime.getURL('/gmail-main-safari.js' as never));
    })
    .catch((err) => {
      diag(`scripting request failed: ${String(err?.message ?? err)}`);
      injectMainWorld(browser.runtime.getURL('/gmail-main-safari.js' as never));
    });
}

/** Gmail's CSP only runs scripts with its per-page nonce: borrow it from one of Gmail's script tags, and if still refused, inline the code with it. */
function injectMainWorld(url: string) {
  const findNonce = () => {
    for (const el of document.querySelectorAll<HTMLScriptElement>('script[nonce], script')) {
      const n = el.nonce || el.getAttribute('nonce');
      if (n) return n;
    }
    return null;
  };
  const inject = (nonce: string) => {
    const tag = document.createElement('script');
    tag.setAttribute('nonce', nonce);
    tag.src = url;
    tag.onload = () => tag.remove();
    tag.onerror = () => {
      tag.remove();
      void fetch(url)
        .then((r) => r.text())
        .then((code) => {
          const inline = document.createElement('script');
          inline.setAttribute('nonce', nonce);
          inline.textContent = code;
          (document.head ?? document.documentElement).append(inline);
          inline.remove();
        })
        .catch(() => undefined);
    };
    (document.head ?? document.documentElement).append(tag);
  };
  const nonce = findNonce();
  if (nonce) {
    inject(nonce);
    return;
  }
  // At document_start Gmail's scripts may not be parsed yet. Not forever: a page with no nonce would have this watch every change.
  const observer = new MutationObserver(() => {
    const n = findNonce();
    if (!n) return;
    stop();
    inject(n);
  });
  const timer = setTimeout(() => stop(), 30_000);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
