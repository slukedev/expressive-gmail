/** Gmail's small renditions of an attachment: `view=fimg&sz=` is what its attachment cards load; `disp=thd` is the older form, kept as a second try. */
const THUMB_SIZE = 'w400-h400';

export function thumbnailUrls(downloadUrl: string): string[] {
  const hash = downloadUrl.indexOf('#');
  const bare = hash >= 0 ? downloadUrl.slice(0, hash) : downloadUrl;
  const q = bare.indexOf('?');
  if (q < 0) return [];
  // Edited as a string so Gmail's valueless flags ("&zw") survive untouched.
  const kept = bare
    .slice(q + 1)
    .split('&')
    .filter((p) => p && !/^(view|disp|sz|safe)(=|$)/.test(p))
    .join('&');
  const base = `${bare.slice(0, q)}?${kept}`;
  return [`${base}&view=fimg&sz=${THUMB_SIZE}&disp=thd`, `${base}&view=att&disp=thd`];
}

export function isThumbnailUrl(url: string): boolean {
  return /^https:\/\/mail\.google\.com\/mail\/u\/\d+\/\?/.test(url) && /[?&]disp=thd(&|$)/.test(url) && /[?&]attid=/.test(url);
}

export function fromDataUrl(url: string | undefined): { data: string; mimeType: string } | undefined {
  const m = url ? /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(url) : null;
  return m ? { mimeType: m[1]!, data: m[2]! } : undefined;
}
