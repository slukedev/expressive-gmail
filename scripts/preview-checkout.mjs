// The preview server answers /__checkout with the folder it serves (vite.preview.config.ts), so tools
// reuse a running preview only when it is this checkout's, never a worktree's or another project's.
import fs from 'node:fs';
import path from 'node:path';

/** True when `origin` is this checkout's preview, false when nothing answers. Throws for any other server. */
export async function ownPreview(origin, root) {
  let res;
  try {
    res = await fetch(new URL('/__checkout', origin), { signal: AbortSignal.timeout(2000) });
  } catch {
    return false;
  }
  const served = res.ok ? (await res.text()).trim() : '';
  if (served === fs.realpathSync(root)) return true;
  throw new Error(
    `${origin} is serving ${path.isAbsolute(served) ? served : 'something else'}, not ${fs.realpathSync(root)}. ` +
      'Stop that server, or set PREVIEW_PORT to a free port.',
  );
}
