import { useCallback, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react';
import { useSettings } from '../../state/settings';
import { Menu, MenuItem, MenuSeparator } from '../../ui/Menu';
import { Tooltip } from '../../ui/Tooltip';
import { cx } from '../../ui/Button';
import { Ripple } from '../../ui/Ripple';
import type { ShapeName } from '../../ui/ShapeIcon';
import { cropFor, validCrop, type Crop } from './plan';
import { animateShape, MORPH_MS, pathOf } from './morph';
import { editCurrentPicture } from './editor';
import type { PictureShape } from './shapes';
import { UnreadBadge } from '../glance/UnreadBadge';
import { deletePictureWallpaper, pickWallpaperFile, uploadWallpaper } from './actions';
import { applyPictureColors, usePictureChoice } from './colors';
import { useReadyWallpaper } from './resolve';
import { useProfilePhoto } from './profile';
import { useImageReady } from '../../ui/imageReady';
import './wallpaper.css';

export function cropStyle(c: Crop): CSSProperties {
  return { width: `${100 / c.width}%`, height: `${100 / c.height}%`, left: `${(-c.x / c.width) * 100}%`, top: `${(-c.y / c.height) * 100}%` };
}

/** The picture grows from this. */
const MARK_PX = 88;
/** Kept across remounts (an account switch rebuilds the pane): null before anything, '' for the mark, 'pending' for a profile photo being looked at, else the picture. */
let lastShown: string | null = null;
/** So a new shape morphs from it. */
let lastShape: PictureShape | null = null;

/** `over` is true while one is held above it. */
function useDrop() {
  const [over, setOver] = useState(false);
  const hasFile = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        setOver(true);
      },
      onDragOver: (e: DragEvent) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void uploadWallpaper(file);
      },
    },
  };
}


type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement>; tip: string };

/** Takes the menu trigger's props and keeps its tooltip around it. */
function PictureButton({ tip, children, className, ...rest }: ButtonProps) {
  return (
    <Tooltip content={tip}>
      <button type="button" className={cx('glance-picture', className)} {...rest}>
        {children}
        <Ripple />
      </button>
    </Tooltip>
  );
}

/** For a finger, where browsers don't send contextmenu (iOS). */
function useLongPress(open: () => void) {
  const timer = useRef(0);
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      cancel();
      timer.current = window.setTimeout(open, 500);
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      cancel();
      open();
    },
  };
}

