import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { photos, usePersonPhoto, useVerifiedLogo } from '../data/photos';
import { publicPhoto } from '../../session/account';
import { localCopy, reportUnreadable, useAvatarFit } from './avatarFit';
import { useImageReady } from './imageReady';
import { personLabel, photoLog } from '../data/photoLog';
import { tag } from '../../session/shape';
import { MONOGRAM_MARK } from '../../session/contacts';
import { avatarColor } from '../theme/color';
import { useResolvedDark } from '../theme/ThemeProvider';

interface AvatarProps {
  name?: string;
  email: string;
  photoUrl?: string;
  /** Brand logos sit inside the circle on a light surface instead of filling it. */
  photoKind?: 'person' | 'brand';
  size?: number;
  className?: string;
  /** A signed-in account's own photo, shown as is even when it looks generic: it's what Google shows for this account. */
  own?: boolean;
  /** For a card that moves it between layouts (ThreadPane's morph). */
  morph?: string;
}

const unreadable = new Set<string>();
reportUnreadable((url) => {
  if (unreadable.has(url) || unreadable.size > 200) return;
  unreadable.add(url);
  photoLog.add({ who: tag(url), kind: 'person', steps: ["pixels couldn't be read, so a placeholder can't be told from a photo"], result: 'error' });
});

const COVER = { kind: 'cover', scale: 1, x: 0, y: 0 } as const;

function initial(name: string | undefined, email: string) {
  const source = (name || email).trim();
  const match = source.match(/\p{L}|\p{N}/u);
  return (match?.[0] ?? '?').toLocaleUpperCase();
}

/** So they share one hairline treatment. */
function whiteish(colour: string) {
  const m = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(colour);
  return m && +m[1]! > 244 && +m[2]! > 244 && +m[3]! > 244 ? '#ffffff' : colour;
}

