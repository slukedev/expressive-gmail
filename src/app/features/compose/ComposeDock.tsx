import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useUi, type ComposeDraft } from '../../state/ui';
import { IconButton } from '../../ui/Button';
import { easingFn, motionToken, reducedMotion } from '../../ui/motion';
import { ComposeForm } from './ComposeForm';
import { SaveStatus } from './SaveStatus';
import { handoff, rememberBox } from './handoff';
import { loadComposeData } from './signatures';
import { saveAndClose } from './status';

const TITLES = { new: 'New message', reply: 'Reply', 'reply-all': 'Reply all', forward: 'Forward' };

/** They match .compose-window in compose.css. */
const OPEN_W = 560;
const MIN_W = 280;
const GAP = 16;
const BAR_H = 56;

/** So the dock keeps the window you're on open. */
const touched = new Map<string, number>();
/** So making room folds a window down the way its button does. */
const folders = new Map<string, (then?: () => void) => void>();

/** When the row has no room, the least recently used window folds to its bar while this one unfolds. */
function restoreWithRoom(key: string) {
  const ui = useUi.getState();
  const restore = () => {
    touched.set(key, Date.now());
    useUi.getState().updateCompose(key, { window: 'open' });
  };
  const docked = ui.composes.filter((c) => !c.inline && c.window !== 'full');
  const width = docked.reduce((n, d, i) => n + (d.window === 'open' || d.key === key ? OPEN_W : MIN_W) + (i ? GAP : 0), 0);
  const other = docked.filter((d) => d.window === 'open' && d.key !== key).sort((a, b) => (touched.get(a.key) ?? 0) - (touched.get(b.key) ?? 0))[0];
  const fold = other && folders.get(other.key);
  // Both at once: the fold gives up its room straight away, and this one opens first so the row never narrows for a frame and drops its scroll.
  flushSync(restore);
  if (width > window.innerWidth - 2 * GAP && fold) fold();
}
let lastOutside: HTMLElement | null = null;

/** A still, inert copy of a surface over the app at its box, for one hand-off. */
function pin(ghost: HTMLElement, rect: DOMRect, z: number) {
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.setAttribute('data-ghost', '');
  ghost.removeAttribute('data-key');
  Object.assign(ghost.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    translate: 'none',
    transform: 'none',
    transition: 'none',
    animation: 'none',
    zIndex: String(z),
    pointerEvents: 'none',
  });
  document.body.append(ghost);
  return ghost;
}

