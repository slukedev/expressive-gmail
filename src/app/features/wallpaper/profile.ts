import { sizedPhoto } from '../../../session/account';
import { useAccount } from '../../data/hooks';
import { useScopeViews } from '../accounts/AccountBits';
import { useAvatarFit, type AvatarFit } from '../../ui/avatarFit';
import { analysisSize, profileAccount } from './plan';
import { analyzeOffThread } from './run-analysis';

export interface ProfilePhoto {
  url: string;
  email: string;
  /** From the avatar's own fit (translate %, scale). */
  fit: Extract<AvatarFit, { kind: 'cover' }>;
}

let last: ProfilePhoto | null = null;
/** For code outside React (the command palette). */
export const currentProfilePhoto = () => last;

/** As the top-right avatar shows it: in a merged scope, the account this tab signed in with. 'pending' while first looked at, so its place is kept; null for none or Google's letter placeholder. */
export function useProfilePhoto(): ProfilePhoto | 'pending' | null {
  const { data: account, isPending } = useAccount();
  const inScope = useScopeViews();
  const main = profileAccount(account, inScope);
  const url = main?.photoUrl ? sizedPhoto(main.photoUrl, 256) : undefined;
  const fit = useAvatarFit(url, false);
  // On a first run the account is still on its way: keep the photo's place rather than growing the mark later.
  if (isPending) return last ?? 'pending';
  // While another account's photo is looked at, the last stays, so the switch morphs rather than flashing the mark.
  if (main && url && !fit) return last ?? 'pending';
  if (last?.url !== url || !fit) last = main && url && fit?.kind === 'cover' ? { url, email: main.email, fit } : null;
  return last;
}

/** From its own bytes, so the canvas can read it. */
async function decoded(url: string): Promise<HTMLImageElement | null> {
  // Without cookies first; some Google photos only load with them.
  for (const credentials of ['omit', 'include'] as const) {
    try {
      const res = await fetch(url, { credentials, referrerPolicy: 'no-referrer' });
      if (!res.ok) continue;
      const img = new Image();
      img.src = URL.createObjectURL(await res.blob());
      try {
        await img.decode();
        return img;
      } finally {
        URL.revokeObjectURL(img.src);
      }
    } catch {
      // Not readable this way: try the next.
    }
  }
  return null;
}

/** Best first; empty when its pixels can't be read. */
export async function profileColors(url: string): Promise<string[]> {
  const img = await decoded(url);
  if (!img) return [];
  const size = analysisSize(img.naturalWidth || 256, img.naturalHeight || 256);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size.width, size.height);
  const { data } = ctx.getImageData(0, 0, size.width, size.height);
  return (await analyzeOffThread({ width: size.width, height: size.height, data })).colors;
}
