// Every face is font-display: block, so the shell waits for them behind the boot screen
// instead of painting invisible text that pops in. One file each covers every weight and glyph.
const BOOT = ['14px "Google Sans Flex"', '24px "Material Symbols Rounded"'];

let loading: Promise<void> | undefined;

/** Call after tokens.css is in the document. */
export function loadFonts(): Promise<void> {
  if (!loading) {
    const set = typeof document === 'undefined' ? undefined : document.fonts;
    loading = set
      ? Promise.all(BOOT.map((f) => set.load(f))).then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
  }
  return loading;
}

/** `maxMs` so a stuck font never holds the app. */
export function fontsReady(maxMs = 2_000): Promise<void> {
  return Promise.race([loadFonts(), new Promise<void>((r) => setTimeout(r, maxMs))]);
}

/** Names like Łukasz or Dvořák use a second file; fetch it before one shows up blank. */
export function loadExtendedFonts(): Promise<unknown> {
  return document.fonts?.load('14px "Google Sans Flex"', '\u0100\u0141') ?? Promise.resolve();
}
