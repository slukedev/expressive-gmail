import { useMemo } from 'react';
import { updateSettings, useSettings } from '../../state/settings';
import { resolveSidebar, type SidebarPrefs } from './sidebarLayout';

export function useSidebar(): SidebarPrefs {
  const stored = useSettings((s) => s.sidebar);
  return useMemo(() => resolveSidebar(stored), [stored]);
}

export function updateSidebar(change: (prefs: SidebarPrefs) => SidebarPrefs) {
  updateSettings((s) => ({ sidebar: change(resolveSidebar(s.sidebar)) }));
}
