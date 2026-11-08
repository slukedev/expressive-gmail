import { describe, expect, it } from 'vitest';
import { accountKey, qualify, rawId, splitId } from '../../src/app/data/accounts/ids';
import { accountShortLabel, scopeAccounts, scopeName } from '../../src/app/data/accounts/store';
import { accountInfo } from '../../src/app/data/accounts/directory';
import { accountsClient, serveAccounts } from '../../src/shared/accounts-rpc';

const main = accountInfo({ email: 'alex.rivera@example.com', name: 'Alex Rivera', index: 0 }, true);
const studio = accountInfo({ email: 'alex@riverastudio.example.net', name: 'Alex Rivera', index: 1 });
const makes = accountInfo({ email: 'alexr.makes@example.org', name: 'Alex Rivera', index: 2 });
const accounts = [main, studio, makes];

describe('account ids', () => {
  it('qualifies ids reversibly and leaves backend ids that merely contain "~" alone', () => {
    const key = accountKey('Alex.Rivera@Example.com ');
    expect(key).toBe(accountKey('alex.rivera@example.com'));
    expect(key).toMatch(/^[0-9a-z]{7}$/);
    expect(splitId(qualify(key, 'thread-f:17~2'))).toEqual({ key, raw: 'thread-f:17~2' });
    expect(splitId('a~b')).toEqual({ raw: 'a~b' });
    expect(rawId(qualify(key, 'FMfcgz'))).toBe('FMfcgz');
  });
});

describe('scopes', () => {
  const settings = {
    circles: [{ id: 'w', name: 'Work', members: ['alex@riverastudio.example.net', 'gone@example.com', 'alex.rivera@example.com'], color: '#4a86e8' }],
    accountPrefs: { 'alexr.makes@example.org': { hideFromAll: true, nickname: 'Pottery' } },
  };

  it('All inboxes leaves out hidden accounts, a circle keeps its own order and skips signed-out members', () => {
    expect(scopeAccounts('all', accounts, settings).map((a) => a.index)).toEqual([0, 1]);
    expect(scopeAccounts('circle:w', accounts, settings).map((a) => a.index)).toEqual([1, 0]);
    expect(scopeAccounts('circle:nope', accounts, settings)).toEqual([]);
    expect(scopeAccounts('account:ALEX@riverastudio.example.net'.toLowerCase() as `account:${string}`, accounts, settings)).toEqual([studio]);
    // Hiding every account from All inboxes can't leave it empty.
    const allHidden = { ...settings, accountPrefs: Object.fromEntries(accounts.map((a) => [a.email, { hideFromAll: true }])) };
    expect(scopeAccounts('all', accounts, allHidden)).toHaveLength(3);
  });

  it('names scopes and tells accounts with the same profile name apart', () => {
    expect(scopeName('all', accounts, settings)).toBe('All inboxes');
    expect(scopeName('circle:w', accounts, settings)).toBe('Work');
    const prefs = { accountPrefs: settings.accountPrefs };
    // A work domain names itself; two accounts on example.* fall back to the part before the @.
    expect(accounts.map((a) => accountShortLabel(a, accounts, prefs))).toEqual(['alex.rivera', 'riverastudio', 'Pottery']);
    const gmail = [accountInfo({ email: 'sam@gmail.com', index: 0 }), accountInfo({ email: 'sam.work@gmail.com', index: 1 })];
    expect(gmail.map((a) => accountShortLabel(a, gmail, { accountPrefs: {} }))).toEqual(['sam', 'sam.work']);
  });
});

describe('accounts over a port', () => {
  it('answers list and unread, hands over a working port for open, and reports failures', async () => {
    const channel = new MessageChannel();
    const opened: number[] = [];
    serveAccounts(channel.port1, {
      list: async () => [{ email: 'ada@example.com', index: 0, home: true }],
      unread: async (indices) => Object.fromEntries(indices.map((i) => [i, i * 10])),
      profiles: async () => ({}),
      delegated: async () => [{ email: 'team@example.com', url: 'https://mail.google.com/mail/u/0/d/AEoRXRTexample01/' }],
      open: async (index) => {
        if (index === 9) throw new Error('Gmail for this account did not load in the background.');
        opened.push(index);
        const inner = new MessageChannel();
        inner.port1.onmessage = (e) => inner.port1.postMessage(`pong ${e.data}`);
        return inner.port2;
      },
    });
    const client = accountsClient(channel.port2);
    expect(await client.list()).toEqual([{ email: 'ada@example.com', index: 0, home: true }]);
    expect(await client.unread([1, 2])).toEqual({ 1: 10, 2: 20 });
    expect(await client.delegated()).toEqual([{ email: 'team@example.com', url: 'https://mail.google.com/mail/u/0/d/AEoRXRTexample01/' }]);
    const port = await client.open(1, 'x@example.com');
    const reply = new Promise((resolve) => (port.onmessage = (e) => resolve(e.data)));
    port.postMessage('ping');
    expect(await reply).toBe('pong ping');
    await expect(client.open(9, 'y@example.com')).rejects.toThrow('did not load in the background');
    expect(opened).toEqual([1]);
    channel.port1.close();
    port.close();
  });
});

describe('booting accounts', () => {
  it('a tab that could not name its account at first still ends up in that account once the list knows it', async () => {
    const { bootAccounts, useAccounts } = await import('../../src/app/data/accounts/store');
    const home = {
      kind: 'session',
      capabilities: {},
      accountHint: async () => undefined,
      // Gmail hasn't finished loading.
      getAccount: async () => Promise.reject(new Error('not yet')),
      listLabels: async () => [],
    } as unknown as import('../../src/app/data/backend').MailBackend;
    const directory = {
      list: async () => [accountInfo({ email: 'Ada@Example.com', index: 0 }, true), accountInfo({ email: 'bo@example.com', index: 1 })],
      open: async () => home,
    };
    await bootAccounts(directory, home);
    await vi.waitFor(() => expect(useAccounts.getState().accounts).toHaveLength(2));
    expect(useAccounts.getState().scope).toBe('account:ada@example.com');
  });
});

describe('delegated mailboxes', () => {
  it('looks once more after an empty first answer, and lists each mailbox once by address and link', async () => {
    vi.useFakeTimers();
    try {
      const { bootAccounts, useAccounts } = await import('../../src/app/data/accounts/store');
      const home = {
        kind: 'session',
        capabilities: {},
        accountHint: async () => 'ada@example.com',
        getAccount: async () => ({ email: 'ada@example.com', name: 'Ada' }),
        listLabels: async () => [],
      } as unknown as import('../../src/app/data/backend').MailBackend;
      const url = 'https://mail.google.com/mail/u/0/d/AEoRXRTexample01/';
      const answers = [[], [{ email: 'team@example.com', url }, { email: 'alias@example.com', url }]];
      let asked = 0;
      const directory = {
        list: async () => [accountInfo({ email: 'ada@example.com', index: 0 }, true)],
        open: async () => home,
        delegated: async () => answers[asked++] ?? [],
      };
      await bootAccounts(directory, home);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(asked).toBe(1);
      expect(useAccounts.getState().delegated).toEqual([]);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(asked).toBe(2);
      expect(useAccounts.getState().delegated).toEqual([{ email: 'team@example.com', url }]);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
