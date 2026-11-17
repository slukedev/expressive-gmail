/**
 * String passes over HTML for plain text, where no DOM is at hand (a service worker, or Gmail's page under
 * Trusted Types). One pass can leave pieces that join into a new match ("<scr<script></script>ipt>"), so each
 * removal repeats until nothing changes.
 */

/** Every match of `re` (a global regex) replaced, again and again, until none is left. */
export function replaceUntilStable(s: string, re: RegExp, by: string): string {
  let prev: string;
  do {
    prev = s;
    s = s.replace(re, by);
  } while (s !== prev);
  return s;
}

/** Tags out, their text kept. */
export function stripTags(html: string, by = ''): string {
  return replaceUntilStable(html, /<[^>]*>/g, by);
}

/** Script and style elements out with their content (and head and title when asked). */
export function stripCodeBlocks(html: string, by = '', withHead = false): string {
  const re = withHead ? /<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi : /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
  return replaceUntilStable(html, re, by);
}

/** Comments out. */
export function stripComments(html: string): string {
  return replaceUntilStable(html, /<!--[\s\S]*?-->/g, '');
}

/** The few named entities plain text needs, with `&amp;` last so "&amp;lt;" stays "&lt;". */
export function decodeBasicEntities(s: string): string {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
