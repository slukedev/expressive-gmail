import { create } from 'zustand';
import { useUi, type ComposeDraft } from '../../state/ui';
import { snack } from '../../ui/Snackbar';
import { cancelDraftSave, isEmptyDraft, scheduleDraftSave } from './send';
import { flushEditors } from './settle';
import { withFetchedFiles } from './open';
import { reportUnsentDrafts } from '../../lib/appHost';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const useSaveState = create<Record<string, SaveState>>(() => ({}));

const slow = new Map<string, number>();

useUi.subscribe((s, prev) => {
  if (s.composes !== prev.composes) reportUnsentDrafts(s.composes.filter((c) => !isEmptyDraft(c)).length);
});

/** "Saving..." only shows when a save takes a while, so a quick one goes straight to (or stays on) "Saved". */
export function saveReporter(key: string) {
  return (s: 'saving' | 'saved' | 'error') => {
    window.clearTimeout(slow.get(key));
    if (s === 'saving') {
      slow.set(
        key,
        window.setTimeout(() => useSaveState.setState({ [key]: 'saving' }), 600),
      );
      return;
    }
    slow.delete(key);
    useSaveState.setState({ [key]: s });
  };
}

function forgetSaveState(key: string) {
  window.clearTimeout(slow.get(key));
  slow.delete(key);
  useSaveState.setState((all) => {
    const next = { ...all };
    delete next[key];
    return next;
  }, true);
}

/** Close keeps the draft, as Gmail does. Files still on their way from Gmail are waited for, so the saved draft keeps them. */
export async function saveAndClose(draft: ComposeDraft) {
  flushEditors();
  const d = useUi.getState().composes.find((c) => c.key === draft.key) ?? draft;
  cancelDraftSave(d.key);
  useUi.getState().closeCompose(d.key);
  forgetSaveState(d.key);
  if (isEmptyDraft(d)) return;
  const reopen = () => useUi.getState().openCompose({ ...d, fetchingFiles: undefined });
  const full = await withFetchedFiles(d);
  // Saving without a file that didn't load would take it out of the draft; its snackbar has already said so.
  if (!full) return void reopen();
  scheduleDraftSave(
    full,
    (s) => {
      if (s === 'saved') snack('Draft saved');
      if (s === 'error') {
        reopen();
        snack("Couldn't save this draft. Close it again to retry.");
      }
    },
    0,
  );
}
