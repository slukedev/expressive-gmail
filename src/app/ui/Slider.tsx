import { Slider as BaseSlider } from '@base-ui/react/slider';
import type { CSSProperties } from 'react';
import { cx } from './Button';

/** M3 Expressive standard slider: a 16 dp track split by a 4 x 44 dp handle with 6 dp gaps, and a stop dot at the end. */
export function Slider({
  value,
  onValueChange,
  onValueCommitted,
  min = 0,
  max = 100,
  step = 1,
  label,
  valueText,
  className,
}: {
  value: number;
  onValueChange: (value: number) => void;
  onValueCommitted?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  valueText?: (value: number) => string;
  className?: string;
}) {
  const share = max > min ? (value - min) / (max - min) : 0;
  return (
    <BaseSlider.Root
      className={cx('m3-slider', className)}
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(v as number)}
      onValueCommitted={onValueCommitted && ((v) => onValueCommitted(v as number))}
      style={{ '--slider-at': share } as CSSProperties}
    >
      <BaseSlider.Control className="m3-slider__control">
        <BaseSlider.Track className="m3-slider__track">
          <span className="m3-slider__active" />
          <span className="m3-slider__inactive" />
          <BaseSlider.Thumb className="m3-slider__handle" getAriaLabel={() => label} getAriaValueText={valueText && ((_, v) => valueText(v))} />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
