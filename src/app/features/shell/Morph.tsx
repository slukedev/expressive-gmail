import { Component, type ReactNode, type RefObject } from 'react';
import { motionToken as token } from '../../ui/motion';

// Shared-element morph (FLIP) for the navigation rail: `data-morph="key"` elements are measured before React commits a layout change and animated from where they were.
// Default: translate by the change in centre. `data-morph-kind="text"`: a label changing layout fades in at its new place and drifts the last quarter, while a copy of the old one fades out with its icon; text is never scaled (a font-size change relayouts per frame).
// `data-morph-kind="size"`: width and height too (only the visible indicator). `data-morph-enter`: fades in a beat late with no previous position.
// `[data-morph-off]` and the main area are ignored; the main area moves as one piece by transform (see moveMain), so no frame lays out the list or reading pane. `data-morphing` lets CSS skip transitions nobody sees.

interface Shot {
  el: HTMLElement;
  r: DOMRect;
  font: number;
  /** So it can fade out if the same element changes layout. */
  ghost?: HTMLElement;
}
interface Snapshot {
  els: Map<string, Shot>;
  main: DOMRect | null;
}

const running = new WeakMap<Element, Animation[]>();
/** So an interruption can settle it first. */
let moving: { settle: () => void } | null = null;

const mainOf = (root: HTMLElement) => root.querySelector<HTMLElement>(':scope > .main');

function targets(root: HTMLElement): HTMLElement[] {
  const main = mainOf(root);
  return Array.from(root.querySelectorAll<HTMLElement>('[data-morph]')).filter(
    (el) =>
      !el.closest('[data-morph-off]') &&
      !main?.contains(el) &&
      (el.dataset.morphKind !== 'size' || !!el.closest('[data-active]')),
  );
}

// What a label's copy needs to look like the original once it no longer sits under the rules that styled it.
const LOOK = [
  'display', 'alignItems', 'gap', 'gridArea', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'fontVariationSettings',
  'fontVariantNumeric', 'letterSpacing', 'color', 'opacity', 'visibility', 'transform', 'textAlign', 'whiteSpace',
  'position', 'left', 'top', 'marginLeft',
] as const;

