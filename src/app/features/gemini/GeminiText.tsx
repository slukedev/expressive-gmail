import { Fragment, useRef, type ReactNode } from 'react';
import type { GeminiSource } from '../../data/gemini';

type Block = { kind: 'p'; text: string } | { kind: 'ul' | 'ol'; items: string[] };

/** Paragraphs and `-` or `1.` lists; everything else is text. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const last = blocks[blocks.length - 1];
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const item = (bullet ?? numbered)![1]!;
      if (last && last.kind === kind) last.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (!line.trim()) {
      if (last?.kind === 'p' && last.text) blocks.push({ kind: 'p', text: '' });
    } else if (last?.kind === 'p') {
      last.text = last.text ? `${last.text}\n${line}` : line;
    } else {
      blocks.push({ kind: 'p', text: line });
    }
  }
  return blocks.filter((b) => b.kind !== 'p' || b.text.trim());
}

/** Markers and bold marks dropped. */
export function plainText(text: string): string {
  return text
    .replace(/\s?\[(\d+)\]/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

/** Each word's fade-in delay is fixed the first time it shows, so words arriving together come in one after another and none restarts as text streams. A word's key is its position in its line, so React keeps its span as text after it grows. */
class Reveal {
  private readonly delays = new Map<string, number>();
  private fresh = 0;

  /** Once per render, before any words. */
  begin() {
    this.fresh = 0;
  }

  /** `at` is where `text` starts in its line. */
  words(text: string, key: string, at = 0): ReactNode[] {
    let pos = at;
    return text.split(/(\s+)/).map((part) => {
      const start = pos;
      pos += part.length;
      if (!part.trim()) return part;
      const k = `${key}@${start}`;
      let delay = this.delays.get(k);
      if (delay === undefined) {
        delay = Math.min(this.fresh++, STAGGER_WORDS) * STAGGER_MS;
        this.delays.set(k, delay);
      }
      return (
        <span key={k} className="gemini-word" style={delay ? { animationDelay: `${delay}ms` } : undefined}>
          {part}
        </span>
      );
    });
  }
}

/** Words arriving together fan out over at most this many steps. */
const STAGGER_WORDS = 16;
const STAGGER_MS = 18;

function useReveal(): Reveal {
  const ref = useRef<Reveal>(null);
  ref.current ??= new Reveal();
  ref.current.begin();
  return ref.current;
}

function inline(text: string, sources: GeminiSource[] | undefined, onCite: ((i: number) => void) | undefined, key: string, reveal: Reveal): ReactNode[] {
  const out: ReactNode[] = [];
  const plain = (from: number, to: number) => out.push(...reveal.words(text.slice(from, to), key, from));
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\s?\[(\d+)\]/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) plain(at, m.index);
    if (m[1] !== undefined) out.push(<strong key={`${key}b${m.index}`}>{reveal.words(m[1], key, m.index + 2)}</strong>);
    else if (m[2] !== undefined) out.push(<code key={`${key}c${n++}`} className="gemini-word">{m[2]}</code>);
    else {
      const i = Number(m[3]) - 1;
      const src = sources?.[i];
      if (src && onCite) {
        out.push(
          <button
            key={`${key}s${n++}`}
            type="button"
            className="gemini-cite gemini-word"
            onClick={() => onCite(i)}
            aria-label={`Source ${i + 1}: ${src.subject}`}
          >
            {i + 1}
          </button>,
        );
      }
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) plain(at, text.length);
  return out;
}

/** Streaming text renders the same way as it grows. */
export function GeminiText({ text, sources, onCite, className }: { text: string; sources?: GeminiSource[]; onCite?: (i: number) => void; className?: string }) {
  const reveal = useReveal();
  const blocks = parseBlocks(text);
  return (
    <div className={className ?? 'gemini-text'}>
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.text.split('\n').map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(line, sources, onCite, `${i}.${j}`, reveal)}
              </Fragment>
            ))}
          </p>
        ) : b.kind === 'ul' ? (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, sources, onCite, `${i}.${j}`, reveal)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item, sources, onCite, `${i}.${j}`, reveal)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/** Line breaks and spacing kept (for pre-wrap boxes). */
export function GeminiWords({ text }: { text: string }) {
  const reveal = useReveal();
  return <>{reveal.words(text, 'w')}</>;
}

/** One paragraph per block, line breaks kept. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return plainText(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}
