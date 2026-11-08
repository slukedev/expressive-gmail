import { toLegacyHexId } from '../../../session/ids';
import { rawId } from '../../data/accounts/ids';
import { useAccounts } from '../../data/accounts/store';
import { threadAccount } from '../../data/accounts/threads';
import { backend } from '../../data/client';

/** Opens in Gmail for anyone signed in to the same account (#all/<legacy id>); null when Gmail has none. The demo links to the preview. */
export function threadLink(id: string): string | null {
  const kind = backend().kind;
  if (kind === 'demo') return `${location.origin}${location.pathname}${location.search}#all/${encodeURIComponent(id)}`;
  const raw = rawId(id);
  const hex = kind === 'session' ? toLegacyHexId(raw) : /^[0-9a-f]{1,16}$/i.test(raw) ? raw : undefined;
  if (!hex) return null;
  const email = threadAccount(id);
  const index = useAccounts.getState().accounts.find((a) => a.email.toLowerCase() === email)?.index ?? 0;
  return `https://mail.google.com/mail/u/${index}/#all/${hex}`;
}
