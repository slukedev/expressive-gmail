import { useEffect, useState, useSyncExternalStore } from 'react';
import { readKey, watchKey } from '../state/storage';
import { PROBE_KEY, type ProbeRecord } from '../../session/photoProbe';
import { getDiagnostics, subscribeDiagnostics } from '../lib/host';
import { requestMeter } from '../data/requestMeter';
import { photoLog } from '../data/photoLog';
import { photos } from '../data/photos';
import { Button } from './Button';
import { Icon } from './Icon';
import { useCopy } from './feedback';

/** For error screens; tells a blocked hook from a Gmail change. */
export function Diagnostics() {
  const lines = useSyncExternalStore(subscribeDiagnostics, getDiagnostics, getDiagnostics);
  const { copied, copy } = useCopy();
  const details = [...lines, `requests: ${requestMeter.total} this session, ${requestMeter.since(60_000)} in the last minute`].join('\n');
  return (
    <>
      {lines.length > 0 && (
        <details className="diagnostics">
          <summary className="md-label-large">
            <Icon name="keyboard_arrow_down" size={20} />
            Connection details
          </summary>
          <pre className="md-body-small">{details}</pre>
          <Button variant="text" size="xs" icon="content_copy" confirmed={copied} confirmedLabel="Copied" onClick={() => void copy(details, 'Connection details copied')}>
            Copy
          </Button>
        </details>
      )}
      <PhotoDiagnostics />
    </>
  );
}

/** How recent photos and logos were found or missed, to paste back. Addresses appear only as their domain. */
function PhotoDiagnostics() {
  // Subscribed so the text follows every new lookup.
  useSyncExternalStore(photoLog.subscribe, photoLog.getSnapshot, photoLog.getSnapshot);
  const { copied, copy } = useCopy();
  // What Gmail itself showed for senders (session/photoProbe.ts).
  const [probe, setProbe] = useState<ProbeRecord[]>([]);
  useEffect(() => {
    void readKey<ProbeRecord[]>(PROBE_KEY).then((v) => setProbe(v ?? []));
    return watchKey(PROBE_KEY, (v) => setProbe((v as ProbeRecord[] | undefined) ?? []));
  }, []);
  const text = [
    photoLog.text(),
    '',
    probe.length ? 'Seen in Gmail itself:' : 'Seen in Gmail itself: nothing yet. Open the email in classic Gmail, then come back.',
    ...probe.map((r) => `${r.where} ${r.who} ${r.image}`),
  ].join('\n');
  return (
    <details className="diagnostics">
      <summary className="md-label-large">
        <Icon name="keyboard_arrow_down" size={20} />
        Photos
      </summary>
      <pre className="md-body-small">{text}</pre>
      <Button variant="text" size="xs" icon="content_copy" confirmed={copied} confirmedLabel="Copied" onClick={() => void copy(text, 'Photo details copied')}>
        Copy
      </Button>
      <Button variant="text" size="xs" icon="refresh" onClick={() => photos.reset()}>
        Look up again
      </Button>
    </details>
  );
}