/** Container transform between the docked window and the full screen page, never scaling anything. Growing, the page is revealed from the docked box while a copy of the window fades off it; shrinking, a copy of the page folds onto the window. Only the first frame lays anything out; the rest is clip and opacity. */
function useHandoff(key: string) {
  const done = useRef(false);
  return useCallback(
    (el: HTMLElement | null) => {
      const from = handoff.get(key);
      if (!el || !from || done.current) return;
      done.current = true;
      handoff.delete(key);
      if (reducedMotion()) return;
      const to = el.getBoundingClientRect();
      if (!to.width || !to.height) return;
      const { duration, easing } = motionToken('--md-sys-motion-spatial-default');
      const quick = motionToken('--md-sys-motion-effects-fast');
      const fade = motionToken('--md-sys-motion-effects-default');
      const r = from.rect;
      const insetOf = (a: DOMRect, b: DOMRect) => `${a.top - b.top}px ${b.right - a.right}px ${b.bottom - a.bottom}px ${a.left - b.left}px`;
      el.style.animation = 'none';
      const grows = r.width <= to.width && r.height <= to.height;
      if (grows) {
        el.animate([{ clipPath: `inset(${insetOf(r, to)} round 28px 28px 0px 0px)` }, { clipPath: 'inset(-32px round 60px)' }], { duration, easing });
        for (const child of parts(el)) child.animate([{ opacity: 0 }, { opacity: 0, offset: 0.2 }, { opacity: 1 }], { duration: fade.duration + 120, easing: fade.easing });
        // The window's words fade off where they were, so it never blinks empty.
        const ghost = pin(from.ghost, r, 802);
        ghost.style.boxShadow = 'none';
        ghost.animate([{ opacity: 1 }, { opacity: 0 }], { ...quick, fill: 'forwards' }).finished.then(() => ghost.remove(), () => ghost.remove());
        return;
      }
      // The holder covers both boxes: on a wide window the docked one reaches past the page.
      const u = new DOMRect(Math.min(r.left, to.left), Math.min(r.top, to.top), 0, 0);
      const box = { right: Math.max(r.right, to.right), bottom: Math.max(r.bottom, to.bottom) };
      const holder = document.createElement('div');
      holder.setAttribute('data-ghost', '');
      holder.setAttribute('aria-hidden', 'true');
      Object.assign(holder.style, { position: 'fixed', left: `${u.left}px`, top: `${u.top}px`, width: `${box.right - u.left}px`, height: `${box.bottom - u.top}px`, zIndex: '802', pointerEvents: 'none' });
      const ghost = pin(from.ghost, r, 0);
      Object.assign(ghost.style, { position: 'absolute', left: `${r.left - u.left}px`, top: `${r.top - u.top}px`, zIndex: '' });
      holder.append(ghost);
      document.body.append(holder);
      const scrim = from.scrim ? pin(from.scrim, new DOMRect(0, 0, window.innerWidth, window.innerHeight), 801) : null;
      const veil = document.createElement('span');
      veil.className = 'compose-window__veil';
      Object.assign(veil.style, { background: 'var(--compose-bg)', zIndex: '5' });
      ghost.append(veil);
      veil.animate([{ opacity: 0 }, { opacity: 1 }], { ...quick, fill: 'forwards' });
      // Fold and fade are one effect sampled by hand: Safari runs a clip on the main thread and a fade off it, so as two animations a busy frame let the fade run ahead.
      const spring = easingFn(easing);
      const W = box.right - u.left;
      const H = box.bottom - u.top;
      const edges = (b: { left: number; top: number; right: number; bottom: number }, grow: number) => [b.top - u.top - grow, W - (b.right - u.left) - grow, H - (b.bottom - u.top) - grow, b.left - u.left - grow];
      const a = edges(r, 32);
      const b = edges(to, 0);
      const frames: Keyframe[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const p = spring(t);
        const [top, right, bottom, left] = a.map((v, k) => v + (b[k] - v) * p);
        const outer = 60 + (28 - 60) * p;
        const lower = 60 + (0 - 60) * p;
        frames.push({
          offset: t,
          clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px round ${outer}px ${outer}px ${Math.max(0, lower)}px ${Math.max(0, lower)}px)`,
          opacity: t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6,
        });
      }
      const out = holder.animate(frames, { duration, easing: 'linear', fill: 'forwards' });
      scrim?.animate([{ opacity: 1 }, { opacity: 0 }], { ...fade, fill: 'forwards' });
      const clear = () => {
        holder.remove();
        scrim?.remove();
      };
      out.finished.then(clear, clear);
    },
    [key],
  );
}

function close(d: ComposeDraft) {
  saveAndClose(d);
  if (lastOutside?.isConnected && !document.activeElement?.closest('.compose-window, .compose-full, .inline-compose')) lastOutside.focus({ preventScroll: true });
}

// Open, the clip reaches past the edges so the shadow shows; at the bar it is exact.
const clipFull = 'inset(-24px -24px 0px -24px round 52px 52px 0px 0px)';
const clipBar = (w: number, h: number) => `inset(${h - BAR_H}px 0px 0px ${Math.max(0, w - MIN_W)}px round 28px 28px 0px 0px)`;

/** Fades a sheet of the bar's colour over the contents. Fading the form itself made Safari paint it into a new layer on each window's first fold: a sharp stutter. */
function veil(node: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions): Animation[] {
  const sheet = node.querySelector(':scope > .compose-window__veil');
  return sheet ? [sheet.animate(keyframes, options)] : [];
}

/** Looking through the wrapper that has no box of its own. */
function parts(node: Element): Element[] {
  return [...node.children].flatMap((c) => (c.classList.contains('compose-window__body') ? [...c.children] : [c]));
}

/** A clip on the spatial spring plus fades, so nothing is laid out per frame. Minimizing holds the open layout until the fold finishes, then swaps to the bar. */
function useFold(el: React.RefObject<HTMLElement | null>, state: ComposeDraft['window']) {
  const prev = useRef(state);
  const running = useRef<Animation[]>([]);
  const stop = () => {
    running.current.forEach((a) => a.cancel());
    running.current = [];
  };

  // Restore: the open window is laid out already; unfold it from the bar.
  useLayoutEffect(() => {
    const was = prev.current;
    prev.current = state;
    const node = el.current;
    if (!node || was !== 'minimized' || state !== 'open' || reducedMotion()) return;
    stop();
    const { width, height } = node.getBoundingClientRect();
    const { duration, easing } = motionToken('--md-sys-motion-spatial-default');
    const fade = motionToken('--md-sys-motion-effects-default');
    const style = getComputedStyle(node);
    running.current = [
      node.animate(
        [
          { clipPath: clipBar(width, height), backgroundColor: style.getPropertyValue('--compose-bar-bg').trim() || style.backgroundColor },
          { clipPath: clipFull, backgroundColor: style.backgroundColor },
        ],
        { duration, easing },
      ),
      ...veil(node, [{ opacity: 1 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: fade.duration + 120, easing: fade.easing }),
    ];
  }, [el, state]);

  useEffect(() => stop, []);

  return useCallback(
    (done: () => void) => {
      const node = el.current;
      // Asked again before the state caught up.
      if (node?.hasAttribute('data-folding')) return;
      if (!node || reducedMotion()) return done();
      stop();
      node.setAttribute('data-folding', '');
      const { width, height } = node.getBoundingClientRect();
      // The same spring as the windows sliding beside it, so everything lands together.
      const { duration, easing } = motionToken('--md-sys-motion-spatial-default');
      const fade = motionToken('--md-sys-motion-effects-fast');
      const style = getComputedStyle(node);
      // It gives up its room at once: its left part hangs over its neighbour while it folds to its right corner, so a window beside it moves now, not after.
      node.style.marginLeft = `${parseFloat(style.marginLeft) - (width - MIN_W)}px`;
      node.style.zIndex = '0';
      if (node.parentElement) slideRow(node.parentElement);
      const fold = node.animate(
        [
          { clipPath: clipFull, backgroundColor: style.backgroundColor },
          { clipPath: clipBar(width, height), backgroundColor: style.getPropertyValue('--compose-bar-bg').trim() || style.backgroundColor },
        ],
        { duration, easing, fill: 'forwards' },
      );
      running.current = [fold, ...veil(node, [{ opacity: 0 }, { opacity: 1 }], { ...fade, fill: 'forwards' })];
      fold.onfinish = () => {
        // Same frame, so the bar never blinks.
        node.style.marginLeft = '';
        node.style.zIndex = '';
        node.removeAttribute('data-folding');
        flushSync(done);
        stop();
        el.current?.firstElementChild?.animate([{ opacity: 0 }, { opacity: 1 }], fade);
      };
    },
    [el],
  );
}

const WARM_DRAFT: ComposeDraft = { key: 'warm', mode: 'new', to: [], cc: [], bcc: [], subject: '', html: '', attachments: [], window: 'open' };
const WARM_FULL: ComposeDraft = { ...WARM_DRAFT, key: 'warm-full', window: 'full' };
let warmed = false;

function idle(fn: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(fn, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 1500);
  return () => window.clearTimeout(id);
}

/** The first compose of a session spent its opening frame compiling code, styles and layout, and the first full screen did it again. An inert, invisible window and page mounted while idle do that ahead of time. */
function ComposeWarmup() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (warmed) return;
    if (!on) return idle(() => setOn(true));
    warmed = true;
    return idle(() => setOn(false));
  }, [on]);
  if (!on) return null;
  return (
    <div className="compose-warmup" inert aria-hidden>
      <section className="compose-window">
        <Header draft={WARM_DRAFT} />
        <ComposeForm draft={WARM_DRAFT} variant="window" />
      </section>
      <section className="compose-full">
        <Header draft={WARM_FULL} full />
        <ComposeForm draft={WARM_FULL} variant="full" />
      </section>
    </div>
  );
}

/** When the open windows don't fit, the least recently used fold to their bars. */
function useFit(docked: ComposeDraft[]) {
  // Before paint, so a window folding to make room moves in the same frame as the one opening.
  useLayoutEffect(() => {
    const fit = () => {
      const room = window.innerWidth - 2 * GAP;
      const widths = (list: ComposeDraft[]) => list.reduce((n, d, i) => n + (d.window === 'minimized' ? MIN_W : OPEN_W) + (i ? GAP : 0), 0);
      let list = docked;
      const open = docked.filter((d) => d.window === 'open').sort((a, b) => (touched.get(a.key) ?? 0) - (touched.get(b.key) ?? 0));
      while (open.length > 1 && widths(list) > room) {
        const oldest = open.shift()!;
        list = list.map((d) => (d.key === oldest.key ? { ...d, window: 'minimized' as const } : d));
        const fold = folders.get(oldest.key);
        if (fold) fold();
        else useUi.getState().updateCompose(oldest.key, { window: 'minimized' });
      }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [docked]);
}

/** Each window's right edge (it folds to and from its bar at its right corner), and the row's scroll then. */
const rowRights = new Map<string, number>();
let rowScrolled = 0;

/** FLIP from where each window was on screen, so when the row also scrolled everything moves together instead of jumping. */
function slideRow(node: HTMLElement) {
  const { duration, easing } = motionToken('--md-sys-motion-spatial-default');
  const seen = new Set<string>();
  for (const w of node.querySelectorAll<HTMLElement>(':scope > .compose-window')) {
    const key = w.dataset.key!;
    const right = w.offsetLeft + w.offsetWidth;
    const was = rowRights.get(key);
    const moved = was === undefined ? 0 : was - rowScrolled - (right - node.scrollLeft);
    if (Math.abs(moved) > 1 && !reducedMotion()) {
      w.animate([{ translate: `${moved}px 0` }, { translate: '0 0' }], { duration, easing, composite: 'add' });
    }
    rowRights.set(key, right);
    seen.add(key);
  }
  for (const key of [...rowRights.keys()]) if (!seen.has(key)) rowRights.delete(key);
  rowScrolled = node.scrollLeft;
}

function useSlide(dock: React.RefObject<HTMLDivElement | null>, deps: unknown) {
  useEffect(() => {
    const node = dock.current;
    if (!node) return;
    const read = () => (rowScrolled = node.scrollLeft);
    node.addEventListener('scroll', read, { passive: true });
    return () => node.removeEventListener('scroll', read);
  }, [dock, deps]);
  useLayoutEffect(() => {
    if (dock.current) slideRow(dock.current);
    else rowRights.clear();
  }, [dock, deps]);
}

/** A mouse wheel over the title bars moves along the row, and the row never scrolls up, which focusing a field could otherwise do. */
function useSideways(dock: React.RefObject<HTMLDivElement | null>, shown: boolean) {
  useEffect(() => {
    const node = dock.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || node.scrollWidth <= node.clientWidth) return;
      if (!(e.target as Element).closest?.('.compose-window__bar')) return;
      e.preventDefault();
      node.scrollLeft += e.deltaY;
    };
    const onScroll = () => {
      if (node.scrollTop) node.scrollTop = 0;
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('scroll', onScroll);
    };
  }, [dock, shown]);
}

export function ComposeDock({ compact }: { compact: boolean }) {
  const composes = useUi(useShallow((s) => s.composes.filter((c) => !c.inline)));
  const full = composes.find((c) => c.window === 'full' || compact);
  const docked = useMemo(() => composes.filter((c) => c !== full), [composes, full]);
  const dock = useRef<HTMLDivElement>(null);

  useEffect(() => void loadComposeData(), []);
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      const box = t.closest?.<HTMLElement>('.compose-window, .compose-full');
      if (box?.dataset.key) touched.set(box.dataset.key, Date.now());
      else if (!t.closest?.('.inline-compose, .m3-menu-positioner, [role="dialog"]')) lastOutside = t;
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);
  // A window just opened or restored counts as the one you're using.
  for (const d of docked) if (d.window === 'open' && !touched.has(d.key)) touched.set(d.key, Date.now());
  useFit(docked);

  // A closed or sent window stays a moment to animate out.
  const [prev, setPrev] = useState(docked);
  const [leaving, setLeaving] = useState<{ draft: ComposeDraft; at: number }[]>([]);
  if (prev !== docked) {
    const gone = prev.flatMap((d, at) => (composes.some((c) => c.key === d.key) ? [] : [{ draft: d, at }]));
    setPrev(docked);
    if (gone.length) setLeaving((l) => [...l, ...gone]);
  }
  useEffect(() => {
    if (!leaving.length) return;
    const t = window.setTimeout(() => setLeaving([]), 240);
    return () => window.clearTimeout(t);
  }, [leaving]);
  const shown = [...docked];
  for (const { draft, at } of leaving) if (!shown.some((d) => d.key === draft.key)) shown.splice(Math.min(at, shown.length), 0, draft);
  useSlide(dock, shown.map((d) => `${d.key}:${d.window}`).join());
  useSideways(dock, shown.length > 0);

  return (
    <>
      {shown.length > 0 && (
        <div className="compose-dock" ref={dock} aria-label="Compose windows">
          {shown.map((d) => (
            <ComposeWindow key={d.key} draft={d} leaving={!docked.includes(d)} />
          ))}
        </div>
      )}
      {full && <FullCompose draft={full} compact={compact} />}
      {!composes.length && <ComposeWarmup />}
    </>
  );
}

function Header({ draft, full, compact, onMinimize }: { draft: ComposeDraft; full?: boolean; compact?: boolean; onMinimize?: () => void }) {
  const update = (patch: Partial<ComposeDraft>) => useUi.getState().updateCompose(draft.key, patch);
  const title = draft.subject.trim() || TITLES[draft.mode];
  const minimized = draft.window === 'minimized';
  const toggle = () => {
    if (minimized) restoreWithRoom(draft.key);
    else onMinimize?.();
  };
  return (
    <header className="compose-window__bar" onClick={() => minimized && toggle()} onDoubleClick={() => !full && !minimized && toggle()}>
      <h2 className="compose-window__title">{title}</h2>
      {!minimized && <SaveStatus draftKey={draft.key} />}
      <span className="compose-window__controls" onClick={(e) => e.stopPropagation()}>
        {!full && <IconButton icon={minimized ? 'keyboard_arrow_up' : 'minimize'} label={minimized ? 'Restore' : 'Minimize'} aria-expanded={!minimized} onClick={toggle} />}
        {/* Phones are always full screen. */}
        {!compact && !minimized && (
          <IconButton
            icon={full ? 'close_fullscreen' : 'open_in_full'}
            label={full ? 'Exit full screen' : 'Full screen'}
            onClick={(e) => {
              rememberBox(draft.key, e.currentTarget);
              update({ window: full ? 'open' : 'full' });
            }}
          />
        )}
        <IconButton icon="close" label="Save and close" aria-keyshortcuts="Escape" onClick={() => close(draft)} />
      </span>
    </header>
  );
}

/** Left alone when only the window around it changes: rendering a whole form at the start and end of a fold made the first one stutter. */
const WindowForm = memo(
  function WindowForm({ draft, onEscape }: { draft: ComposeDraft; onEscape: () => void }) {
    return <ComposeForm draft={draft} variant="window" onEscape={onEscape} />;
  },
  (a, b) => a.onEscape === b.onEscape && (Object.keys(b.draft) as (keyof ComposeDraft)[]).every((k) => k === 'window' || a.draft[k] === b.draft[k]) && Object.keys(a.draft).length === Object.keys(b.draft).length,
);

function ComposeWindow({ draft, leaving }: { draft: ComposeDraft; leaving?: boolean }) {
  const handoffRef = useHandoff(draft.key);
  const el = useRef<HTMLElement | null>(null);
  const ref = useCallback(
    (node: HTMLElement | null) => {
      el.current = node;
      handoffRef(node);
    },
    [handoffRef],
  );
  const fold = useFold(el, draft.window);
  const [folding, setFolding] = useState(false);
  // Sideways only: scrollIntoView would also scroll the dock up, lifting every window off the bottom edge.
  useLayoutEffect(() => {
    const node = el.current;
    const dock = node?.parentElement;
    if (draft.window !== 'open' || leaving || !node || !dock) return;
    const from = node.offsetLeft - GAP;
    const to = node.offsetLeft + node.offsetWidth + GAP - dock.clientWidth;
    const left = dock.scrollLeft > from ? from : dock.scrollLeft < to ? to : null;
    // At once: the dock's slide animates every window from where it was, scroll included.
    if (left !== null) dock.scrollLeft = left;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.window]);
  // Restored, focus goes where writing goes on: To until it has someone, then the message.
  const was = useRef(draft.window);
  useEffect(() => {
    const restored = was.current === 'minimized' && draft.window === 'open';
    was.current = draft.window;
    if (!restored || !el.current?.contains(document.activeElement)) return;
    const target = draft.to.length ? el.current.querySelector<HTMLElement>('[contenteditable="true"]') : el.current.querySelector<HTMLElement>('input[role="combobox"]');
    target?.focus({ preventScroll: true });
  }, [draft.window, draft.to.length]);
  // A closing window turns inert, and Chromium drops keys aimed at focus left inside it, so the next shortcut (c right after Escape) would do nothing.
  useLayoutEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!leaving || !active || !el.current?.contains(active)) return;
    if (lastOutside?.isConnected && !lastOutside.closest('.compose-window, .compose-full, .inline-compose')) lastOutside.focus({ preventScroll: true });
    else active.blur();
  }, [leaving]);
  // A closing window gives up its room at once, so the others slide over while it leaves.
  useLayoutEffect(() => {
    const node = el.current;
    if (!leaving || !node?.parentElement) return;
    node.style.marginLeft = `${parseFloat(getComputedStyle(node).marginLeft) - node.offsetWidth - GAP}px`;
    node.style.zIndex = '0';
    slideRow(node.parentElement);
  }, [leaving]);
  const minimize = (then?: () => void) => {
    if (folding) return;
    const hadFocus = !!el.current?.contains(document.activeElement);
    setFolding(true);
    fold(() => {
      setFolding(false);
      useUi.getState().updateCompose(draft.key, { window: 'minimized' });
      then?.();
    });
    // Folded, the window keeps focus on its Restore button.
    if (hadFocus) requestAnimationFrame(function wait() {
      const restore = el.current?.querySelector<HTMLButtonElement>('button[aria-label="Restore"]');
      if (restore) restore.focus({ preventScroll: true });
      else if (el.current) requestAnimationFrame(wait);
    });
  };
  const escape = useCallback(() => {
    const now = useUi.getState().composes.find((c) => c.key === draft.key);
    if (now) close(now);
  }, [draft.key]);
  useEffect(() => {
    folders.set(draft.key, minimize);
    return () => void folders.delete(draft.key);
  });
  return (
    <section
      ref={ref}
      className="compose-window"
      data-key={draft.key}
      data-state={draft.window}
      data-leaving={leaving || undefined}
      // Not inert while folding: that restyles a whole compose form, a spike on the first fold.
      inert={leaving || undefined}
      data-busy={folding || undefined}
      aria-label={draft.subject || TITLES[draft.mode]}
    >
      <Header draft={draft} onMinimize={minimize} />
      {/* Kept, hidden, while minimized: restoring only unfolds it instead of building the form mid-animation. */}
      <div className="compose-window__body" hidden={draft.window === 'minimized'}>
        <WindowForm draft={draft} onEscape={escape} />
      </div>
      <span className="compose-window__veil" aria-hidden="true" />
    </section>
  );
}

function FullCompose({ draft, compact }: { draft: ComposeDraft; compact: boolean }) {
  const ref = useHandoff(draft.key);
  const [fromDock] = useState(() => handoff.has(draft.key));
  // Escape shrinks it back into its docked window; a phone has no dock, so it saves and closes.
  const leave = () => {
    if (compact) return close(draft);
    const box = document.querySelector(`.compose-full[data-key="${draft.key}"]`);
    if (box) rememberBox(draft.key, box);
    useUi.getState().updateCompose(draft.key, { window: 'open' });
  };
  return (
    <BaseDialog.Root open onOpenChange={(o) => !o && leave()}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="m3-scrim" />
        <BaseDialog.Popup
          ref={ref}
          className="compose-full"
          data-key={draft.key}
          data-compact={compact || undefined}
          data-handoff={fromDock || undefined}
          aria-label={draft.subject || TITLES[draft.mode]}
        >
          <Header draft={draft} full compact={compact} />
          <ComposeForm draft={draft} variant="full" compact={compact} onEscape={leave} />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