function ghostOf(el: HTMLElement, r: DOMRect): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')];
  const to = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  from.forEach((node, i) => {
    const cs = getComputedStyle(node);
    const st = to[i].style;
    for (const p of LOOK) st[p] = cs[p];
    st.transition = 'none';
    st.animation = 'none';
    to[i].removeAttribute('data-morph');
  });
  Object.assign(copy.style, { position: 'absolute', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0' });
  return copy;
}

/** In the rail's ghost layer. */
const ghosts = new Set<HTMLElement>();
const clearGhosts = () => {
  ghosts.forEach((g) => g.remove());
  ghosts.clear();
};

/** `ghosts` false skips the labels' copies, for a change that can't leave a label without its element (opening the modal rail). */
function capture(root: HTMLElement, ghosts = true): Snapshot {
  const els = new Map<string, Shot>();
  for (const el of targets(root)) {
    const key = el.dataset.morph!;
    if (els.has(key)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    const text = el.dataset.morphKind === 'text';
    els.set(key, { el, r, font: text ? parseFloat(getComputedStyle(el).fontSize) : 0, ghost: text && ghosts ? ghostOf(el, r) : undefined });
  }
  root.setAttribute('data-morphing', '');
  return { els, main: mainOf(root)?.getBoundingClientRect() ?? null };
}

const opaque = (color: string) => color !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(color);

/** Laid out once at its final size and translated from its old position; the trailing edge stays put. Wider (rail collapsing): a frame-coloured cover with inverse corners hides what pokes past. Narrower: an underlay in the pane's surface fills the gap. Views without a trailing surface move their leading edge with layout. The rail keeps the wider width until the move ends, clipped, so fading labels aren't cut off. */
function moveMain(root: HTMLElement, was: DOMRect, spatial: { duration: number; easing: string }) {
  const main = mainOf(root);
  const rail = root.querySelector<HTMLElement>(':scope > nav.rail');
  if (!main) return;
  const now = main.getBoundingClientRect();
  const dx = was.left - now.left;
  if (Math.abs(dx) < 0.5) return;

  // The reading pane, or a single-pane thread.
  let card: HTMLElement | null = null;
  let cardRect: DOMRect | null = null;
  for (const child of Array.from(main.children) as HTMLElement[]) {
    const r = child.getBoundingClientRect();
    if (r.width && (!cardRect || r.right > cardRect.right)) {
      card = child;
      cardRect = r;
    }
  }
  const cs = card ? getComputedStyle(card) : null;
  const railWidth = rail?.getBoundingClientRect().width ?? 0;

  const anims: Animation[] = [];
  const used: HTMLElement[] = [];
  if (card && cardRect && cs && opaque(cs.backgroundColor)) {
    const radius = parseFloat(cs.borderTopRightRadius) || 0;
    const gutter = Math.max(0, now.right - cardRect.right);
    // Shell keeps both pieces mounted (fixed, hidden): inserting or removing nodes in .app made WebKit restyle the app, 20ms on the last frame.
    const piece = root.querySelector<HTMLElement>(`:scope > .main-move[data-side="${dx > 0 ? 'over' : 'under'}"]`);
    if (piece) {
      Object.assign(piece.style, { visibility: 'visible', top: `${cardRect.top}px`, height: `${cardRect.height}px` });
      if (dx > 0) {
        const frame = 'var(--app-frame)';
        const inner = `transparent ${radius - 0.5}px, ${frame} ${radius + 0.5}px`;
        Object.assign(piece.style, {
          left: `${cardRect.right - radius}px`,
          width: `${gutter + radius}px`,
          backgroundImage: `linear-gradient(${frame}, ${frame}), radial-gradient(circle at 0 100%, ${inner}), radial-gradient(circle at 0 0, ${inner})`,
          backgroundSize: `${gutter}px 100%, ${radius}px ${radius}px, ${radius}px ${radius}px`,
          backgroundPosition: 'right top, left top, left bottom',
          backgroundRepeat: 'no-repeat',
        });
      } else {
        Object.assign(piece.style, {
          left: `${cardRect.right + dx - radius}px`,
          width: `${-dx + radius}px`,
          backgroundColor: cs.backgroundColor,
          borderRadius: `0 ${radius}px ${radius}px 0`,
        });
      }
      used.push(piece);
    }
    anims.push(main.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], spatial));
  } else {
    anims.push(main.animate([{ marginLeft: `${dx}px` }, { marginLeft: '0px' }], spatial));
  }

  if (rail) {
    const wide = Math.max(railWidth, railWidth + dx);
    // Clipped only beside the main area: the header stays whole so the brand can travel to the top bar.
    const top = now.top - rail.getBoundingClientRect().top;
    const edge = (x: number) => `polygon(0 0, 100% 0, 100% ${top}px, ${x}px ${top}px, ${x}px 100%, 0 100%)`;
    rail.style.width = `${wide}px`;
    anims.push(rail.animate([{ clipPath: edge(railWidth + dx) }, { clipPath: edge(railWidth) }], spatial));
  }

  const settle = () => {
    anims.forEach((a) => a.cancel());
    used.forEach((el) => el.removeAttribute('style'));
    if (rail) rail.style.width = '';
    if (moving === entry) moving = null;
  };
  const entry = { settle };
  moving = entry;
  anims[0].finished.then(settle, () => {});
}

