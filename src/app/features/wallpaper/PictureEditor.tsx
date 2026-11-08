import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useSettings } from '../../state/settings';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Slider } from '../../ui/Slider';
import { Tooltip } from '../../ui/Tooltip';
import { closeEditor, saveEdit, useEditor, type Editing } from './editor';
import { animateShape, pathOf } from './morph';
import { MAX_ZOOM, panCrop, zoomCrop, zoomOf, type Crop } from './plan';
import { PICTURE_SHAPES, type PictureShape } from './shapes';
import { cropStyle } from './Hero';

/** CSS pixels. */
const STAGE_PX = 264;
const SQUARE = 'M0 0H1V1H0Z';

/** Like a profile photo's crop in Google's apps. */
export function PictureEditor() {
  const editing = useEditor((s) => s.editing);
  return (
    <Dialog
      open={!!editing}
      onOpenChange={(open) => !open && closeEditor()}
      title={editing?.fresh ? 'Crop your picture' : 'Crop and shape'}
      className="picture-editor"
    >
      {editing && <Editor key={editing.url} editing={editing} />}
    </Dialog>
  );
}

function Editor({ editing }: { editing: Editing }) {
  const saved = useSettings((s) => s.pictureShape);
  const [shape, setShape] = useState<PictureShape>(saved);
  const [crop, setCrop] = useState<Crop>(editing.crop);
  const [saving, setSaving] = useState(false);
  const aspect = editing.width / editing.height;
  const zoom = zoomOf(crop, aspect);
  const stage = useRef<HTMLDivElement>(null);
  const mask = useRef<SVGPathElement>(null);
  const outline = useRef<SVGPathElement>(null);
  const shown = useRef<PictureShape>(saved);

  // The mask and its outline morph together.
  useEffect(() => {
    const from = shown.current;
    shown.current = shape;
    return animateShape(from, shape, (d) => {
      mask.current?.setAttribute('d', `${SQUARE} ${d}`);
      outline.current?.setAttribute('d', d);
    });
  }, [shape]);

  // Wheel and pinch zoom around the pointer; React's wheel listener is passive, so it can't stop the page scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      const focus = { x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height };
      const speed = e.ctrlKey ? 0.01 : 0.002;
      setCrop((c) => zoomCrop(c, aspect, zoomOf(c, aspect) * Math.exp(-e.deltaY * speed), focus));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [aspect]);

  // One finger or the mouse drags; two fingers pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;
    const box = e.currentTarget.getBoundingClientRect();
    if (map.size === 1) {
      const dx = (e.clientX - prev.x) / box.width;
      const dy = (e.clientY - prev.y) / box.height;
      setCrop((c) => panCrop(c, dx, dy));
    } else if (map.size === 2) {
      const other = [...map.entries()].find(([id]) => id !== e.pointerId)![1];
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const focus = { x: ((e.clientX + other.x) / 2 - box.left) / box.width, y: ((e.clientY + other.y) / 2 - box.top) / box.height };
      if (before > 0) setCrop((c) => zoomCrop(c, aspect, (zoomOf(c, aspect) * after) / before, focus));
    }
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => pointers.current.delete(e.pointerId);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.25 : 0.05;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) setCrop((c) => panCrop(c, ...moves[e.key]!));
    else if (e.key === '+' || e.key === '=') setCrop((c) => zoomCrop(c, aspect, zoomOf(c, aspect) * 1.25));
    else if (e.key === '-' || e.key === '_') setCrop((c) => zoomCrop(c, aspect, zoomOf(c, aspect) / 1.25));
    else return;
    e.preventDefault();
  };

  const save = async () => {
    setSaving(true);
    if (!(await saveEdit(crop, shape))) setSaving(false);
  };

  return (
    <div className="picture-editor__body">
      <div
        ref={stage}
        className="picture-editor__stage"
        style={{ width: STAGE_PX, height: STAGE_PX }}
        role="group"
        aria-roledescription="crop area"
        aria-label="Picture position. Drag to move it, scroll or pinch to zoom. With the keyboard, arrow keys move it and plus and minus zoom."
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <img src={editing.url} alt="" draggable={false} referrerPolicy="no-referrer" style={cropStyle(crop)} />
        <svg className="picture-editor__mask" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          <path ref={mask} fillRule="evenodd" d={`${SQUARE} ${pathOf(saved)}`} />
          <path ref={outline} className="picture-editor__outline" d={pathOf(saved)} />
        </svg>
      </div>

      <div className="picture-editor__zoom">
        <IconButton icon="zoom_out" label="Zoom out" disabled={zoom <= 1.001} onClick={() => setCrop((c) => zoomCrop(c, aspect, zoomOf(c, aspect) / 1.25))} />
        <Slider
          label="Zoom"
          value={zoom}
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          valueText={(v) => `${Math.round(v * 100)}%`}
          onValueChange={(z) => setCrop((c) => zoomCrop(c, aspect, z))}
        />
        <IconButton icon="zoom_in" label="Zoom in" disabled={zoom >= MAX_ZOOM - 0.001} onClick={() => setCrop((c) => zoomCrop(c, aspect, zoomOf(c, aspect) * 1.25))} />
      </div>

      <ShapePicker value={shape} onChange={setShape} />

      <footer className="picture-editor__actions">
        <Button variant="text" onClick={() => setCrop(editing.auto)} disabled={sameCrop(crop, editing.auto)}>
          Reset
        </Button>
        <span className="picture-editor__spacer" />
        <Button variant="text" onClick={closeEditor}>
          Cancel
        </Button>
        <Button variant="filled" onClick={() => void save()} disabled={saving}>
          Save
        </Button>
      </footer>
    </div>
  );
}

const sameCrop = (a: Crop, b: Crop) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height) < 1e-4;

/** Arrow keys move the choice, like any radio group. */
function ShapePicker({ value, onChange }: { value: PictureShape; onChange: (s: PictureShape) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent, i: number) => {
    const n = PICTURE_SHAPES.length;
    const cols = 8;
    const by: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -i, End: n - 1 - i };
    if (!(e.key in by)) return;
    e.preventDefault();
    const next = Math.min(Math.max(i + by[e.key]!, 0), n - 1);
    onChange(PICTURE_SHAPES[next]!.shape);
    group.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };
  return (
    <div className="picture-editor__shapes" role="radiogroup" aria-label="Shape" ref={group}>
      {PICTURE_SHAPES.map(({ shape, label }, i) => (
        <Tooltip key={shape} content={label}>
          <button
            type="button"
            role="radio"
            aria-checked={shape === value}
            aria-label={label}
            tabIndex={shape === value ? 0 : -1}
            className="picture-editor__shape"
            onClick={() => onChange(shape)}
            onKeyDown={(e) => move(e, i)}
          >
            <svg viewBox="0 0 1 1" aria-hidden="true">
              <path d={pathOf(shape)} />
            </svg>
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
