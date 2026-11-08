type KeyEventLike = { isComposing?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean } };

/** An input method's Enter picks a candidate and its arrows move through them, so they aren't ours. Safari ends composition before the committing keydown but still sends 229. */
export function isComposing(e: KeyEventLike): boolean {
  return !!(e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229);
}
