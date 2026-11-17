import { backend, keys, queryClient } from '../data/client';
import { splitId } from '../data/accounts/ids';
import { bytesToBase64, utf8Encode } from '../data/api/base64';
import { myAddresses } from '../data/hooks';
import type { Account, Address } from '../data/types';
import { isMe } from '../lib/format';
import { local } from '../state/local';
import { snack } from '../ui/Snackbar';
import { buildIcsReply, parseIcs, type CalendarEvent, type Rsvp } from './extract';

const VERB: Record<Rsvp, string> = { ACCEPTED: 'Accepted', TENTATIVE: 'Tentatively accepted', DECLINED: 'Declined' };

/** The newest .ics attachment. */
export async function loadThreadEvent(threadId: string): Promise<{ event: CalendarEvent; messageId: string } | null> {
  const thread = await queryClient.fetchQuery({ queryKey: keys.thread(threadId), queryFn: () => backend().getThread(threadId), staleTime: 60_000 });
  for (const m of [...thread.messages].reverse()) {
    const ics = m.attachments.find((a) => a.mimeType.startsWith('text/calendar') || /\.ics$/i.test(a.filename));
    if (!ics) continue;
    const { data } = await backend().getAttachment(m.id, ics.id);
    const text = new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    const event = parseIcs(text);
    if (event) return { event, messageId: m.id };
  }
  return null;
}

/** The invited address that's mine, preferring the account that owns the conversation, since that account sends the reply. */
export function attendeeFor(event: CalendarEvent, account: Account, threadId: string): Address {
  const owner = account.members?.find((m) => m.key === splitId(threadId).key) ?? account;
  const ownAddresses = [owner.email, ...(owner.sendAs ?? []).map((a) => a.email)];
  const mine = event.attendees.find((a) => isMe(a.email, ownAddresses)) ?? event.attendees.find((a) => isMe(a.email, myAddresses(account)));
  return { email: mine?.email ?? owner.email, name: mine?.name ?? owner.name };
}

/** An iMIP reply to the organizer, like Gmail's Yes / Maybe / No. */
export async function rsvp(threadId: string, answer: Rsvp, preloaded?: CalendarEvent): Promise<boolean> {
  const account = queryClient.getQueryData<Account>(keys.account);
  try {
    const event = preloaded ?? (await loadThreadEvent(threadId))?.event;
    if (!event || !account) throw new Error('No invitation found in this conversation.');
    if (!event.organizer) throw new Error('This invitation has no organizer to reply to.');
    const me = attendeeFor(event, account, threadId);
    const ics = utf8Encode(buildIcsReply(event, me, answer));
    const when = new Date(event.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    await backend().send({
      threadId,
      from: { email: me.email },
      to: [event.organizer],
      cc: [],
      bcc: [],
      subject: `${VERB[answer]}: ${event.title} @ ${when}`,
      html: `<p>${me.name ?? me.email} has ${VERB[answer].toLowerCase()} this invitation.</p>`,
      attachments: [{ id: 'rsvp', filename: 'invite.ics', mimeType: 'text/calendar; method=REPLY', size: ics.length, data: bytesToBase64(ics) }],
    });
    local.setRsvp(event.uid, answer);
    // Even when the thread isn't on screen: a hover prefetch may hold it without the reply.
    await queryClient.invalidateQueries({ queryKey: keys.thread(threadId), refetchType: 'all' });
    snack(`${VERB[answer]} "${event.title}". ${event.organizer.name ?? event.organizer.email} will get your reply.`);
    return true;
  } catch (err) {
    snack(err instanceof Error ? `Couldn't send your reply. ${err.message}` : "Couldn't send your reply.");
    return false;
  }
}
