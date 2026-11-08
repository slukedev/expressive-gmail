/** Notification ids carry their thread. Thread ids hold colons, so the timestamp goes last. */
const PREFIX = 'bg:';

export function notificationId(threadId: string, now = Date.now()): string {
  return `${PREFIX}${threadId}:${now}`;
}

export function notificationThread(id: string): string | undefined {
  if (!id.startsWith(PREFIX)) return undefined;
  const end = id.lastIndexOf(':');
  return end > PREFIX.length ? id.slice(PREFIX.length, end) : undefined;
}
