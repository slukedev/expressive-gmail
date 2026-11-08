import { useUi } from '../../state/ui';
import { scheduleDraftSave } from './send';
import { saveReporter, useSaveState } from './status';

const TEXT = { idle: '', saving: 'Saving…', saved: 'Saved', error: "Couldn't save" };

/** Text changes cross-fade; only real changes are announced. */
export function SaveStatus({ draftKey }: { draftKey: string }) {
  const state = useSaveState((s) => s[draftKey] ?? 'idle');
  return (
    <span className="save-status md-label-medium" data-state={state} role="status">
      {(['saving', 'saved', 'error'] as const).map((s) => (
        <span key={s} className="save-status__text" data-on={state === s || undefined} aria-hidden={state !== s}>
          {TEXT[s]}
        </span>
      ))}
      {state === 'error' && (
        <button
          type="button"
          className="text-toggle save-status__retry"
          onClick={(e) => {
            e.stopPropagation();
            const d = useUi.getState().composes.find((c) => c.key === draftKey);
            if (d) scheduleDraftSave(d, saveReporter(draftKey), 0);
          }}
        >
          Retry
        </button>
      )}
    </span>
  );
}
