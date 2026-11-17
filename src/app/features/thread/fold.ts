/** The middle of a long conversation that folds into Gmail's "N older messages": everything between the first message and the first one open, keeping at least the last two. */
export function foldedMessages<T>(messages: T[], isExpanded: (m: T) => boolean): T[] {
  if (messages.length <= 4) return [];
  const firstExpanded = messages.findIndex(isExpanded);
  const keepTail = Math.max(2, messages.length - Math.max(firstExpanded, 1));
  const middle = messages.slice(1, Math.max(1, messages.length - keepTail));
  // Folding one message saves nothing.
  return middle.length > 1 ? middle : [];
}
