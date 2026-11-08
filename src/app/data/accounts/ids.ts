// Merged scopes qualify ids as "<key>~<id>"; single-account scopes use the backend's ids untouched.
// Anything kept in this browser uses the raw id, so it follows a thread between scopes.

const SEP = '~';

/** FNV-1a, base 36. */
export function accountKey(email: string): string {
  let h = 0x811c9dc5;
  for (const ch of email.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

export function qualify(key: string, id: string): string {
  return `${key}${SEP}${id}`;
}

export function splitId(id: string): { key?: string; raw: string } {
  const at = id.indexOf(SEP);
  // Keys are 7 base-36 characters; anything else is a backend id that happens to contain "~".
  if (at !== 7 || !/^[0-9a-z]{7}$/.test(id.slice(0, at))) return { raw: id };
  return { key: id.slice(0, at), raw: id.slice(at + 1) };
}

export function rawId(id: string): string {
  return splitId(id).raw;
}

/** Merged user labels are matched by name across accounts. */
const LABEL_PREFIX = 'L~';

export function mergedLabelId(name: string): string {
  return `${LABEL_PREFIX}${name}`;
}

export function mergedLabelName(id: string): string | undefined {
  return id.startsWith(LABEL_PREFIX) ? id.slice(LABEL_PREFIX.length) : undefined;
}
