export interface MotionToken {
  duration: number;
  easing: string;
}

// Reading a token after a DOM change forces a style recalc of the whole document, so each is read once, ideally at idle, never mid-animation.
const tokens = new Map<string, MotionToken>();

/** For the Web Animations API ("300ms linear(...)"). */
export function motionToken(name: string): MotionToken {
  let t = tokens.get(name);
  if (!t) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const m = /^([\d.]+)ms\s+(.+)$/s.exec(raw);
    t = m ? { duration: Number(m[1]), easing: m[2] } : { duration: 300, easing: 'ease-out' };
    // An empty read means the stylesheet hasn't applied yet.
    if (m) tokens.set(name, t);
  }
  return t;
}

const NAMES = ['spatial-fast', 'spatial-default', 'spatial-slow', 'effects-fast', 'effects-default', 'effects-slow'];

/** One style pass, before anything animates. */
export function warmMotionTokens() {
  for (const n of NAMES) motionToken(`--md-sys-motion-${n}`);
}

/** For keyframes sampled by hand: the springs are CSS linear() curves. Anything else is straight progress. */
export function easingFn(easing: string): (t: number) => number {
  const m = /^linear\((.*)\)$/s.exec(easing.trim());
  if (!m) return (t) => t;
  const stops: [number, number][] = [];
  const parts = m[1].split(',').map((p) => p.trim().split(/\s+/));
  parts.forEach((p, i) => {
    const v = Number(p[0]);
    const at = p[1] ? Number(p[1].replace('%', '')) / 100 : i === 0 ? 0 : i === parts.length - 1 ? 1 : NaN;
    stops.push([at, v]);
  });
  // Stops without a position sit evenly between their neighbours (CSS linear()).
  for (let i = 1; i < stops.length - 1; i++) {
    if (!Number.isNaN(stops[i][0])) continue;
    let j = i;
    while (Number.isNaN(stops[j][0])) j++;
    const from = stops[i - 1][0];
    for (let k = i; k < j; k++) stops[k][0] = from + ((stops[j][0] - from) * (k - i + 1)) / (j - i + 1);
  }
  return (t) => {
    if (t <= 0) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [x1, y1] = stops[i];
      if (t <= x1) {
        const [x0, y0] = stops[i - 1];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (t - x0)) / (x1 - x0);
      }
    }
    return stops[stops.length - 1][1];
  };
}

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
