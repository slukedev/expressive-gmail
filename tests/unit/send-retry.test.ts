import { BackendError, type MailBackend } from '../../src/app/data/backend';
import type { OutgoingMessage } from '../../src/app/data/types';

const snacks: { message: string; action?: string }[] = [];
const actions: (() => void)[] = [];
vi.mock('../../src/app/ui/Snackbar', () => ({
  snack: (message: string, options: { action?: { label: string; onClick: () => void } } = {}) => {
    if (options.action) actions.push(options.action.onClick);
    return snacks.push({ message, action: options.action?.label });
  },
  snackbarManager: { close: () => {}, update: () => {} },
}));

const { setBackend } = await import('../../src/app/data/client');
const { useUi } = await import('../../src/app/state/ui');
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../../src/app/state/settings');
const { sendDraft } = await import('../../src/app/features/compose/send');

afterEach(() => {
  useUi.setState({ composes: [] });
  snacks.length = 0;
  actions.length = 0;
  vi.useRealTimers();
});

describe('sending again after Gmail went quiet', () => {
  it('reopens the window with the send key of the first try, and the next send carries it', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, undoSendSeconds: 0 } });
    const sent: OutgoingMessage[] = [];
    const send = vi.fn(async (m: OutgoingMessage) => {
      sent.push(m);
      if (sent.length === 1) throw new BackendError("Gmail didn't confirm the send. Check Sent before trying again.", 'unknown');
      return { id: 'm1', threadId: 't1' };
    });
    setBackend({ kind: 'demo', capabilities: { drafts: false }, send } as unknown as MailBackend);

    const key = useUi.getState().openCompose({ to: [{ email: 'grace@example.org' }], subject: 'Hi', html: 'Hello' });
    sendDraft(useUi.getState().composes.find((c) => c.key === key)!);
    await vi.waitFor(() => expect(useUi.getState().composes).toHaveLength(1));
    expect(snacks.at(-1)).toEqual({ message: "Gmail didn't confirm the send. Check Sent before trying again.", action: 'Open Sent' });

    sendDraft(useUi.getState().composes[0]!);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(sent[0]!.sendKey).toBeTruthy();
    expect(sent[1]!.sendKey).toBe(sent[0]!.sendKey);
  });

  it('gives an edited message a new send key, so the edit goes out instead of matching the first copy', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, undoSendSeconds: 0 } });
    const sent: OutgoingMessage[] = [];
    const send = vi.fn(async (m: OutgoingMessage) => {
      sent.push(m);
      if (sent.length === 1) throw new BackendError("Gmail didn't confirm the send. Check Sent before trying again.", 'unknown');
      return { id: 'm1', threadId: 't1' };
    });
    setBackend({ kind: 'demo', capabilities: { drafts: false }, send } as unknown as MailBackend);

    const key = useUi.getState().openCompose({ to: [{ email: 'grace@example.org' }], subject: 'Hi', html: 'Hello' });
    sendDraft(useUi.getState().composes.find((c) => c.key === key)!);
    await vi.waitFor(() => expect(useUi.getState().composes).toHaveLength(1));
    const reopened = useUi.getState().composes[0]!;
    useUi.getState().updateCompose(reopened.key, { html: 'Hello, with the fixed date' });

    sendDraft(useUi.getState().composes[0]!);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(sent[1]!.html).toContain('fixed date');
    expect(sent[1]!.sendKey).toBeTruthy();
    expect(sent[1]!.sendKey).not.toBe(sent[0]!.sendKey);
  });
});

describe('undo send', () => {
  it('does nothing once the undo window has passed, so a sent message never reopens as unsent', async () => {
    vi.useFakeTimers();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, undoSendSeconds: 5 } });
    const send = vi.fn(async () => ({ id: 'm1', threadId: 't1' }));
    setBackend({ kind: 'demo', capabilities: { drafts: false }, send } as unknown as MailBackend);

    const key = useUi.getState().openCompose({ to: [{ email: 'grace@example.org' }], subject: 'Hi', html: 'Hello' });
    sendDraft(useUi.getState().composes.find((c) => c.key === key)!);
    const undo = actions[0]!;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(send).toHaveBeenCalledTimes(1);

    // The pointer held the snackbar open past the delay, and Undo is pressed late.
    undo();
    expect(useUi.getState().composes).toHaveLength(0);
    expect(snacks.map((s) => s.message)).not.toContain('Sending undone');
  });

  it('cancels the send inside the undo window', async () => {
    vi.useFakeTimers();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, undoSendSeconds: 5 } });
    const send = vi.fn(async () => ({ id: 'm1', threadId: 't1' }));
    setBackend({ kind: 'demo', capabilities: { drafts: false }, send } as unknown as MailBackend);

    const key = useUi.getState().openCompose({ to: [{ email: 'grace@example.org' }], subject: 'Hi', html: 'Hello' });
    sendDraft(useUi.getState().composes.find((c) => c.key === key)!);
    await vi.advanceTimersByTimeAsync(2_000);
    actions[0]!();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
    expect(useUi.getState().composes).toHaveLength(1);
  });
});