function play(root: HTMLElement, snap: Snapshot, speed: 'fast' | 'default') {
  const spatial = token(speed === 'fast' ? '--md-sys-motion-spatial-fast' : '--md-sys-motion-spatial-default');
  const fade = token('--md-sys-motion-effects-default');
  const fadeOut = token('--md-sys-motion-effects-fast');
  const els = targets(root);
  // Cancel first, then read every rect, then write: one layout, no thrash.
  moving?.settle();
  clearGhosts();
  for (const el of els) running.get(el)?.forEach((a) => a.cancel());
  const now = els.map((el) => ({
    el,
    r: el.getBoundingClientRect(),
    font: el.dataset.morphKind === 'text' ? parseFloat(getComputedStyle(el).fontSize) : 0,
  }));
  const nowByKey = new Map<string, DOMRect>();
  for (const { el, r } of now) if (!nowByKey.has(el.dataset.morph!)) nowByKey.set(el.dataset.morph!, r);
  // Styles for the new layout are resolved; transitions are allowed again.
  root.removeAttribute('data-morphing');
  if (snap.main) moveMain(root, snap.main, spatial);
  for (const { el, r, font } of now) {
    const was = snap.els.get(el.dataset.morph!);
    if (!r.width && !r.height) continue;
    const anims: Animation[] = [];
    if (!was) {
      // After the old labels have mostly faded, so they never overlap.
      if ('morphEnter' in el.dataset) anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { ...fade, delay: 80, fill: 'backwards' }));
    } else if (el.dataset.morphKind === 'size') {
      const dx = was.r.left - r.left;
      const dy = was.r.top - r.top;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(was.r.width - r.width) + Math.abs(was.r.height - r.height) > 0.5) {
        anims.push(
          el.animate(
            [
              { transform: `translate(${dx}px, ${dy}px)`, width: `${was.r.width}px`, height: `${was.r.height}px` },
              { transform: 'none', width: `${r.width}px`, height: `${r.height}px` },
            ],
            spatial,
          ),
        );
      }
    } else {
      const dx = was.r.left + was.r.width / 2 - (r.left + r.width / 2);
      const dy = was.r.top + was.r.height / 2 - (r.top + r.height / 2);
      if (font && was.font && Math.abs(font - was.font) > 0.5) {
        // A label changing layout would cross its icon if it travelled; it fades in where it lands, drifting the last quarter.
        anims.push(el.animate([{ transform: `translate(${dx / 4}px, ${dy / 4}px)` }, { transform: 'none' }], spatial));
        anims.push(
          el.animate([{ opacity: 0 }, { opacity: 0, offset: 0.08 }, { opacity: 1, offset: 0.45 }], {
            duration: spatial.duration,
            easing: 'linear',
          }),
        );
        // The old label changed layout or left (More swaps elements): a copy fades out where it was. Opening the modal rail leaves the docked one in place, so not there.
        const gone = was.el === el || !was.el.isConnected;
        const layer = gone && was.ghost ? el.closest('nav')?.querySelector('.rail__ghosts') : null;
        if (layer && was.ghost) {
          const key = el.dataset.morph!.replace(/:text$/, ':icon');
          const iconWas = snap.els.get(key)?.r;
          const iconNow = nowByKey.get(key);
          const gx = iconWas && iconNow ? iconNow.left - iconWas.left : 0;
          const gy = iconWas && iconNow ? iconNow.top - iconWas.top : 0;
          const ghost = was.ghost;
          layer.append(ghost);
          ghosts.add(ghost);
          ghost.animate([{ transform: 'none' }, { transform: `translate(${gx}px, ${gy}px)` }], { ...spatial, fill: 'forwards' });
          ghost
            .animate([{ opacity: 1 }, { opacity: 0 }], { ...fadeOut, fill: 'forwards' })
            .finished.then(() => {
              ghost.remove();
              ghosts.delete(ghost);
            }, () => {});
        }
      } else if (Math.abs(dx) + Math.abs(dy) > 0.5) {
        anims.push(el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], spatial));
      }
    }
    if (anims.length) running.set(el, anims);
  }
}

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export class Morph extends Component<{
  state: string;
  speed: 'fast' | 'default';
  rootRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}> {
  override getSnapshotBeforeUpdate(prev: { state: string }): Snapshot | null {
    const root = this.props.rootRef.current;
    if (prev.state === this.props.state || !root || reduced() || typeof Element.prototype.animate !== 'function') return null;
    // Opening the modal rail leaves the docked one in place, so no label needs a copy.
    const opening = this.props.state.endsWith('|modal') && !prev.state.endsWith('|modal');
    return capture(root, !opening);
  }

  override componentDidUpdate(_prev: unknown, _state: unknown, snap: Snapshot | null) {
    const root = this.props.rootRef.current;
    if (snap && root) play(root, snap, this.props.speed);
  }

  override render() {
    return this.props.children;
  }
}
