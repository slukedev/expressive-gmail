import { useMemo, useState } from 'react';
import { mail } from '../data/actions';
import type { Message, Thread } from '../data/types';
import { openUrl } from '../lib/host';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { snack } from '../ui/Snackbar';
import { local, useLocal } from '../state/local';
import { rawId } from '../data/accounts/ids';
import { detectLanguage, messageText, phishingSignals, translateUrl } from './extract';

/** Gmail's "Why is this message in spam?" banner. */
export function SpamBanner({ thread }: { thread: Thread }) {
  if (!thread.labelIds.includes('SPAM')) return null;
  return (
    <div className="banner banner--error banner--thread" role="note">
      <Icon name="report" size={24} filled className="banner__icon" />
      <div className="banner__text">
        <p className="md-title-small">Why is this message in spam?</p>
        <p className="md-body-medium">It's similar to messages that were identified as spam in the past. Links and images are turned off.</p>
      </div>
      <Button variant="outlined" size="xs" onClick={() => void mail.notSpam([thread.id])}>
        Report not spam
      </Button>
    </div>
  );
}

/** "Be careful with this message". */
export function PhishingBanner({ message }: { message: Message }) {
  const dismissed = useLocal((s) => s.safeMessages.includes(rawId(message.id)));
  // Content, not the object: archiving or reading hands over a new message with the same mail in it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const signals = useMemo(() => phishingSignals(message, message.bodyHtml), [message.id, message.bodyHtml, message.bodyText]);
  if (dismissed || !signals.length || message.labelIds.includes('SENT')) return null;
  return (
    <div className="banner banner--warning" role="alert">
      <Icon name="gpp_maybe" size={24} filled className="banner__icon" />
      <div className="banner__text">
        <p className="md-title-small">Be careful with this message</p>
        <p className="md-body-medium">{signals.join('. ')}. Don't share passwords or codes, and check links before you click.</p>
      </div>
      <span className="banner__actions">
        <Button
          variant="filled"
          size="xs"
          onClick={() => {
            void mail.spam([message.threadId]);
            snack('Reported as phishing and moved to Spam');
          }}
        >
          Report phishing
        </Button>
        <Button variant="text" size="xs" onClick={() => local.markSafe(message.id)}>
          Looks safe
        </Button>
      </span>
    </div>
  );
}

/** Like Gmail's translate bar. */
export function TranslateBanner({ message }: { message: Message }) {
  const [dismissed, setDismissed] = useState(false);
  const { language, text } = useMemo(() => {
    const t = messageText(message).text;
    return { language: detectLanguage(`${message.subject}\n${t}`), text: t };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id, message.bodyHtml, message.bodyText]);
  if (dismissed || !language) return null;
  return (
    <div className="banner banner--quiet" role="note">
      <Icon name="translate" size={20} className="banner__icon" />
      <p className="banner__text md-body-medium">This message is in {language}.</p>
      <span className="banner__actions">
        <Button variant="text" size="xs" onClick={() => openUrl(translateUrl(`${message.subject}\n\n${text}`))}>
          Translate to English
        </Button>
        <Button variant="text" size="xs" onClick={() => setDismissed(true)}>
          Dismiss
        </Button>
      </span>
    </div>
  );
}
