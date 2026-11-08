import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient, setBackend } from '../../src/app/data/client';
import type { MailBackend } from '../../src/app/data/backend';
import type { Message } from '../../src/app/data/types';
import { unsubscribe } from '../../src/app/features/thread/UnsubscribeButton';

vi.mock('../../src/app/ui/Snackbar', () => ({ snack: vi.fn() }));
vi.mock('../../src/app/lib/host', () => ({ openUrl: vi.fn() }));
const { snack } = await import('../../src/app/ui/Snackbar');
const { openUrl } = await import('../../src/app/lib/host');

const msg: Message = {
  id: 'msg-f:1',
  threadId: 't',
  labelIds: ['CATEGORY_PROMOTIONS'],
  from: { name: 'Stride & Co.', email: 'news@stride.example' },
  to: [],
  cc: [],
  bcc: [],
  date: 0,
  subject: 'Sale',
  snippet: '',
  attachments: [],
  headers: {},
};

/** A backend like the session one: thread data has no List-* headers; they come from listHeaders(). */
function sessionLike(headers: Partial<Message['headers']>) {
  const b = {
    kind: 'session',
    capabilities: { send: true, listHeadersOnDemand: true },
    listHeaders: vi.fn(async () => headers),
    send: vi.fn(async () => ({ id: 'm', threadId: 't' })),
    // The RPC proxy exposes every method, even ones the session backend lacks.
    unsubscribe: vi.fn(async () => {
      throw new Error('unsubscribe is not available');
    }),
  };
  setBackend(b as unknown as MailBackend);
  return b;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => new Response(null));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it('one-click: POSTs the RFC 8058 body without cookies and never calls the backend unsubscribe', async () => {
  const b = sessionLike({ listUnsubscribe: '<mailto:u@stride.example>, <https://stride.example/u?id=7>', listUnsubscribePost: 'List-Unsubscribe=One-Click' });
  expect(await unsubscribe(msg)).toBe(true);
  expect(fetchMock).toHaveBeenCalledWith('https://stride.example/u?id=7', expect.objectContaining({ method: 'POST', credentials: 'omit', body: 'List-Unsubscribe=One-Click' }));
  expect(b.unsubscribe).not.toHaveBeenCalled();
  expect(b.send).not.toHaveBeenCalled();
  expect(snack).toHaveBeenCalledWith('Unsubscribed from Stride & Co.');
});

it('without one-click it sends the mailto request, with the subject the sender asked for', async () => {
  const b = sessionLike({ listUnsubscribe: '<https://stride.example/page>, <mailto:u@stride.example?subject=Remove%20me>' });
  expect(await unsubscribe(msg)).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(b.send).toHaveBeenCalledWith(expect.objectContaining({ to: [expect.objectContaining({ email: 'u@stride.example' })], subject: 'Remove me' }));
});

it('a page-only sender opens the page; no header at all says so and reports failure', async () => {
  sessionLike({ listUnsubscribe: '<https://stride.example/page>' });
  expect(await unsubscribe(msg)).toBe(true);
  expect(openUrl).toHaveBeenCalledWith('https://stride.example/page');

  queryClient.clear();
  sessionLike({});
  expect(await unsubscribe(msg)).toBe(false);
  expect(snack).toHaveBeenLastCalledWith("Stride & Co. doesn't include a way to unsubscribe. You can block them or filter their mail instead.");
});

it('says the page opened when it opens one, including a plain http page', async () => {
  sessionLike({ listUnsubscribe: '<http://stride.example/plain-http>' });
  expect(await unsubscribe(msg)).toBe(true);
  expect(openUrl).toHaveBeenCalledWith('http://stride.example/plain-http');
  expect(fetchMock).not.toHaveBeenCalled();
  expect(snack).toHaveBeenCalledWith('Unsubscribe page opened in a new tab');
});

it('with no header, opens the unsubscribe link in the body', async () => {
  sessionLike({});
  const body = '<p>Thanks for reading.</p><a href="https://stride.example/shop">Shop</a> <a href="https://stride.example/prefs?u=1&amp;l=2"><span>Unsubscribe</span></a>';
  expect(await unsubscribe({ ...msg, bodyHtml: body })).toBe(true);
  expect(openUrl).toHaveBeenCalledWith('https://stride.example/prefs?u=1&l=2');
  expect(snack).toHaveBeenCalledWith('Unsubscribe page opened in a new tab');
});

it('when the header lookup fails, still uses a body link, and otherwise says the check failed', async () => {
  const b = sessionLike({});
  b.listHeaders.mockRejectedValue(new Error('sign-in page'));
  expect(await unsubscribe({ ...msg, bodyHtml: '<a href="https://stride.example/u">Se désabonner</a>' })).toBe(true);
  expect(openUrl).toHaveBeenCalledWith('https://stride.example/u');

  queryClient.clear();
  expect(await unsubscribe(msg)).toBe(false);
  expect(snack).toHaveBeenLastCalledWith("Couldn't reach Gmail to look up Stride & Co.'s unsubscribe options. Try again in a moment.");
});

it('if sending the mailto request fails, falls back to the page', async () => {
  const b = sessionLike({ listUnsubscribe: '<mailto:u@stride.example>, <https://stride.example/page>' });
  b.send.mockRejectedValue(new Error('offline'));
  expect(await unsubscribe(msg)).toBe(true);
  expect(openUrl).toHaveBeenCalledWith('https://stride.example/page');
});
