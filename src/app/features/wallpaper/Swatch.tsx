import { hexFromArgb } from '@material/material-color-utilities';
import { buildScheme } from '../../theme/color';
import { Icon } from '../../ui/Icon';

// A scheme per swatch is a few ms of colour solving; seeds repeat.
const swatchColors = new Map<string, string[]>();
/** Solved once per seed (warmup.tsx solves the presets ahead). */
export function colorsFor(seed: string): string[] {
  let colors = swatchColors.get(seed);
  if (!colors) {
    const s = buildScheme({ seed, variant: 'tonal-spot', dark: false, contrast: 0 });
    colors = [hexFromArgb(s.primary), hexFromArgb(s.secondaryContainer), hexFromArgb(s.tertiaryContainer)];
    swatchColors.set(seed, colors);
  }
  return colors;
}

/** Android's wallpaper-picker colour option: a disc of primary, secondary and tertiary. With `photo`, the picture's own colours and the picture in the corner until picked. */
export function Swatch({
  seed,
  selected,
  label,
  onClick,
  google,
  photo,
}: {
  seed: string;
  selected: boolean;
  label: string;
  onClick: () => void;
  google?: boolean;
  photo?: { url: string; colors: string[] };
}) {
  const colors = google ? ['#0b57d0', '#c2e7ff', '#d3e3fd'] : photo ? [0, 1, 2].map((i) => photo.colors[i] ?? photo.colors[0]!) : colorsFor(seed);
  return (
    <button type="button" className="swatch-wallpaper" aria-pressed={selected} aria-label={label} title={label} onClick={onClick}>
      <span className="swatch-wallpaper__disc">
        <span style={{ background: colors[0] }} />
        <span style={{ background: colors[1] }} />
        <span style={{ background: colors[2] }} />
      </span>
      {photo && !selected && <img className="swatch-wallpaper__photo" src={photo.url} alt="" referrerPolicy="no-referrer" />}
      {selected && (
        <span className="swatch-wallpaper__check">
          <Icon name="check" size={16} weight={500} />
        </span>
      )}
    </button>
  );
}
