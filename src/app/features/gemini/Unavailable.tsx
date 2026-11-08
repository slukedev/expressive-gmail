import type { GeminiStatus } from '../../data/gemini';
import { openUrl } from '../../lib/host';
import { useAccount } from '../../data/hooks';
import { useUi } from '../../state/ui';
import { Button } from '../../ui/Button';
import { EmptyArt } from '../../ui/EmptyArt';

const PLANS_URL = 'https://support.google.com/mail/answer/16831098';
const gmailSettingsUrl = (index = 0) => `https://mail.google.com/mail/u/${index}/#settings/general`;

/** And the one thing that would fix it. Nothing else of Gemini shows on such an account, so there's nothing to hide here. */
export function GeminiUnavailable({ status, compact }: { status: GeminiStatus | undefined; compact?: boolean }) {
  const { data: account } = useAccount();
  if (!status) return null;
  if (status.ready) return null;
  const copy = {
    plan: {
      title: 'Gemini isn’t on this account',
      body: 'Gemini in Gmail comes with Google AI plans and most Google Workspace plans. If your account is through work or school, your admin decides.',
      action: (
        <Button variant="tonal" icon="open_in_new" onClick={() => openUrl(PLANS_URL)}>
          See which plans have it
        </Button>
      ),
    },
    'smart-features': {
      title: 'Turn on smart features in Gmail',
      body: 'Gemini needs Gmail’s “Google Workspace smart features” setting. It’s under General in Gmail’s own settings.',
      action: (
        <Button variant="tonal" icon="open_in_new" onClick={() => openUrl(gmailSettingsUrl(account?.index))}>
          Open Gmail settings
        </Button>
      ),
    },
    connection: {
      title: 'Gemini needs your Gmail session',
      body: 'The Gmail API connection can’t reach Gemini. Switch to “Your Gmail session” to use it here.',
      action: (
        <Button variant="tonal" icon="sync" onClick={() => useUi.getState().set({ settingsSection: 'connection' })}>
          Change connection
        </Button>
      ),
    },
    page: {
      title: 'Gemini didn’t answer',
      body: status.detail ?? 'Gmail’s page didn’t show Gemini the way this app expects. Reload Gmail and try again.',
      action: null,
    },
  }[status.block];
  return (
    <div className={compact ? 'gemini-off gemini-off--compact' : 'gemini-off'} role="status">
      {!compact && <EmptyArt icon="block" tone="tertiary" size={112} />}
      <h3 className="md-title-medium">{copy.title}</h3>
      <p className="md-body-medium">{copy.body}</p>
      {copy.action && <div className="gemini-off__actions">{copy.action}</div>}
    </div>
  );
}
