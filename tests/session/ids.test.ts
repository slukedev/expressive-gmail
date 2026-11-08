import { fromLegacyHexId, isMessageId, newDraftIds, normalizeThreadId, randomSignedDecimal, toLegacyHexId } from '../../src/session/ids';

describe('legacy hex ids', () => {
  // Pairs Gmail itself reported side by side: InboxSDK's expected oldGmailThreadID
  // values and gmail.js's legacy_email_id for the same message.
  it.each([
    ['thread-f:1589064200257780346', '160d7d788da7ba7a'],
    ['thread-f:1594506202591635145', '1620d2f175a1a6c9'],
    ['msg-f:1665118316230599953', '171bb04953ebe511'],
    ['msg-f:1743836977043622489', '18335a7dcae04a59'],
  ])('%s is %s', (syncId, hex) => {
    expect(toLegacyHexId(syncId)).toBe(hex);
    expect(fromLegacyHexId(hex, syncId.startsWith('msg') ? 'msg' : 'thread')).toBe(syncId);
  });

  it('keeps values above 2^63 exact', () => {
    expect(fromLegacyHexId('ffffffffffffffff', 'thread')).toBe('thread-f:18446744073709551615');
    expect(toLegacyHexId('thread-f:18446744073709551615')).toBe('ffffffffffffffff');
  });

  it('has no legacy form for ids this account created', () => {
    expect(toLegacyHexId('thread-a:r-1030145228305804508')).toBeUndefined();
    expect(fromLegacyHexId('not-hex', 'thread')).toBeUndefined();
  });
});

describe('normalizeThreadId', () => {
  it('drops the "|msg-f:" suffix search results append', () => {
    expect(normalizeThreadId('thread-f:1743836977043622489|msg-f:1743836977043622489')).toBe('thread-f:1743836977043622489');
  });

  it('accepts negative "thread-a:r" ids and rejects anything else', () => {
    expect(normalizeThreadId('thread-a:r-8891700334768116294')).toBe('thread-a:r-8891700334768116294');
    expect(normalizeThreadId('msg-f:1')).toBeUndefined();
    expect(normalizeThreadId('160d7d788da7ba7a')).toBeUndefined();
    expect(normalizeThreadId(42)).toBeUndefined();
  });
});

it('treats "msg-a:bump-" placeholders as non-messages', () => {
  expect(isMessageId('msg-a:bump-r-329565169840451245')).toBe(false);
  expect(isMessageId('msg-a:r-329565169840451245')).toBe(true);
});

it('generates signed 64-bit decimals like Gmail does', () => {
  expect(randomSignedDecimal((b) => b.fill(0xff))).toBe('-1');
  expect(randomSignedDecimal((b) => b.fill(0x7f))).toBe('9187201950435737471');
  const ids = newDraftIds();
  expect(ids.threadId).toMatch(/^thread-a:r-?\d+$/);
  expect(ids.messageId).toMatch(/^msg-a:r-?\d+$/);
});
