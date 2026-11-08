/** A Google response with nothing personal left, for bug reports: addresses keep their domain, URLs their host and first path segment, inline images their type and size, other strings their length. */

const EMAIL = /^[^\s@<>()",;]+@([^\s@<>()",;]+\.[^\s@<>()",;]+)$/;

/** One string as its tag: `<url:lh3.googleusercontent.com/a>`, `<email:gmail.com>`, `<data:image/png:3KB>`. */
export function tag(value: string): string {
  const data = /^data:([\w.+/-]+?)(;[^,]*)?,/.exec(value);
  if (data) return `<data:${data[1]}:${Math.max(1, Math.round((value.length * 3) / 4 / 1024))}KB>`;
  if (/^(https?:)?\/\//i.test(value)) {
    try {
      const url = new URL(value, 'https://x.invalid');
      const first = url.pathname.split('/').filter(Boolean)[0];
      // Only a short, plain first segment ("a", "ogw", "proxy"); anything longer could be an id.
      return `<url:${url.host}${first && /^[a-z-]{1,12}$/i.test(first) ? `/${first}` : ''}>`;
    } catch {
      return `<str:${value.length}>`;
    }
  }
  const email = EMAIL.exec(value.trim());
  if (email) return `<email:${email[1]!.toLowerCase()}>`;
  return `<str:${value.length}>`;
}

/** The shape as compact JSON, cut at about `max` characters. */
export function redactedShape(root: unknown, max = 4096): string {
  let out = '';
  let full = false;
  const write = (s: string) => {
    if (full) return;
    if (out.length + s.length > max) {
      out += '…';
      full = true;
    } else out += s;
  };
  const visit = (node: unknown, depth: number) => {
    if (full) return;
    if (node === null || typeof node === 'number' || typeof node === 'boolean') return write(JSON.stringify(node));
    if (typeof node === 'string') return write(JSON.stringify(tag(node)));
    if (depth > 40) return write('"<deep>"');
    if (Array.isArray(node)) {
      write('[');
      node.forEach((child, i) => {
        if (i) write(',');
        visit(child, depth + 1);
      });
      return write(']');
    }
    if (typeof node === 'object') {
      write('{');
      Object.entries(node as Record<string, unknown>).forEach(([key, child], i) => {
        if (i) write(',');
        write(`${JSON.stringify(/^[a-z_]{1,20}$/i.test(key) ? key : '<key>')}:`);
        visit(child, depth + 1);
      });
      return write('}');
    }
    write('"<other>"');
  };
  visit(root, 0);
  return out;
}
