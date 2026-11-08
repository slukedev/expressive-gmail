import { backend, keys, queryClient } from '../../data/client';
import type { Thread } from '../../data/types';
import { useUi } from '../../state/ui';
import { snack } from '../../ui/Snackbar';
import { writeClipboard } from '../../ui/feedback';
import { replyToMessage } from '../compose/open';
import { plainText, textToHtml } from './GeminiText';

/** A reply already open keeps what you typed; the text goes to the clipboard instead. */
export async function replyWith(threadId: string, text: string, mode: 'reply' | 'reply-all' = 'reply') {
  const open = useUi.getState().composes.find((c) => c.threadId === threadId && (c.mode === 'reply' || c.mode === 'reply-all'));
  if (open) {
    if (await writeClipboard(plainText(text))) snack('Your reply is already open, so the text is copied. Paste it where you want it.');
    useUi.getState().updateCompose(open.key, { window: open.window === 'minimized' ? 'open' : open.window });
    return;
  }
  const thread = queryClient.getQueryData<Thread>(keys.thread(threadId)) ?? (await backend().getThread(threadId));
  const last = [...thread.messages].reverse().find((m) => !m.isDraft);
  if (!last) return;
  replyToMessage(threadId, last, mode, textToHtml(text));
}
