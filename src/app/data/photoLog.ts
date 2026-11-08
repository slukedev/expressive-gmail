/** The last few photo and logo resolutions, for Connection details. It never holds an address or a name: people appear as "*@domain", brands as their domain. */

interface PhotoLogEntry {
  at: number;
  /** "*@gmail.com" for a person, "cvs.com" for a brand. */
  who: string;
  kind: 'person' | 'brand';
  /** Each source tried, with what it said: "favicon e.cvs.com: 404 globe". */
  steps: string[];
  result: 'hit' | 'miss' | 'error';
}

const PHOTO_LOG_SIZE = 30;

export function personLabel(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? `*@${email.slice(at + 1).toLowerCase()}` : '*';
}

/** Replaces every address in a breadcrumb with its domain form. */
function redact(text: string): string {
  return text.replace(/[^\s@<>()",;:]+@([^\s@<>()",;:]+)/g, (_m, domain: string) => `*@${domain.toLowerCase()}`);
}

class PhotoLog {
  private entries: PhotoLogEntry[] = [];
  /** See session/shape.ts. */
  private dumps: { source: string; shape: string }[] = [];
  /** Whether the session saw Gmail's own People Stack request and copied its shape. */
  template: string | undefined;
  private listeners = new Set<() => void>();
  private snapshot: readonly PhotoLogEntry[] = [];

  add(entry: Omit<PhotoLogEntry, 'at'>, at = Date.now()) {
    this.entries = [...this.entries, { ...entry, who: redact(entry.who), steps: entry.steps.map(redact), at }].slice(-PHOTO_LOG_SIZE);
    this.changed();
  }

  addDump(source: string, shape: string) {
    if (this.dumps.length >= 9) return;
    this.dumps.push({ source: redact(source), shape: redact(shape).slice(0, 4200) });
    this.changed();
  }

  setTemplate(value: string | undefined) {
    if (value === this.template) return;
    this.template = value;
    this.changed();
  }

  clear() {
    this.entries = [];
    this.dumps = [];
    this.changed();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snapshot;

  /** Newest last. */
  text(): string {
    const time = (ms: number) => new Date(ms).toTimeString().slice(0, 8);
    return [
      `Gmail request template: ${this.template ?? 'not seen yet, using the built-in one (session mode only)'}`,
      ...(this.entries.length
        ? this.entries.map((e) => `${time(e.at)} ${e.kind} ${e.who} ${e.result}: ${e.steps.join('; ') || 'no source tried'}`)
        : ['No lookups yet: open a few emails and type in To, then copy again.']),
      ...this.dumps.flatMap((d) => ['', `Shape of: ${d.source}`, d.shape]),
    ].join('\n');
  }

  private changed() {
    this.snapshot = [...this.entries];
    this.listeners.forEach((fn) => fn());
  }
}

export const photoLog = new PhotoLog();
