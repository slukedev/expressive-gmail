import type { MailBackend } from '../../src/app/data/backend';
import type { Draft, OutgoingMessage } from '../../src/app/data/types';

// jsdom has no matchMedia; the theme reads the system colour scheme as it loads.
vi.hoisted(() => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
});
const snacks = vi.hoisted(() => [] as string[]);
vi.mock('../../src/app/ui/Snackbar', () => ({ snack: (text: string) => (snacks.push(text), 0), snackbarManager: { close: () => {}, update: () => {} } }));
vi.mock('../../src/app/data/accounts/store', () => {
  const state = { scope: 'home', pending: null as string | null, accounts: [], directory: null };
  return {
    useAccounts: { getState: () => state, setState: (patch: Partial<typeof state>) => Object.assign(state, patch) },
    scopeName: () => 'Work',
    scopeAccounts: () => [{ email: 'work@example.com', index: 1 }],
    isMergedScope: () => true,
    // The switch itself never finishes here: only the drafts parked before it matter.
    backendForScope: () => new Promise(() => {}),
    activateScope: () => {},
    accountColor: () => '#000',
    openAccount: () => Promise.resolve(),
  };
});

const { setBackend } = await import('../../src/app/data/client');
const { useUi } = await import('../../src/app/state/ui');
const { editDraft } = await import('../../src/app/features/compose/open');
const { switchScope } = await import('../../src/app/features/accounts/switch');

describe('switching accounts with a reopened draft still loading its files', () => {
  it('waits for them and saves the draft with them', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const getAttachment = vi.fn(() => new Promise<{ data: string }>((r) => (release = () => r({ data: 'JVBERi0=' }))));
    const saves: OutgoingMessage[] = [];
    const saveDraft = vi.fn(async (m: OutgoingMessage): Promise<Draft> => (saves.push(m), { id: 'd1', message: { id: 'm-d1' } as Draft['message'] }));
    setBackend({ capabilities: { drafts: true }, getAttachment, saveDraft } as unknown as MailBackend);
    editDraft({
      id: 'r1',
      threadId: 't9',
      from: { email: 'me@example.com' },
      to: [{ email: 'lena@example.com' }],
      cc: [],
      bcc: [],
      subject: 'Lease',
      date: 0,
      snippet: '',
      bodyHtml: '<div>Anbei der Vertrag.</div>',
      labelIds: ['DRAFT'],
      headers: {},
      attachments: [{ id: 'a1', filename: 'lease.pdf', mimeType: 'application/pdf', size: 5 }],
      isDraft: true,
    } as unknown as Parameters<typeof editDraft>[0]);

    void switchScope('circle:work');
    await vi.advanceTimersByTimeAsync(50);
    expect(saves).toHaveLength(0);
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(saves.map((m) => m.attachments.map((a) => a.filename))).toEqual([['lease.pdf']]);
    expect(useUi.getState().composes).toEqual([]);
    vi.useRealTimers();
  });
});
