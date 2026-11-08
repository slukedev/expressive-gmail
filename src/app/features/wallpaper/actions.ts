import { updateSettings, useSettingsStore } from '../../state/settings';
import { snack } from '../../ui/Snackbar';
import { PictureError, processPicture } from './process';
import { customRef, forgetWallpaper, isCustomRef, prepareWallpaper } from './resolve';
import { deletePicture, loadPicture } from './store';
import { editNewPicture } from './editor';

/** Once decoded. Its colours are only offered ("From your picture"), never applied by themselves. */
export async function chooseWallpaper(ref: string): Promise<boolean> {
  const w = await prepareWallpaper(ref);
  if (!w) {
    snack("That picture couldn't be loaded.");
    return false;
  }
  updateSettings({ wallpaper: ref, wallpaperColors: w.colors });
  return true;
}

function clearWallpaper() {
  updateSettings({ wallpaper: '', wallpaperColors: [] });
}

let busy = false;

/** Shrunk to the size it's shown at, opened in the editor to crop, kept once saved. False when it couldn't be opened (they've been told why). */
export async function uploadWallpaper(file: File): Promise<boolean> {
  if (busy) return false;
  busy = true;
  try {
    editNewPicture(await processPicture(file));
    return true;
  } catch (err) {
    snack(err instanceof PictureError ? err.message : "This picture couldn't be opened.");
    return false;
  } finally {
    busy = false;
  }
}

/** And stops showing it. */
export async function deletePictureWallpaper() {
  const p = await loadPicture();
  await deletePicture().catch(() => undefined);
  if (p) forgetWallpaper(customRef(p.id));
  if (isCustomRef(useSettingsStore.getState().settings.wallpaper)) clearWallpaper();
}

/** For places without a file input of their own (the command palette). */
export function pickWallpaperFile(): Promise<boolean> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.heic,.heif,.avif';
    input.onchange = () => {
      const f = input.files?.[0];
      resolve(f ? uploadWallpaper(f) : false);
    };
    input.click();
  });
}
