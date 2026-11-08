import { useState } from 'react';
import { UI_SCALES, uiScaleLabel } from '../../../shared/uiScale';
import { updateSettings, useSettings } from '../../state/settings';
import { ConnectedButtonGroup } from '../../ui/ButtonGroup';
import { Slider } from '../../ui/Slider';

const OPTIONS = UI_SCALES.map((s) => ({ value: String(s), label: uiScaleLabel(s) }));

export function UiScaleChoice({ size }: { size?: 'xs' | 's' }) {
  const scale = useSettings((s) => s.uiScale);
  return <ConnectedButtonGroup label="Interface size" size={size} value={String(scale)} onChange={(v) => updateSettings({ uiScale: Number(v) })} options={OPTIONS} />;
}

/** For narrow sheets. The zoom lands on release: applied mid-drag, it would resize the slider under the pointer. */
export function UiScaleSlider({ title }: { title: string }) {
  const scale = useSettings((s) => s.uiScale);
  const saved = Math.max(0, UI_SCALES.indexOf(scale as (typeof UI_SCALES)[number]));
  const [dragging, setDragging] = useState<number | null>(null);
  const at = dragging ?? saved;
  return (
    <div className="ui-scale-slider">
      <div className="ui-scale-slider__head">
        <h3 className="md-title-small qs-title">{title}</h3>
        <span className="md-label-large ui-scale-slider__value">{uiScaleLabel(UI_SCALES[at])}</span>
      </div>
      <Slider
        label={title}
        min={0}
        max={UI_SCALES.length - 1}
        step={1}
        stops
        value={at}
        valueText={(i) => uiScaleLabel(UI_SCALES[i])}
        onValueChange={setDragging}
        onValueCommitted={(i) => {
          setDragging(null);
          if (UI_SCALES[i] !== scale) updateSettings({ uiScale: UI_SCALES[i] });
        }}
      />
    </div>
  );
}
