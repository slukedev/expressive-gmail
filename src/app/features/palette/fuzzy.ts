/** Each item is prepared once (lowercased, accents folded, word starts found) so a keystroke only scans. */

export interface Searchable {
  title: string;
  /** Aliases ("trash" for Delete), the setting's section. */
  keywords?: string;
}

export interface Prepared {
  title: string;
  /** Same length as `title` so hit positions line up. */
  lower: string;
  starts: Uint8Array;
  keywords: string[];
}

export interface Match {
  score: number;
  /** For highlighting. */
  hits: number[];
}

/** One character per character so positions survive. */
function fold(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(s)) return s.toLowerCase();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const lower = ch.normalize('NFD')[0]!.toLowerCase();
    out += lower.length === 1 ? lower : ch;
  }
  return out;
}

const SEPARATOR = /[\s/._:,()“”"'-]/;

export function prepare(item: Searchable): Prepared {
  const lower = fold(item.title);
  const starts = new Uint8Array(lower.length);
  for (let i = 0; i < lower.length; i++) {
    const prev = lower[i - 1];
    starts[i] = i === 0 || (prev !== undefined && SEPARATOR.test(prev) && !SEPARATOR.test(lower[i]!)) ? 1 : 0;
  }
  const keywords = item.keywords ? fold(item.keywords).split(/\s+/).filter(Boolean) : [];
  return { title: item.title, lower, starts, keywords };
}

/** A word prefix, then any substring, then the characters in order ("mar" for Mark as read). */
function matchWord(word: string, p: Prepared, taken: Set<number>): Match | null {
  const { lower, starts } = p;
  for (let i = lower.indexOf(word); i >= 0; i = lower.indexOf(word, i + 1)) {
    if (starts[i] && !taken.has(i)) return { score: 30 + word.length * 4 - Math.min(i, 20) * 0.25, hits: range(i, word.length) };
  }
  const at = lower.indexOf(word);
  if (at >= 0 && !taken.has(at)) return { score: 14 + word.length * 2 - Math.min(at, 20) * 0.25, hits: range(at, word.length) };
  if (word.length < 2) return null;
  return subsequence(word, p);
}

function range(start: number, n: number) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(start + i);
  return out;
}

/** Greedy from each candidate first character, plenty for titles this short. */
function subsequence(word: string, p: Prepared): Match | null {
  const { lower, starts } = p;
  let best: Match | null = null;
  for (let first = lower.indexOf(word[0]!); first >= 0; first = lower.indexOf(word[0]!, first + 1)) {
    // Scattered letters only count from a word start ("mr" in Mark as read, not "xq" in inboX Quick).
    if (!starts[first]) continue;
    const hits = [first];
    let score = 6;
    let pos = first;
    for (let k = 1; k < word.length; k++) {
      const ch = word[k]!;
      // Prefer the next word start with this character; otherwise the nearest.
      let next = -1;
      for (let j = pos + 1; j < lower.length; j++) {
        if (lower[j] !== ch) continue;
        if (j === pos + 1) {
          next = j;
          break;
        }
        if (starts[j]) {
          next = j;
          break;
        }
        if (next < 0) next = j;
      }
      if (next < 0) {
        score = -1;
        break;
      }
      score += next === pos + 1 ? 4 : starts[next] ? 5 : 0.5;
      score -= Math.min(next - pos - 1, 8) * 0.15;
      hits.push(next);
      pos = next;
    }
    if (score > 0 && (!best || score > best.score)) best = { score, hits };
  }
  // A scattered match is weak; keep it below any real substring.
  return best && best.score >= word.length * 2 ? { score: Math.min(best.score, 13), hits: best.hits } : null;
}

/** Null when some word doesn't match. */
export function match(query: string, p: Prepared): Match | null {
  const q = fold(query).trim();
  if (!q) return { score: 0, hits: [] };
  // The whole query at the very start is the strongest signal.
  if (p.lower.startsWith(q)) return { score: 100 + q.length * 4 - p.lower.length * 0.1, hits: range(0, q.length) };
  const words = q.split(/\s+/);
  let score = 0;
  const hits: number[] = [];
  const taken = new Set<number>();
  for (const w of words) {
    const m = matchWord(w, p, taken);
    if (m) {
      score += m.score;
      for (const h of m.hits) {
        hits.push(h);
        taken.add(h);
      }
      continue;
    }
    // Aliases count only from the start of one of their words.
    if (p.keywords.some((k) => k.startsWith(w))) {
      score += 8 + w.length;
      continue;
    }
    return null;
  }
  // A whole phrase in the title as typed beats scattered words.
  if (words.length > 1 && p.lower.includes(q)) score += 20;
  return { score: score - p.lower.length * 0.05, hits: hits.sort((a, b) => a - b) };
}

export function highlight(title: string, hits: number[]): { text: string; hit: boolean }[] {
  if (!hits.length) return [{ text: title, hit: false }];
  const set = new Set(hits);
  const out: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < title.length; i++) {
    const hit = set.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += title[i];
    else out.push({ text: title[i]!, hit });
  }
  return out;
}
