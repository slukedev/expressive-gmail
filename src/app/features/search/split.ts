import { updateSettings, useSettingsStore } from '../../state/settings';
import { snack } from '../../ui/Snackbar';

function isSavedSplit(query: string) {
  return useSettingsStore.getState().settings.splits.some((s) => s.query === query);
}

/** Named after its plain words. */
export function saveAsSplit(query: string) {
  if (isSavedSplit(query)) return;
  const name = query.replace(/\b\w+:/g, '').replace(/["()]/g, '').trim().slice(0, 24) || 'Saved search';
  updateSettings((s) => ({ splits: [...s.splits, { id: crypto.randomUUID().slice(0, 8), name: name[0].toUpperCase() + name.slice(1), query, icon: 'filter_alt' }] }));
  snack('Saved as a split. Find it under Splits in the menu.');
}
