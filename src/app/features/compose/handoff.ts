/** Where a compose sat as it switched between docked and full screen, with a still copy (and the page's scrim) to hand over from. */
export const handoff = new Map<string, { rect: DOMRect; ghost: HTMLElement; scrim?: HTMLElement }>();

export function rememberBox(key: string, from: Element) {
  const box = from.closest<HTMLElement>('.compose-window, .compose-full');
  if (!box) return;
  const scrim = box.classList.contains('compose-full') ? box.parentElement?.querySelector<HTMLElement>(':scope > .m3-scrim') : null;
  const ghost = box.cloneNode(true) as HTMLElement;
  // Ids stay with the real surface, so a lookup by id or a label's `for` never lands on the copy.
  for (const el of [ghost, ...ghost.querySelectorAll('[id]')]) el.removeAttribute('id');
  // A copy keeps the markup, not what was typed since.
  const fields = box.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea');
  ghost.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach((f, i) => (f.value = fields[i]?.value ?? f.value));
  handoff.set(key, {
    rect: box.getBoundingClientRect(),
    ghost,
    scrim: scrim ? (scrim.cloneNode(true) as HTMLElement) : undefined,
  });
}
