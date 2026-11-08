import { UI_SCALES, uiScaleLabel } from '../../../shared/uiScale';
import { updateSettings, useSettings } from '../../state/settings';
import { ConnectedButtonGroup } from '../../ui/ButtonGroup';

const OPTIONS = UI_SCALES.map((s) => ({ value: String(s), label: uiScaleLabel(s) }));

export function UiScaleChoice({ size }: { size?: 'xs' | 's' }) {
  const scale = useSettings((s) => s.uiScale);
  return <ConnectedButtonGroup label="Interface size" size={size} value={String(scale)} onChange={(v) => updateSettings({ uiScale: Number(v) })} options={OPTIONS} />;
}
