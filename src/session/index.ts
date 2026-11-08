import type { MailBackend } from '../app/data/backend';
import { SessionBackend, type SessionBackendOptions } from './backend';

/** Tokens are awaited inside each call, so this can be created before Gmail loads. */
export function createSessionBackend(options?: SessionBackendOptions): MailBackend {
  return new SessionBackend(options);
}
