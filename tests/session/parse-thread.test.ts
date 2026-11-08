import { attachmentKey, parseThreadResponse } from '../../src/session/parse-thread';
import { fixture } from './helpers';

describe('nested /i/fd response (InboxSDK 2018 thread fixture)', () => {
  const { threads } = parseThreadResponse(fixture('fd-2018-inboxsdk.json'));
  const [thread] = threads;

  it('reads all four messages with the dates InboxSDK expects', () => {
    expect(threads).toHaveLength(1);
    expect(thread!.id).toBe('thread-f:1594506202591635145');
    expect(thread!.messages.map((m) => [m.id, m.date])).toEqual([
      ['msg-f:1594506202591635145', 1520639612762],
      ['msg-f:1594508744604132981', 1520642037014],
      ['msg-f:1594509071530617554', 1520642348795],
      ['msg-f:1594959172652759326', 1521071598675],
    ]);
  });

  it('joins every body part, quoted text included, in order', () => {
    const last = thread!.messages[3]!;
    const html = last.bodyHtml!;
    expect(html.startsWith('<div dir="ltr">Sara, It&#39;s called ZERO BOUNCE</div>')).toBe(true);
    const signature = html.indexOf('gmail_signature');
    expect(signature).toBeGreaterThan(0);
    expect(signature).toBeLessThan(html.indexOf('<div class="gmail_quote">'));
    expect(html.endsWith('</div>\r\n')).toBe(true);
  });

  it('threads replies through Message-ID, In-Reply-To and References', () => {
    const [first, second] = thread!.messages;
    expect(second!.headers.inReplyTo).toBe(first!.headers.messageId);
    expect(second!.headers.references).toBe(first!.headers.messageId);
    expect(second!.subject).toBe('Re: Validate emails within Pipeline');
    expect(second!.cc).toEqual([{ name: 'eng', email: 'eng@pipeline.example' }]);
  });

  it('takes labels from the summary rows and maps the forum category', () => {
    expect(thread!.labelIds).toEqual(expect.arrayContaining(['INBOX', 'CATEGORY_FORUMS']));
    expect(thread!.labelIds).not.toContain('UNREAD');
    expect(thread!.participants.map((p) => p.name)).toEqual(['Sara Okafor', 'Mike Osei']);
  });
});

describe('flat thread shape (gmail.js 2022 fixture)', () => {
  const { threads, attachmentUrls } = parseThreadResponse(fixture('fd-embedded-2022-gmailjs.json'));

  it('reads five unread-or-read single-message threads with unicode intact', () => {
    expect(threads).toHaveLength(5);
    const first = threads[0]!;
    expect(first.messages[0]!.from).toEqual({ name: 'Nora Halvorsen', email: 'nora@secure.halvorsen.example' });
    expect(first.snippet).toContain('🍵');
    expect(threads.find((t) => t.subject === 'Test email 3')!.labelIds).not.toContain('UNREAD');
  });

  it('reads the calendar invite the way gmail.js does', () => {
    const message = threads[0]!.messages[0]!;
    expect(message.attachments).toEqual([
      { id: '0.0.2', messageId: 'msg-f:1743836977043622489', filename: 'invite.ics', mimeType: 'application/ics', size: 1564 },
    ]);
    expect(attachmentUrls.get(attachmentKey(message.id, '0.0.2'))).toContain('permmsgid=msg-f:1743836977043622489');
    expect(threads[0]!.hasAttachments).toBe(true);
  });
});

describe('repeated thread in one response (gmail.js 2021 draft then send)', () => {
  it('keeps the later, sent version', () => {
    const { threads } = parseThreadResponse(fixture('fd-2021-draft-gmailjs.json'));
    expect(threads).toHaveLength(1);
    expect(threads[0]!.labelIds).toContain('SENT');
    expect(threads[0]!.draftCount).toBe(0);
  });
});

describe('current nested shape with attachments, plain text and a draft', () => {
  const parsed = parseThreadResponse(fixture('fd-current.json'));
  const trip = parsed.threads.find((t) => t.id === 'thread-f:1846500000000000007')!;
  const [photos, plain, draft] = trip.messages;

  it('skips malformed wrappers and bump placeholders', () => {
    expect(parsed.threads.map((t) => t.id)).toEqual(['thread-f:1846500000000000007', 'thread-f:1846500000000000555']);
    expect(trip.messages).toHaveLength(3);
    expect(parsed.historyId).toBe(4100500);
  });

  it('marks the image referenced from the HTML as inline and keeps the PDF as a file', () => {
    expect(photos!.attachments).toEqual([
      { id: '0.1', messageId: photos!.id, filename: 'beach.jpg', mimeType: 'image/jpeg', size: 204800, contentId: 'ii_m1a2b3c4', inline: true },
      { id: '0.2', messageId: photos!.id, filename: 'itinerary.pdf', mimeType: 'application/pdf', size: 91234 },
    ]);
    expect(trip.attachments.map((a) => a.filename)).toEqual(['itinerary.pdf']);
    expect(photos!.replyTo).toEqual([{ name: 'Trips', email: 'noreply@trips.example.org' }]);
    expect(photos!.headers.listId).toBe('<trips.example.org>');
  });

  it('keeps a plain-text body as text, not HTML', () => {
    expect(plain!.bodyHtml).toBeUndefined();
    expect(plain!.bodyText).toBe('Thanks!\nSee you <soon> & bring snacks.');
  });

  it('counts the draft separately and leaves it out of participants', () => {
    expect(draft!.isDraft).toBe(true);
    expect(trip.messageCount).toBe(2);
    expect(trip.draftCount).toBe(1);
    expect(trip.participants.map((p) => p.email)).toEqual(['grace@example.org', 'ada@example.com']);
    expect(trip.subject).toBe('Trip photos 🏖️ + itinerary');
  });

  it('parses a wrapper fetched without its summary, from details alone', () => {
    const bare = parsed.threads[1]!;
    expect(bare.subject).toBe('Löschen?');
    expect(bare.labelIds).toEqual([]);
    expect(bare.messages[0]!.from).toEqual({ email: 'bot@example.com' });
  });
});

describe('malformed input', () => {
  it.each([null, {}, 'oops', [0], [0, 'not a list'], [0, [[null], [42, null]]]])('returns no threads for %j', (input) => {
    expect(parseThreadResponse(input).threads).toEqual([]);
  });
});
