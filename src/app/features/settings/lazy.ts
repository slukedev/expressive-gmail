import { preloadable } from '../../warmup';
import { useUi } from '../../state/ui';
import { snack } from '../../ui/Snackbar';

export const SettingsDialog = preloadable(() => import('./SettingsDialog').then((m) => m.SettingsDialog));

/** Quick settings stays up until Settings' code is in, so one backdrop hands over to the other without a flash. */
export async function openAllSettings() {
  try {
    await SettingsDialog.load();
  } catch {
    snack('Settings didn’t load. Check your connection, or reload Gmail.');
    return;
  }
  useUi.getState().set({ quickSettings: false, settingsSection: 'general' });
}