export function Avatar({ name, email, photoUrl, photoKind = 'person', size = 40, className, own, morph }: AvatarProps) {
  const dark = useResolvedDark();
  // Addresses that didn't load here, and the local copies standing in for some.
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [copies, setCopies] = useState<Readonly<Record<string, string | null>>>({});
  const { bg, fg } = avatarColor(email.toLowerCase(), dark);
  const given = photoUrl && !failed.includes(photoUrl) ? photoUrl : undefined;
  // Without a working photo from the caller: a profile photo, or the sender's brand logo.
  const lookedUp = usePersonPhoto(given ? undefined : email, name);
  // A verified logo beats even a photo that came with the mail (a brand's blank Google profile).
  const verifiedLogo = useVerifiedLogo(given && !own ? email : undefined);
  const looked = verifiedLogo && !failed.includes(verifiedLogo.url) ? verifiedLogo : lookedUp;
  // In order: the caller's photo, its public twin (a signed-in-only address won't load in this frame), the looked-up one.
  const twin = photoUrl ? publicPhoto(photoUrl) : undefined;
  const lookedUrl = looked && !failed.includes(looked.url) ? looked.url : undefined;
  const url = (looked?.verified ? lookedUrl : undefined) ?? given ?? (twin && !failed.includes(twin) ? twin : undefined) ?? lookedUrl;
  const kind = url && url === lookedUrl ? looked!.kind : photoKind;
  const src = url ? (copies[url] ?? url) : undefined;
  const measured = useAvatarFit(src, kind === 'brand');
  // A verified logo is drawn to fill a circle; it isn't measured.
  const verified = !!url && url === lookedUrl && !!looked?.verified;
  // A readable verified logo gets the same fit as any brand mark; unreadable, it fills the circle on white, as Gmail draws it. It never waits on the read.
  const fit = verified ? (measured && measured.kind === 'unknown' ? COVER : measured) : measured;
  // Until the fit is known (and for Google's placeholders) the initial shows. Google's letter avatars are flat by design and show as Gmail shows them.
  const monogram = !!url?.endsWith(MONOGRAM_MARK);
  const showPhoto = !!src && !!fit && (own || monogram || fit.kind !== 'placeholder');
  // Verified logos are drawn for a white ground (many leave it transparent), as Gmail shows them, in dark mode too.
  const fill =
    showPhoto && (fit.kind === 'tile' || fit.kind === 'mark')
      ? whiteish(fit.bg)
      : (showPhoto && verified) || fit?.kind === 'unknown'
        ? '#ffffff'
        : bg;
  const placed = showPhoto && fit && 'scale' in fit ? { transform: `translate(${fit.x}%, ${fit.y}%) scale(${fit.scale})` } : undefined;

  // A caller's photo that is Google's generic placeholder (a contact without a picture) says nothing; the person's own photo may still exist.
  const placeholder = !own && !monogram && !!url && url === given && fit?.kind === 'placeholder';
  useEffect(() => {
    if (placeholder) setFailed((list) => (list.includes(url) ? list : [...list, url]));
  }, [placeholder, url]);

  const onError = () => {
    if (!url) return;
    const give = () => {
      photoLog.add({ who: personLabel(email), kind, steps: [`image ${tag(url)} didn't load, nor a copy of it`], result: 'error' });
      setFailed((list) => (list.includes(url) ? list : [...list, url]));
      if (url === lookedUrl || url === photoUrl) photos.broken(email, url);
    };
    // Some browsers (Dia, strict cookie settings) won't send Google's cookies for an <img> in this frame, while the extension can still read the bytes.
    if (!(url in copies)) {
      void localCopy(url).then((copy) => {
        if (copy) setCopies((c) => ({ ...c, [url]: copy }));
        else {
          setCopies((c) => ({ ...c, [url]: null }));
          give();
        }
      });
    } else give();
  };

  // The initial stays until the image has arrived, then it fades in over it; one in the browser's cache shows at once.
  const image = useImageReady(showPhoto ? src : undefined);
  const ready = showPhoto && image.ready;
  const instant = image.instant || image.cached;
  useEffect(() => {
    if (image.failed) onError();
  }, [image.failed]); // eslint-disable-line react-hooks/exhaustive-deps
  // A photo showing stays until its replacement is ready, so the circle never goes photo, initial, photo.
  const held = useRef<{ email: string; src: string; fill: string; placed?: CSSProperties; fit?: string }>(undefined);
  if (ready) held.current = { email, src: src!, fill, placed, fit: fit.kind === 'unknown' ? (fit.large ? 'unknown-large' : 'unknown-small') : fit.kind };
  else if (held.current && (held.current.email !== email || !src)) held.current = undefined;
  const hold = !ready ? held.current : undefined;
  if (hold) {
    return (
      <span
        className={className ? `m3-avatar ${className}` : 'm3-avatar'}
        data-fit={hold.fit}
        data-light={hold.fill === '#ffffff' ? '' : undefined}
        data-ready=""
        data-instant=""
        data-morph={morph}
        style={{ width: size, height: size, background: hold.fill, color: fg, fontSize: Math.round(size * 0.45) }}
        aria-hidden="true"
      >
        <img key={hold.src} src={hold.src} alt="" width={size} height={size} style={hold.placed} referrerPolicy="no-referrer" decoding="sync" />
      </span>
    );
  }
  return (
    <span
      className={className ? `m3-avatar ${className}` : 'm3-avatar'}
      data-fit={ready ? (fit.kind === 'unknown' ? (fit.large ? 'unknown-large' : 'unknown-small') : fit.kind) : undefined}
      data-light={ready && fill === '#ffffff' ? '' : undefined}
      data-ready={ready ? '' : undefined}
      data-instant={ready && instant ? '' : undefined}
      data-morph={morph}
      style={{ width: size, height: size, background: ready ? fill : bg, color: fg, fontSize: Math.round(size * 0.45) }}
      aria-hidden="true"
    >
      {!ready && <span className="m3-avatar__initial">{initial(name, email)}</span>}
      {showPhoto && (
        <img
          key={src}
          src={src}
          alt=""
          width={size}
          height={size}
          style={placed}
          onError={onError}
          referrerPolicy="no-referrer"
          // Decoded already (imageReady.ts): painting now avoids an empty frame.
          decoding={instant ? 'sync' : 'async'}
        />
      )}
    </span>
  );
}
