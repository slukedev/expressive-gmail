import { useQuery } from '@tanstack/react-query';
import { backend, queryClient } from '../../data/client';
import { escapeHtml, parseAddresses } from '../../lib/format';
import { findUnsubscribeLink, parseListUnsubscribe, parseMailto } from '../../lib/unsubscribe';
import type { Message } from '../../data/types';
import { openUrl } from '../../lib/host';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { snack } from '../../ui/Snackbar';

/** Bulk mail worth checking for a List-Unsubscribe header. */
const BULK = ['CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];

function looksBulk(message: Message, labelIds: string[] = message.labelIds): boolean {
  return !!message.headers.listId || labelIds.some((l) => BULK.includes(l));
}

/** Some backends (Gmail's session data) leave them out of threads; then they're read from the message, only for mail that looks like it came from a list. */
export function useListHeaders(message: Message, labelIds: string[] = message.labelIds): Message['headers'] {
  const b = backend();
  const missing = !message.headers.listUnsubscribe && !!b.capabilities.listHeadersOnDemand && !!b.listHeaders;
  const { data } = useQuery({
    queryKey: ['list-headers', message.id],
    queryFn: () => b.listHeaders!(message.id),
    enabled: missing && looksBulk(message, labelIds),
    staleTime: Infinity,
    retry: 1,
  });
  return data ? { ...message.headers, ...data } : message.headers;
}

/** A List-Unsubscribe header, or a link in bulk mail's body. */
export function canUnsubscribe(message: Message, headers: Message['headers'], labelIds: string[] = message.labelIds): boolean {
  const t = parseListUnsubscribe(headers.listUnsubscribe);
  if (t.https || t.http || t.mailto) return true;
  return looksBulk(message, labelIds) && !!findUnsubscribeLink(message.bodyHtml, message.bodyText);
}

async function withListHeaders(message: Message): Promise<Message['headers']> {
  const b = backend();
  if (message.headers.listUnsubscribe || !b.capabilities.listHeadersOnDemand || !b.listHeaders) return message.headers;
  const extra = await queryClient.fetchQuery({ queryKey: ['list-headers', message.id], queryFn: () => b.listHeaders!(message.id), staleTime: Infinity, retry: 1 });
  return { ...message.headers, ...extra };
}

/** Sent without cookies, so the sender learns nothing else. no-cors because no extension can hold host permission for every sender; a form-encoded POST is a simple request, so it goes out and the reply is opaque. */
async function postOneClick(url: string) {
  await fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
  });
}

const PAGE_OPENED = 'Unsubscribe page opened in a new tab';

/** As Gmail does: one-click POST, then mailto, then the header's page, then a link in the body. False when nothing worked. */
export async function unsubscribe(message: Message): Promise<boolean> {
  const sender = message.from.name ?? message.from.email;
  const b = backend();
  let headers = message.headers;
  let lookupFailed = false;
  try {
    headers = await withListHeaders(message);
  } catch {
    // The body may still have a link.
    lookupFailed = true;
  }
  const targets = parseListUnsubscribe(headers.listUnsubscribe);
  const page = targets.https ?? targets.http;
  const bodyLink = findUnsubscribeLink(message.bodyHtml, message.bodyText);
  try {
    if ((targets.https || targets.mailto) && b.unsubscribe && !b.capabilities.listHeadersOnDemand) {
      const how = await b.unsubscribe(message.id);
      if (how !== 'link') {
        snack(`Unsubscribed from ${sender}`);
        return true;
      }
    } else {
      if (targets.https && /List-Unsubscribe\s*=\s*One-Click/i.test(headers.listUnsubscribePost ?? '')) {
        try {
          await postOneClick(targets.https);
          snack(`Unsubscribed from ${sender}`);
          return true;
        } catch {
          // Fall through to mailto or the page.
        }
      }
      if (targets.mailto && b.capabilities.send) {
        const mail = parseMailto(targets.mailto);
        if (mail.to.length) {
          await b.send({
            to: mail.to.flatMap((t) => parseAddresses(t)),
            cc: [],
            bcc: [],
            subject: mail.subject || 'unsubscribe',
            html: escapeHtml(mail.body || 'unsubscribe'),
            attachments: [],
          });
          snack(`Unsubscribed from ${sender}`);
          return true;
        }
      }
    }
  } catch {
    if (!page && !bodyLink) {
      snack(`Couldn't unsubscribe from ${sender}. Try the link in the email.`);
      return false;
    }
  }
  const link = page ?? bodyLink;
  if (link) {
    openUrl(link);
    snack(PAGE_OPENED);
    return true;
  }
  snack(
    lookupFailed
      ? `Couldn't reach Gmail to look up ${sender}'s unsubscribe options. Try again in a moment.`
      : `${sender} doesn't include a way to unsubscribe. You can block them or filter their mail instead.`,
  );
  return false;
}

/** The card opens it from its own button or its More menu. */
export function UnsubscribeDialog({ message, open, onOpenChange }: { message: Message; open: boolean; onOpenChange: (open: boolean) => void }) {
  const sender = message.from.name ?? message.from.email;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      icon="unsubscribe"
      title={`Unsubscribe from ${sender}?`}
      description={`You'll stop getting emails from ${message.from.email}. It can take a few days for the sender to process it.`}
      actions={
        <>
          <Button variant="text" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="text"
            onClick={() => {
              onOpenChange(false);
              void unsubscribe(message);
            }}
          >
            Unsubscribe
          </Button>
        </>
      }
    />
  );
}
