import { backend, keys, queryClient } from '../data/client';
import type { Thread } from '../data/types';
import { snack } from '../ui/Snackbar';
import { analyzeMessage, senderName, type PackageStatus } from './extract';
import { rawId } from '../data/accounts/ids';
import { useSettings } from '../state/settings';
import { MenuItem } from '../ui/Menu';
import { restoreRecord, trackedByHand, trackOrder, untrackEmail, useTracking, type OrderDraft } from './trackingStore';

/** With what its emails say about the order, and Undo. */
async function addToPackages(threadId: string) {
  let thread: Thread;
  try {
    thread = await queryClient.fetchQuery({ queryKey: keys.thread(threadId), queryFn: () => backend().getThread(threadId), staleTime: 60_000 });
  } catch {
    snack("Couldn't add this email to Packages. Try again.");
    return;
  }
  const guess = guessOrder(thread);
  const prior = useTracking.getState().records;
  const key = trackOrder({ id: threadId, date: guess.date || Date.now(), status: guess.status }, guess);
  const merchant = guess.merchant.trim();
  snack(merchant ? `Added your ${merchant} order to Packages` : 'Added to Packages', {
    action: { label: 'Undo', onClick: () => restoreRecord(key, prior[key]) },
  });
}

/** With Undo. */
export function stopTrackingEmail(threadId: string) {
  const gone = untrackEmail(threadId);
  if (gone) snack('Removed from Packages', { action: { label: 'Undo', onClick: () => restoreRecord(gone.key, gone.before) } });
}

/** Add when nothing tracks it, Remove when added by hand, nothing when its emails already make it a package. */
export function TrackOrderMenuItem({ threadId }: { threadId: string }) {
  const smart = useSettings((s) => s.smartFeatures);
  const record = useTracking((s) => {
    const key = s.byThread[rawId(threadId)];
    return key ? s.records[key] : undefined;
  });
  if (!smart) return null;
  if (trackedByHand(record, threadId)) {
    return (
      <MenuItem icon="close" onClick={() => stopTrackingEmail(threadId)}>
        Remove from Packages
      </MenuItem>
    );
  }
  if (record) return null;
  return (
    <MenuItem icon="local_shipping" onClick={() => void addToPackages(threadId)}>
      Add to Packages
    </MenuItem>
  );
}

interface Guess extends OrderDraft {
  status: PackageStatus;
  date: number;
}

function guessOrder(thread: Thread): Guess {
  const messages = thread.messages.filter((m) => !m.isDraft);
  const last = messages[messages.length - 1];
  const guess: Guess = { merchant: '', orderNo: '', tracking: '', carrier: '', status: 'ordered', date: last?.date ?? thread.lastDate };
  for (const m of [...messages].reverse()) {
    for (const info of analyzeMessage(m, thread.labelIds)) {
      if (info.kind === 'package') {
        guess.merchant ||= info.merchant ?? '';
        guess.orderNo ||= info.orderNo ?? '';
        guess.tracking ||= info.tracking ?? '';
        guess.carrier ||= info.carrier ?? '';
        if (m === last) guess.status = info.status;
      } else if (info.kind === 'receipt') {
        guess.merchant ||= info.merchant;
        guess.orderNo ||= info.orderNo ?? '';
      }
    }
  }
  if (!guess.merchant && last) guess.merchant = senderName(last.from);
  return guess;
}
