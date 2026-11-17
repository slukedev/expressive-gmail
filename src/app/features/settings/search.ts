const WORD = /[\p{L}\p{N}]+/gu;

/** Lowercased words of a settings search; empty when not searching. */
export function searchWords(query: string): string[] {
  return query.toLowerCase().match(WORD) ?? [];
}

/** Every searched word starts a word somewhere in the texts, so "tab" finds "Promotions tab" but not "Comfortable". */
export function matches(words: string[], ...texts: (string | undefined)[]): boolean {
  const hay = texts.filter(Boolean).join(' ').toLowerCase().match(WORD) ?? [];
  return words.every((w) => hay.some((h) => h.startsWith(w)));
}

/** Splits text into runs, odd ones being the matched word starts to highlight. */
export function highlight(text: string, words: string[]): string[] {
  if (!words.length) return [text];
  const escaped = [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.split(new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})`, 'giu'));
}
