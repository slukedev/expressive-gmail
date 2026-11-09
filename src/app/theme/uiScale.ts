import { useEffect } from 'react';
import { isPhone } from '../../shared/mobile';
import { setHostScale } from '../lib/host';
import { useSettingsStore } from '../state/settings';

// Only the host page can scale this frame. Phones stay at 100%: they already lay out at the phone's width.
const hosted = typeof window !== 'undefined' && window.parent !== window && !isPhone(navigator.userAgent);

export const uiScaleAvailable = () => hosted;

export function useHostUiScale() {
  const loaded = useSettingsStore((s) => s.loaded);
  const scale = useSettingsStore((s) => s.settings.uiScale);
  useEffect(() => {
    if (loaded && hosted) setHostScale(scale);
  }, [loaded, scale]);
}
