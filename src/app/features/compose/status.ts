import { create } from 'zustand';
import { useUi, type ComposeDraft } from '../../state/ui';
import { snack } from '../../ui/Snackbar';
import { cancelDraftSave, isEmptyDraft, scheduleDraftSave } from './send';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export const useSaveState = create<Record<string, SaveState>>(() => ({}));

const slow = new Map<string, number>();

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

/** Close keeps the draft, as Gmail does. */
export function saveAndClose(d: ComposeDraft) {
  cancelDraftSave(d.key);
  useUi.getState().closeCompose(d.key);
  forgetSaveState(d.key);
  if (!isEmptyDraft(d)) {
    scheduleDraftSave(d, () => undefined, 0);
    snack('Draft saved');
  }
}
