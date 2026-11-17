import { browser } from 'wxt/browser';
import { runsApp } from './takeover';

export interface SwitchableTab {
  id: number;
  /** Compose windows with something in them (the app frame reports it to the content script). */
  unsent: number;
}

/** Gmail tabs that change mode when reloaded: not delegated mailboxes or Gmail's own popouts. */
export async function switchableTabs(except?: number): Promise<SwitchableTab[]> {
  const tabs = await browser.tabs.query({ url: 'https://mail.google.com/*' });
  return Promise.all(
    tabs
      .filter((t): t is typeof t & { id: number } => t.id !== undefined && t.id !== except && runsApp(t.url))
      .map(async (t) => {
        // A classic or discarded tab has nobody listening.
        const reply = (await browser.tabs.sendMessage(t.id, { type: 'unsent-drafts' }).catch(() => undefined)) as { unsent?: unknown } | undefined;
        return { id: t.id, unsent: Number(reply?.unsent) || 0 };
      }),
  );
}
