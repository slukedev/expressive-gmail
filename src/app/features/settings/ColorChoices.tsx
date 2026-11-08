import { useEffect, useRef, type MouseEvent } from 'react';
import { Hct, argbFromHex } from '@material/material-color-utilities';
import { normalizeHex } from '../../theme/color';
import { isRandomTheme, rollTabRandom, updateSettings, useSettings } from '../../state/settings';
import { Icon } from '../../ui/Icon';
import { colorsFor } from '../wallpaper/Swatch';
import { usePictureChoice } from '../wallpaper/colors';

// The system picker reports every step of a drag, each a new theme and a settings write;
// follow at a pace storage and other tabs keep up with.
const STEP_MS = 80;
let pending = '';
let timer = 0;
let last = 0;
function follow(hex: string) {
  pending = hex;
  if (timer) return;
  timer = window.setTimeout(
    () => {
      timer = 0;
      last = performance.now();
      updateSettings({ themeSource: 'dynamic', seed: pending, customSeed: pending });
    },
    Math.max(0, last + STEP_MS - performance.now()),
  );
}

/** Opens the system picker the first time and while it's the theme; while a preset is in use, a click brings it back. */
function useCustomColor() {
  const custom = useSettings((s) => s.customSeed);
  const seed = useSettings((s) => s.seed);
  // A colour from your picture that was also kept as yours shows as the picture's.
  const picture = usePictureChoice();
  const selected = useSettings((s) => s.themeSource === 'dynamic' && !!s.customSeed && s.seed === s.customSeed) && !picture?.selected;
  const ref = useRef<HTMLInputElement>(null);
  const start = custom || seed;
  // Left uncontrolled so a value React writes back mid-drag can't pull the picker; kept in step otherwise.
  // Safari and Firefox on a Mac don't focus the input while its panel is open, so a drag is tracked here too.
  const picking = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => {
      picking.current = false;
    };
    el.addEventListener('change', done);
    el.addEventListener('blur', done);
    return () => {
      el.removeEventListener('change', done);
      el.removeEventListener('blur', done);
    };
  }, []);
  useEffect(() => {
    if (ref.current && !picking.current && !timer && document.activeElement !== ref.current) ref.current.value = start;
  }, [start]);
  const label = !custom ? 'Pick your own color' : selected ? 'Change your color' : 'Your color';
  return {
    custom,
    selected,
    label,
    input: (
      <input
        ref={ref}
        type="color"
        defaultValue={start}
        aria-label={label}
        onClick={(e: MouseEvent<HTMLInputElement>) => {
          if (!custom || selected) return;
          e.preventDefault();
          updateSettings({ themeSource: 'dynamic', seed: custom });
        }}
        onChange={(e) => {
          picking.current = true;
          const hex = normalizeHex(e.target.value);
          if (hex) follow(hex);
        }}
      />
    ),
  };
}

const useRandomInUse = () => useSettings((s) => (isRandomTheme(s) ? s.seed : ''));

/** In use, it shows the shuffle mark in place of the check, since a click rolls again. */
export function RandomSwatch() {
  const seed = useRandomInUse();
  const colors = seed ? colorsFor(seed) : null;
  const label = seed ? 'Another random color' : 'Random color';
  return (
    <button type="button" className="swatch-wallpaper" aria-pressed={!!seed} aria-label={label} title={label} onClick={rollTabRandom}>
      {colors ? (
        <span className="swatch-wallpaper__disc">
          <span style={{ background: colors[0] }} />
          <span style={{ background: colors[1] }} />
          <span style={{ background: colors[2] }} />
        </span>
      ) : (
        <span className="swatch-wallpaper__disc swatch-wallpaper__disc--shuffle">
          <Icon name="shuffle" size={18} />
        </span>
      )}
      {seed && (
        <span key={seed} className="swatch-wallpaper__check">
          <Icon name="shuffle" size={14} weight={500} className="shuffle-turn" />
        </span>
      )}
    </button>
  );
}

export function CustomSwatch() {
  const { custom, selected, label, input } = useCustomColor();
  const colors = custom ? colorsFor(custom) : null;
  return (
    <label className="swatch-wallpaper swatch-wallpaper--custom" data-selected={selected || undefined} title={label}>
      {colors ? (
        <span className="swatch-wallpaper__disc">
          <span style={{ background: colors[0] }} />
          <span style={{ background: colors[1] }} />
          <span style={{ background: colors[2] }} />
        </span>
      ) : (
        <span className="swatch-wallpaper__disc swatch-wallpaper__disc--any">
          <Icon name="palette" size={18} />
        </span>
      )}
      {input}
      {selected && (
        <span className="swatch-wallpaper__check">
          <Icon name="check" size={16} weight={500} />
        </span>
      )}
    </label>
  );
}

export function RandomSeedDot() {
  const seed = useRandomInUse();
  const label = seed ? 'Another random color' : 'Random color';
  const light = !!seed && Hct.fromInt(argbFromHex(seed)).tone > 60;
  return (
    <button
      type="button"
      className={seed ? 'seed-dot' : 'seed-dot seed-dot--shuffle'}
      aria-pressed={!!seed}
      aria-label={label}
      title={label}
      data-light={light || undefined}
      style={seed ? { background: seed } : undefined}
      onClick={rollTabRandom}
    >
      <Icon key={seed} name="shuffle" size={16} weight={seed ? 500 : undefined} className={seed ? 'shuffle-turn' : undefined} />
    </button>
  );
}

export function CustomSeedDot() {
  const { custom, selected, label, input } = useCustomColor();
  const light = !!custom && Hct.fromInt(argbFromHex(custom)).tone > 60;
  return (
    <label
      className={custom ? 'seed-dot seed-dot--mine' : 'seed-dot seed-dot--custom'}
      data-selected={selected || undefined}
      data-light={light || undefined}
      style={custom ? { background: custom } : undefined}
      title={label}
    >
      {input}
      <Icon name={selected ? 'check' : 'palette'} size={16} weight={selected ? 500 : undefined} />
    </label>
  );
}
