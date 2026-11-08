import { backend, keys, queryClient } from '../data/client';
import { openUrl } from '../lib/host';
import { snack } from '../ui/Snackbar';
import { analyzeMessage, type PackageInfo } from './extract';
import { recordForThread } from './trackingStore';

/** For the newest shipping message in a thread. */
export async function openTracking(threadId: string) {
  try {
    const thread = await queryClient.fetchQuery({ queryKey: keys.thread(threadId), queryFn: () => backend().getThread(threadId), staleTime: 60_000 });
    for (const m of [...thread.messages].reverse()) {
      const pkg = analyzeMessage(m, thread.labelIds).find((s): s is PackageInfo => s.kind === 'package');
      if (pkg?.trackUrl) return openUrl(pkg.trackUrl);
      if (pkg?.tracking) return openUrl(`https://www.google.com/search?q=${encodeURIComponent(`track ${pkg.tracking}`)}`);
    }
    // Tracked by hand, or linked to other emails that carry the link.
    const record = recordForThread(threadId);
    if (record?.trackUrl) return openUrl(record.trackUrl);
    if (record?.kind === 'tracking') return openUrl(`https://www.google.com/search?q=${encodeURIComponent(`track ${record.ref}`)}`);
    snack("This email doesn't include a tracking link.");
  } catch {
    snack("Couldn't open tracking. Try again from the email.");
  }
}