/** At a glance's picture, in the mark's place: your picture, else your profile photo, cut into your shape; with neither, the mark. Its menu crops, reshapes, changes it or takes colours from it; a dropped picture opens in the editor. Changes morph in on the no-bounce spring. */
export function GlancePicture({ mark, children }: { mark: ShapeName; children: ReactNode }) {
  const ref = useSettings((s) => s.wallpaper);
  const shape = useSettings((s) => s.pictureShape);
  const stored = useSettings((s) => s.pictureCrop);
  const choice = usePictureChoice();
  const w = useReadyWallpaper(ref);
  const looked = useProfilePhoto();
  const pending = looked === 'pending';
  const profile = pending ? null : looked;
  const photoUrl = ref ? w?.image?.url : profile?.url;
  const decodedPhoto = useImageReady(photoUrl);
  const held = useRef<{ url: string; node: ReactNode }>(undefined);
  const drop = useDrop();
  const [menu, setMenu] = useState(false);
  const press = useLongPress(() => setMenu(true));
  const clipRef = useRef<SVGPathElement>(null);
  const ringRef = useRef<SVGPathElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const source = ref || (profile ? `profile:${profile.url}` : pending ? 'pending' : '');
  const savedFor = (target: string) => (stored?.for === target ? validCrop(stored) : null);

  // A new picture grows the mark and morphs its shape into yours; a new shape morphs from the old one.
  useLayoutEffect(() => {
    const before = lastShown;
    const shapeBefore = lastShape;
    lastShown = source;
    const paths = [clipRef.current, ringRef.current].filter(Boolean) as SVGPathElement[];
    if (!paths.length || !source) return;
    lastShape = shape;
    const set = (d: string) => paths.forEach((p) => p.setAttribute('d', d));
    const changed = before !== null && before !== 'pending' && source !== 'pending' && before !== source;
    const reshaped = !changed && shapeBefore !== null && shapeBefore !== shape;
    if (!changed && !reshaped) {
      set(pathOf(shape));
      return;
    }
    const button = paths[0]!.closest<HTMLElement>('.glance-picture');
    if (changed && button && before === '' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const size = `${button.offsetWidth}px`;
      const spring = getComputedStyle(document.documentElement).getPropertyValue('--md-spring-0-8').trim() || 'ease-out';
      button.animate({ width: [`${MARK_PX}px`, size], height: [`${MARK_PX}px`, size] }, { duration: MORPH_MS, easing: spring });
    }
    return animateShape(changed ? mark : shapeBefore!, shape, set);
  }, [source, ref, mark, shape]);

  // Reading the last unread mail lifts the picture once.
  const cleared = useCallback(() => {
    const el = wrapRef.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const spring = getComputedStyle(document.documentElement).getPropertyValue('--md-spring-0-8').trim() || 'ease-out';
    el.querySelector('.glance-picture, .glance-picture--mark')?.animate(
      [{ scale: 1, rotate: '0deg' }, { scale: 1.08, rotate: '-6deg', offset: 0.4 }, { scale: 1, rotate: '0deg' }],
      { duration: 700, easing: spring },
    );
  }, []);

  const change = (
    <MenuItem icon="add_photo_alternate" onClick={() => void pickWallpaperFile()}>
      Change picture
    </MenuItem>
  );

  if (!source) {
    return (
      <span className="glance-picture-wrap" ref={wrapRef}>
        <Menu
          open={menu}
          onOpenChange={setMenu}
          trigger={
            <PictureButton tip="Add a picture" className="glance-picture--mark" aria-label="Add a picture" data-drop={drop.over || undefined} {...press} {...drop.props}>
              {children}
            </PictureButton>
          }
        >
          <MenuItem icon="add_photo_alternate" onClick={() => void pickWallpaperFile()}>
            Add a picture
          </MenuItem>
        </Menu>
        <UnreadBadge onCleared={cleared} />
      </span>
    );
  }

  let photo: ReactNode = null;
  // A big picture fades in only once decoded; one shown before paints at once (imageReady.ts). A picture replacing one already up swaps in once decoded, without a fade from empty.
  const replacing = !!held.current && held.current.url !== photoUrl;
  const instant = decodedPhoto.instant || replacing;
  const shown = { 'data-ready': decodedPhoto.ready || undefined, 'data-instant': instant || undefined, decoding: instant ? ('sync' as const) : ('async' as const) };
  if (ref) {
    const image = w?.image;
    const crop = image ? (savedFor(ref) ?? cropFor(image.width / image.height, 1, image.saliency?.subject)) : null;
    if (image && crop) photo = <img key={image.url} src={image.url} alt="" draggable={false} style={cropStyle(crop)} {...shown} />;
  } else if (profile) {
    const crop = savedFor(`profile:${profile.email}`);
    const { x, y, scale } = profile.fit;
    photo = (
      <img
        key={profile.url}
        className={crop ? undefined : 'glance-picture__profile'}
        src={profile.url}
        alt=""
        draggable={false}
        referrerPolicy="no-referrer"
        style={crop ? cropStyle(crop) : { transform: `translate(${x}%, ${y}%) scale(${scale})` }}
        {...shown}
      />
    );
  }
  if (photo && decodedPhoto.ready) held.current = { url: photoUrl!, node: photo };
  else if (!photo && !pending && !(ref && !w)) held.current = undefined;
  else if (held.current) photo = held.current.node;
  return (
    <span className="glance-picture-wrap" ref={wrapRef}>
      <Menu
        open={menu}
        onOpenChange={setMenu}
        trigger={
          <PictureButton
            tip={ref ? 'Your picture' : 'Your profile photo'}
            aria-label={ref ? 'Your picture, options' : 'Your profile photo, options'}
            data-loading={!photo || undefined}
            aria-busy={pending || undefined}
            data-drop={drop.over || undefined}
            {...press}
            {...drop.props}
          >
            <svg className="glance-picture__defs" width="0" height="0" aria-hidden="true">
              <clipPath id="glance-picture-shape" clipPathUnits="objectBoundingBox">
                <path ref={clipRef} d={pathOf(shape)} />
              </clipPath>
            </svg>
            <svg className="glance-picture__ring" viewBox="0 0 1 1" aria-hidden="true">
              <path ref={ringRef} d={pathOf(shape)} />
            </svg>
            <span className="glance-picture__photo">{photo}</span>
          </PictureButton>
        }
      >
        <MenuItem icon="crop" disabled={pending} onClick={() => void editCurrentPicture()}>
          Crop and shape
        </MenuItem>
        {change}
        {choice && (
          <MenuItem icon={choice.selected && choice.colors.length > 1 ? 'shuffle' : 'palette'} onClick={() => void applyPictureColors()}>
            {choice.selected && choice.colors.length > 1 ? 'Shuffle colors from this picture' : 'Use colors from this picture'}
          </MenuItem>
        )}
        {ref && <MenuSeparator />}
        {ref && (
          <MenuItem icon={profile ? 'account_circle' : 'hide_image'} onClick={() => void deletePictureWallpaper()}>
            {profile ? 'Use your profile photo' : 'Remove picture'}
          </MenuItem>
        )}
      </Menu>
      <UnreadBadge onCleared={cleared} />
    </span>
  );
}
