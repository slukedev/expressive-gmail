import { test as base, expect, type Locator, type Page } from '@playwright/test';

/** Partial `bg.settings.v1` value; merged over the app defaults. */
export type SettingsSeed = Record<string, unknown>;

export const DEFAULT_SEED: SettingsSeed = {
  onboarded: true,
  undoSendSeconds: 0,
  readingPane: 'right',
};

/** Wrapper over the page with the locators every journey needs. */
export class Mail {
  constructor(readonly page: Page, private readonly query: string) {}

  /** Open a Gmail-style hash route, e.g. `inbox` or `inbox/t-onboarding-v4`. */
  async open(hash = 'inbox', extraQuery = '') {
    const q = [this.query, extraQuery].filter(Boolean).join('&');
    await this.page.goto(`/?${q}#${hash}`);
  }

  get list(): Locator {
    return this.page.getByRole('list', { name: 'Conversations' });
  }

  get rows(): Locator {
    return this.list.getByRole('listitem');
  }

  /** A list row by its subject text. */
  row(subject: string | RegExp): Locator {
    return this.rows.filter({ hasText: subject });
  }

  /** The clickable body of a row; its accessible name starts with "Unread, " while unread. */
  rowBody(subject: string | RegExp): Locator {
    return this.row(subject).locator('[data-row-index]');
  }

  get nav(): Locator {
    return this.page.getByRole('navigation', { name: 'Mailboxes' });
  }

  get inboxLink(): Locator {
    return this.nav.getByRole('link', { name: /^Inbox/ });
  }

  /** Unread count shown next to Inbox in the nav (0 when the badge is gone). */
  async inboxUnread(): Promise<number> {
    const m = /(\d[\d,]*)/.exec(await this.inboxLink.innerText());
    return m ? Number(m[1].replace(/,/g, '')) : 0;
  }

  get snackbar(): Locator {
    return this.page.getByRole('region', { name: 'Notifications' });
  }

  /** The polite live region that speaks feedback shown only in place (a copy turning to "Copied"). */
  announced(text: string): Locator {
    return this.page.getByRole('status').filter({ hasText: text });
  }

  get thread(): Locator {
    return this.page.getByRole('region', { name: 'Conversation', exact: true });
  }

  get threadToolbar(): Locator {
    return this.page.getByRole('toolbar', { name: 'Conversation actions' });
  }

  get threadHeading(): Locator {
    return this.thread.getByRole('heading', { level: 1 });
  }

  /** Hover a row and press one of its hover actions. */
  async hoverAction(subject: string | RegExp, action: string) {
    const row = this.row(subject);
    await row.hover();
    await row.getByRole('button', { name: action, exact: true }).click();
  }
}

/** Within two hours of midnight in New York, when a run's "today" could change under it. */
function nearMidnightInNewYork(now = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(now)) % 24;
  return hour >= 22 || hour < 2;
}

/** Today, 12:00 in New York (the suite's timezone), as an epoch time. */
function middayInNewYork(now = new Date()): number {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now); // YYYY-MM-DD
  const guess = new Date(`${day}T12:00:00Z`);
  // New York is 4 or 5 hours behind UTC: find the offset that lands on 12:00 there.
  for (const h of [16, 17]) {
    const t = new Date(`${day}T${h}:00:00Z`);
    if (new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(t) === '12') return t.getTime();
  }
  return guess.getTime();
}

export const test = base.extend<{ seed: SettingsSeed; query: string; mail: Mail }>({
  seed: [DEFAULT_SEED, { option: true }],
  query: ['latency=0', { option: true }],
  mail: async ({ page, seed, query }, provide) => {
    // The preview may be a dev server shared with someone editing src/: keep its HMR socket quiet so a hot update can't remount the app mid-test.
    await page.routeWebSocket((url) => url.searchParams.has('token'), () => {});
    // Demo mail is dated relative to now and read in New York time; near midnight there "Today" would flip mid-run, so only then the page's clock moves to midday (timers stay real).
    if (nearMidnightInNewYork()) await page.clock.setSystemTime(middayInNewYork());
    // Seed only a fresh profile so reloads keep whatever the app saved since.
    await page.addInitScript((value) => {
      if (!window.localStorage.getItem('bg.settings.v1')) window.localStorage.setItem('bg.settings.v1', value);
    }, JSON.stringify(seed));
    await provide(new Mail(page, query));
  },
});

export { expect };
