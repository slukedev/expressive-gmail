import { backend, keys, queryClient } from '../data/client';
import type { Account } from '../data/types';
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

/** An iMIP reply to the organizer, like Gmail's Yes / Maybe / No. */
export async function rsvp(threadId: string, answer: Rsvp, preloaded?: CalendarEvent): Promise<boolean> {
  const me = queryClient.getQueryData<Account>(keys.account);
  try {
    const event = preloaded ?? (await loadThreadEvent(threadId))?.event;
    if (!event || !me) throw new Error('No invitation found in this conversation.');
    if (!event.organizer) throw new Error('This invitation has no organizer to reply to.');
    const ics = buildIcsReply(event, { name: me.name, email: me.email }, answer);
    const when = new Date(event.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    await backend().send({
      threadId,
      to: [event.organizer],
      cc: [],
      bcc: [],
      subject: `${VERB[answer]}: ${event.title} @ ${when}`,
      html: `<p>${me.name} has ${VERB[answer].toLowerCase()} this invitation.</p>`,
      attachments: [{ id: 'rsvp', filename: 'invite.ics', mimeType: 'text/calendar; method=REPLY', size: ics.length, data: btoa(unescape(encodeURIComponent(ics))) }],
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
