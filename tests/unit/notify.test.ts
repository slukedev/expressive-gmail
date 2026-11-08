import { notificationId, notificationThread } from '../../src/shared/notify';

describe('notification ids', () => {
  it.each(['thread-f:1789012345678901234', 'thread-a:r-4567', 'abc1234~thread-f:99', '18c2f0a1b2c3d4e5'])('%s survives the round trip', (threadId) => {
    expect(notificationThread(notificationId(threadId, 1_700_000_000_000))).toBe(threadId);
  });

  it('ignores ids that are not ours', () => {
    expect(notificationThread('other:1')).toBeUndefined();
    expect(notificationThread('bg:')).toBeUndefined();
  });
});
