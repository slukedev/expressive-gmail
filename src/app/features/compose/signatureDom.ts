import { sanitizeForEditor } from './paste';
import type { Signature } from './signatures';

/** A .gmail_signature block, so Gmail (and the forgotten-attachment check) knows where your words stop. */
export function signatureBlock(html: string) {
  return `<div class="gmail_signature" data-smartmail="gmail_signature">-- <br>${sanitizeForEditor(html)}</div>`;
}

/** Outside any quoted mail. */
export function findSignature(root: ParentNode): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('.gmail_signature')) {
    if (!el.parentElement?.closest('.gmail_signature, .gmail_quote, blockquote')) return el;
  }
  return null;
}

const normalize = (html: string) => {
  const t = document.createElement('template');
  t.innerHTML = sanitizeForEditor(html);
  return t.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
};

/** Without the "-- " line. */
function contentOf(block: HTMLElement) {
  return block.innerHTML.replace(/^\s*--\s*(&nbsp;)?\s*<br\s*\/?>/i, '');
}

/** Its id, null for none, undefined for one that isn't saved (edited or from elsewhere). */
export function signatureIn(root: ParentNode, signatures: Signature[]): string | null | undefined {
  const block = findSignature(root);
  if (!block) return null;
  const html = normalize(contentOf(block));
  return signatures.find((s) => normalize(s.html) === html)?.id;
}

/** Null takes it out. Only the signature block changes. */
export function applySignature(root: HTMLElement, html: string | null) {
  const block = findSignature(root);
  if (html === null) {
    if (!block) return;
    // The blank lines before it go too, so switching back and forth doesn't pile them up.
    let prev = block.previousSibling;
    while (prev && isBlank(prev)) {
      const p = prev.previousSibling;
      prev.remove();
      prev = p;
    }
    block.remove();
    return;
  }
  const t = document.createElement('template');
  t.innerHTML = signatureBlock(html);
  const next = t.content.firstElementChild!;
  if (block) {
    block.replaceWith(next);
    return;
  }
  // A quote stays after the signature, as Gmail places it.
  const quote = [...root.children].find((c) => c.classList.contains('gmail_quote'));
  const before = quote ? quote.previousSibling : root.lastChild;
  const spacer = before && isBlank(before) ? [] : [document.createElement('br'), document.createElement('br')];
  for (const n of [...spacer, next]) root.insertBefore(n, quote ?? null);
}

function isBlank(n: Node): boolean {
  if (n.nodeType === Node.TEXT_NODE) return !n.textContent?.trim();
  if (!(n instanceof HTMLElement)) return false;
  if (n.tagName === 'BR') return true;
  return (n.tagName === 'DIV' || n.tagName === 'P') && !n.textContent?.trim() && !n.querySelector('img');
}

/** Top-level .gmail_quote blocks. */
export function removeQuotes(root: ParentNode) {
  for (const q of [...root.children]) {
    if (!q.classList.contains('gmail_quote')) continue;
    // The blank line it was inserted after goes with it.
    const prev = q.previousSibling;
    if (prev instanceof HTMLElement && prev.tagName === 'BR') prev.remove();
    q.remove();
  }
}

export function withoutQuotes(html: string) {
  if (!html.includes('gmail_quote')) return html;
  const t = document.createElement('template');
  t.innerHTML = html;
  removeQuotes(t.content);
  return t.innerHTML;
}

/** After the signature, where sending would have put it. */
export function appendQuote(root: HTMLElement, html: string) {
  const t = document.createElement('template');
  t.innerHTML = `<br>${sanitizeForEditor(html)}`;
  const sig = findSignature(root);
  const at = sig && sig.parentNode === root ? sig.nextSibling : null;
  root.insertBefore(t.content, at);
}
