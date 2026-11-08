import { useEffect, useState } from 'react';
import { updateSettings, useSettings, useSettingsStore } from '../../state/settings';
import { snack } from '../../ui/Snackbar';
import { nextColor } from './plan';
import { currentProfilePhoto, profileColors, useProfilePhoto } from './profile';
import { useReadyWallpaper } from './resolve';

/** "From your picture": the colours of the picture At a glance shows, offered as a theme. A picture never recolours the app by itself. */

const profileCache = new Map<string, Promise<string[]>>();
function colorsOfProfile(url: string) {
  let p = profileCache.get(url);
  if (!p) {
    p = profileColors(url).catch(() => []);
    profileCache.set(url, p);
  }
  return p;
}

/** Best first; empty when unreadable; null with no picture. */
async function shownColors(): Promise<string[] | null> {
  const s = useSettingsStore.getState().settings;
  if (s.wallpaper) return s.wallpaperColors;
  const profile = currentProfilePhoto();
  return profile ? colorsOfProfile(profile.url) : null;
}

/** For the command palette. */
export const hasPicture = () => !!useSettingsStore.getState().settings.wallpaper || !!currentProfilePhoto();

export function useHasPicture() {
  const ref = useSettings((s) => s.wallpaper);
  const looked = useProfilePhoto();
  return !!ref || (!!looked && looked !== 'pending');
}

/** Again: the next of them. */
export async function applyPictureColors() {
  const colors = await shownColors();
  if (!colors) return;
  if (!colors.length) {
    snack("This picture's colors couldn't be read.");
    return;
  }
  const s = useSettingsStore.getState().settings;
  updateSettings({ themeSource: 'dynamic', seed: nextColor(colors, s.seed, s.themeSource === 'dynamic') ?? colors[0]! });
}

/** Null with no readable picture; `selected` says whether the theme uses one of them. */
export function usePictureChoice(): { colors: string[]; seed: string; selected: boolean; url: string | null } | null {
  const ref = useSettings((s) => s.wallpaper);
  const ownColors = useSettings((s) => s.wallpaperColors);
  const seed = useSettings((s) => s.seed);
  const dynamic = useSettings((s) => s.themeSource === 'dynamic');
  const looked = useProfilePhoto();
  const own = useReadyWallpaper(ref);
  const url = !ref && looked && looked !== 'pending' ? looked.url : null;
  const [profile, setProfile] = useState<{ url: string; colors: string[] } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    void colorsOfProfile(url).then((colors) => live && setProfile({ url, colors }));
    return () => {
      live = false;
    };
  }, [url]);
  const colors = ref ? ownColors : url && profile?.url === url ? profile.colors : [];
  if (!colors.length) return null;
  const selected = dynamic && colors.includes(seed);
  return { colors, seed: selected ? seed : colors[0]!, selected, url: ref ? (own?.image.url ?? null) : url };
}
