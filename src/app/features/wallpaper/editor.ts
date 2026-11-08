import { create } from 'zustand';
import { updateSettings, useSettingsStore } from '../../state/settings';
import { snack } from '../../ui/Snackbar';
import type { AvatarFit } from '../../ui/avatarFit';
import { chooseWallpaper } from './actions';
import { clampCrop, cropFor, validCrop, type Crop } from './plan';
import { currentProfilePhoto } from './profile';
import { customRef, forgetWallpaper, isCustomRef, prepareWallpaper } from './resolve';
import type { PictureShape } from './shapes';
import { loadPicture, savePicture, type StoredPicture } from './store';

/** What the picture editor has open. */
export interface Editing {
  /** "custom:<id>" or "profile:<email>". */
  for: string;
  url: string;
  width: number;
  height: number;
  crop: Crop;
  /** Where Reset goes: the crop around the subject, or the profile photo's face fit. */
  auto: Crop;
  /** Not kept until Save. */
  fresh?: StoredPicture;
}

export const useEditor = create<{ editing: Editing | null }>(() => ({ editing: null }));

/** Only if it was made on that picture. */
function savedCrop(target: string): Crop | null {
  const c = useSettingsStore.getState().settings.pictureCrop;
  return c && c.for === target ? validCrop(c) : null;
}

/** Translate %, then scale about the middle, as a square. */
function fitToCrop(fit: Extract<AvatarFit, { kind: 'cover' }>): Crop {
  const size = 1 / fit.scale;
  return clampCrop({ x: 0.5 - (0.5 + fit.x / 100) * size, y: 0.5 - (0.5 + fit.y / 100) * size, width: size, height: size });
}

/** Nothing is kept until Save. */
export function editNewPicture(p: StoredPicture) {
  const url = URL.createObjectURL(new Blob([p.bytes], { type: p.type }));
  const auto = cropFor(p.width / p.height, 1, p.saliency?.subject);
  useEditor.setState({ editing: { for: customRef(p.id), url, width: p.width, height: p.height, crop: auto, auto, fresh: p } });
}

async function naturalSize(url: string) {
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  await img.decode();
  return { width: img.naturalWidth || 1, height: img.naturalHeight || 1 };
}

/** Your own, else your profile photo. */
export async function editCurrentPicture() {
  const ref = useSettingsStore.getState().settings.wallpaper;
  if (isCustomRef(ref)) {
    const w = await prepareWallpaper(ref);
    if (!w) return snack("That picture couldn't be loaded.");
    const { url, width, height } = w.image;
    const auto = cropFor(width / height, 1, w.image.saliency?.subject);
    useEditor.setState({ editing: { for: ref, url, width, height, crop: savedCrop(ref) ?? auto, auto } });
    return;
  }
  const profile = currentProfilePhoto();
  if (!profile) return snack('Add a picture first, then you can crop and shape it.');
  const target = `profile:${profile.email}`;
  try {
    const { width, height } = await naturalSize(profile.url);
    const auto = fitToCrop(profile.fit);
    useEditor.setState({ editing: { for: target, url: profile.url, width, height, crop: savedCrop(target) ?? auto, auto } });
  } catch {
    snack("Your profile photo couldn't be loaded.");
  }
}

export function closeEditor() {
  const e = useEditor.getState().editing;
  if (e?.fresh) URL.revokeObjectURL(e.url);
  useEditor.setState({ editing: null });
}

/** False if the picture couldn't be kept. */
export async function saveEdit(crop: Crop, shape: PictureShape): Promise<boolean> {
  const e = useEditor.getState().editing;
  if (!e) return false;
  if (e.fresh) {
    const old = (await loadPicture())?.id;
    try {
      await savePicture(e.fresh);
    } catch {
      snack("This browser couldn't save the picture. Private windows don't keep files.");
      return false;
    }
    if (old && old !== e.fresh.id) forgetWallpaper(customRef(old));
  }
  updateSettings({ pictureCrop: { for: e.for, ...crop }, pictureShape: shape });
  if (e.fresh && !(await chooseWallpaper(customRef(e.fresh.id)))) return false;
  closeEditor();
  return true;
}
