import { useEffect, type RefObject } from 'react';
import { getVisibleThreadIds } from '../../data/actions';
import { useUi } from '../../state/ui';
import { rangePlan } from './select';

/** Fired on a row's wrapper when it becomes the hovered row without the pointer moving. */
export const ROW_HOVER_EVENT = 'bg:row-hover';

/** A row collapses in 435ms (.row-wrap[data-leaving]); keep hit-testing a little past that. */
const SETTLE_MS = 600;

const ROW = '.row[data-row-index]';

/** Hover kept by hand. Browsers only re-run :hover when the pointer moves (Safari strictly), so when a row is archived from under a resting pointer the one that slides up stays cold and the next click misses its Archive button. This hit-tests while the list settles and marks the row with data-hover, which CSS treats like :hover. It also draws the Shift range preview (data-range). */
/** Kept for the page, not per list: a list mounting under a resting pointer has seen no movement yet. */
const pointer = { x: 0, y: 0, inside: false, shift: false };
const tracked = new WeakSet<Document>();
function trackPointer(doc: Document) {
  if (tracked.has(doc)) return;
  tracked.add(doc);
  const at = (e: PointerEvent) => {
    pointer.inside = e.pointerType !== 'touch';
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.shift = e.shiftKey;
  };
  doc.addEventListener('pointermove', at, { capture: true, passive: true });
  doc.addEventListener('pointerdown', at, { capture: true, passive: true });
  doc.addEventListener(
    'pointerout',
    (e) => {
      if (!e.relatedTarget) pointer.inside = false;
    },
    { capture: true, passive: true },
  );
}

export function useRowHover(scrollRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const doc = root.ownerDocument;
    trackPointer(doc);
    let shift = false;
    let hovered: HTMLElement | null = null;
    let ranged: HTMLElement[] = [];
    let frame = 0;
    let settleUntil = 0;

    const rowOf = (el: Element | null) => {
      const row = el?.closest<HTMLElement>(ROW) ?? null;
      return row && root.contains(row) && !row.closest('[data-leaving]') ? row : null;
    };

    const paintRange = () => {
      const plan = shift && hovered ? rangePlan(getVisibleThreadIds()[Number(hovered.dataset.rowIndex)] ?? '') : null;
      const next: HTMLElement[] = [];
      if (plan) {
        const ids = getVisibleThreadIds();
        const want = new Set(plan.ids);
        root.querySelectorAll<HTMLElement>(ROW).forEach((row) => {
          if (want.has(ids[Number(row.dataset.rowIndex)] ?? '') && !row.closest('[data-leaving]')) next.push(row);
        });
      }
      for (const row of ranged) if (!next.includes(row)) delete row.dataset.range;
      for (const row of next) row.dataset.range = plan!.on ? 'add' : 'remove';
      ranged = next;
    };

    const setHovered = (row: HTMLElement | null, moved: boolean) => {
      if (row !== hovered) {
        if (hovered) delete hovered.dataset.hover;
        hovered = row;
        if (row) {
          row.dataset.hover = '';
          // Real movement already armed it through pointerenter.
          if (!moved) row.parentElement?.dispatchEvent(new Event(ROW_HOVER_EVENT));
        }
        if (shift || ranged.length) paintRange();
      }
    };

    const hitTest = () => {
      if (!pointer.inside) return setHovered(null, false);
      setHovered(rowOf(doc.elementFromPoint(pointer.x, pointer.y)), false);
    };

    // Each frame until the list stops moving, so the row sliding in warms up as it arrives.
    const tick = () => {
      frame = 0;
      hitTest();
      if (performance.now() < settleUntil) frame = requestAnimationFrame(tick);
    };
    const settle = () => {
      settleUntil = performance.now() + SETTLE_MS;
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return setHovered(null, true);
      shift = e.shiftKey;
      setHovered(rowOf(e.target as Element), true);
    };
    const onOut = (e: PointerEvent) => {
      if (!e.relatedTarget) setHovered(null, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || shift === (e.type === 'keydown')) return;
      shift = e.type === 'keydown';
      paintRange();
    };
    const onBlur = () => {
      shift = false;
      paintRange();
    };

    doc.addEventListener('pointermove', onMove, { passive: true });
    doc.addEventListener('pointerout', onOut, { passive: true });
    doc.addEventListener('keydown', onKey);
    doc.addEventListener('keyup', onKey);
    doc.defaultView?.addEventListener('blur', onBlur);
    root.addEventListener('scroll', settle, { passive: true });

    // Rows leaving, arriving or coming back with Undo all move the list under a still pointer.
    const isRow = (n: Node) => n instanceof Element && (n.matches('.row-wrap, .row-context') || !!n.querySelector('.row-wrap'));
    const observer = new MutationObserver((records) => {
      if (records.some((r) => r.type === 'attributes' || [...r.addedNodes].some(isRow) || [...r.removedNodes].some(isRow))) settle();
      // Anything new at the top level (a banner, the list after the skeleton) gets watched for size too.
      for (const r of records) if (r.target === root) r.addedNodes.forEach((n) => n instanceof Element && sizes.observe(n));
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-leaving'] });
    // Something above the rows resizing slides them under the pointer too.
    const sizes = new ResizeObserver(settle);
    for (const child of root.children) sizes.observe(child);
    // The pointer may already rest on a row.
    settle();
    // A new selection changes what the range would do.
    const unsubscribe = useUi.subscribe((s, prev) => {
      if (s.selected !== prev.selected && shift) paintRange();
    });

    return () => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerout', onOut);
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('keyup', onKey);
      doc.defaultView?.removeEventListener('blur', onBlur);
      root.removeEventListener('scroll', settle);
      observer.disconnect();
      sizes.disconnect();
      unsubscribe();
      cancelAnimationFrame(frame);
      shift = false;
      setHovered(null, true);
    };
  }, [scrollRef]);
}
