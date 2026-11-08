import DOMPurify from 'dompurify';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { escapeHtml } from '../../lib/format';
import { appendQuote, applySignature, findSignature, removeQuotes } from './signatureDom';
import { INSERT_CONFIG, cleanPaste, isSafeLink, pastedUrl, sanitizeForEditor } from './paste';

export interface EditorHandle {
  /** "start": above everything; "end": after the last thing you wrote (above the signature). */
  focus: (at?: 'start' | 'end') => void;
  exec: (command: string, value?: string) => void;
  insertHtml: (html: string) => void;
  insertText: (text: string) => void;
  /** Replaces the "/query" before the caret. */
  replaceSlash: (html: string) => void;
  getSelectionText: () => string;
  /** The link the caret or selection is in. */
  linkAtSelection: () => { href: string; text: string } | null;
  /** The selection (or the link around the caret) becomes a link, or one is added at the caret. */
  setLink: (href: string, text: string) => void;
  removeLink: () => void;
  /** Keeps other formatting. */
  clearColors: () => void;
  /** Null removes it. */
  setSignature: (html: string | null) => void;
  /** After the signature. */
  appendQuote: (html: string) => void;
  /** For switching between reply and forward. */
  removeQuotes: () => void;
  root: () => HTMLElement | null;
  /** Above the signature and any quoted mail. Paragraphs end in a newline. */
  ownText: () => string;
  /** Keeps the signature and quotes. Returns what was there, for Undo. */
  replaceOwn: (html: string, options?: { restore?: boolean }) => string;
  /** Offsets into ownText(). False when they span formatting and were left alone. */
  replaceInOwn: (start: number, end: number, text: string) => boolean;
}

export interface EditorProps {
  initialHtml: string;
  onChange: (html: string) => void;
  onFiles?: (files: File[]) => void;
  onSlash?: (query: string | null) => void;
  /** Sending is handled by the compose form. */
  onSubmit?: () => void;
  onLink?: () => void;
  placeholder?: string;
  label: string;
  ref?: Ref<EditorHandle>;
  minHeight?: number;
  /** The "/" template picker. */
  activeDescendant?: string;
  controls?: string;
}

/** So a menu or dialog that took focus can act on the selection. */
function useKeptSelection(el: React.RefObject<HTMLDivElement | null>) {
  const kept = useRef<Range | null>(null);
  useEffect(() => {
    const onChange = () => {
      const sel = document.getSelection();
      if (sel?.rangeCount && el.current?.contains(sel.anchorNode)) kept.current = sel.getRangeAt(0).cloneRange();
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [el]);
  return kept;
}

function caretAt(range: Range) {
  const sel = document.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Before the signature and the blank lines above it. */
function bodyEnd(root: HTMLElement): { node: Node | null; blank: Node | null } {
  const sig = findSignature(root);
  let n: Node | null = sig ? sig.previousSibling : root.lastChild;
  if (!sig) {
    while (n && n instanceof HTMLElement && n.classList.contains('gmail_quote')) n = n.previousSibling;
  }
  let blank: Node | null = null;
  while (n && isBlankNode(n)) {
    blank = n;
    n = n.previousSibling;
  }
  return { node: n, blank };
}

/** The signature or the first quoted block, whichever comes first. */
function ownEnd(root: HTMLElement): Node | null {
  const sig = findSignature(root);
  const quote = [...root.children].find((c) => c.classList.contains('gmail_quote') || c.tagName === 'BLOCKQUOTE');
  if (sig && quote) return sig.compareDocumentPosition(quote) & Node.DOCUMENT_POSITION_FOLLOWING ? topLevel(root, sig) : quote;
  return sig ? topLevel(root, sig) : (quote ?? null);
}

function topLevel(root: HTMLElement, n: Node): Node {
  while (n.parentNode && n.parentNode !== root) n = n.parentNode;
  return n;
}

const BLOCKS = new Set(['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'UL', 'OL', 'TR']);

/** Blocks and <br> as newlines. */
function ownTextMap(root: HTMLElement): { text: string; nodes: { node: Text; at: number }[] } {
  const end = ownEnd(root);
  const nodes: { node: Text; at: number }[] = [];
  let text = '';
  const walk = (n: Node) => {
    if (n === end) return false;
    if (n.nodeType === Node.TEXT_NODE) {
      nodes.push({ node: n as Text, at: text.length });
      text += n.textContent ?? '';
      return true;
    }
    if (n instanceof HTMLElement) {
      if (n.tagName === 'BR') {
        text += '\n';
        return true;
      }
      const block = BLOCKS.has(n.tagName);
      if (block && text && !text.endsWith('\n')) text += '\n';
      for (const c of [...n.childNodes]) if (walk(c) === false) return false;
      if (block && text && !text.endsWith('\n')) text += '\n';
      // Paragraphs read as paragraphs: a blank line after each.
      if (n.tagName === 'P' && text && !text.endsWith('\n\n')) text += '\n';
    }
    return true;
  };
  for (const c of [...root.childNodes]) if (walk(c) === false) break;
  return { text, nodes };
}

function isBlankNode(n: Node) {
  if (n.nodeType === Node.TEXT_NODE) return !n.textContent?.trim();
  if (!(n instanceof HTMLElement)) return false;
  return n.tagName === 'BR' || ((n.tagName === 'DIV' || n.tagName === 'P') && !n.textContent?.trim() && !n.querySelector('img'));
}

export function Editor({ initialHtml, onChange, onFiles, onSlash, onLink, placeholder, label, ref, minHeight, activeDescendant, controls }: EditorProps) {
  const el = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(!initialHtml.replace(/<[^>]+>/g, '').trim());
  const kept = useKeptSelection(el);
  // Cmd/Ctrl+Shift+V pastes plain text, as in Docs.
  const plainPaste = useRef(false);

  useEffect(() => {
    if (el.current) el.current.innerHTML = sanitizeForEditor(initialHtml);
    // Only on mount: the editor owns its DOM afterwards.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const emit = () => {
    const html = el.current?.innerHTML ?? '';
    setEmpty(!el.current?.textContent?.trim() && !el.current?.querySelector('img'));
    onChange(html);
    if (onSlash) onSlash(slashQuery());
  };

  /** Without scrolling the page, putting back the selection a menu or dialog took. */
  const restore = () => {
    const node = el.current;
    if (!node) return;
    const sel = document.getSelection();
    // Read before focusing: focus alone drops the caret at the start.
    const inside = document.activeElement === node && !!sel?.rangeCount && node.contains(sel.anchorNode);
    if (document.activeElement !== node) node.focus({ preventScroll: true });
    if (!inside && kept.current && node.contains(kept.current.startContainer)) caretAt(kept.current);
  };

  const focusAt = (at: 'start' | 'end') => {
    const node = el.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    const range = document.createRange();
    if (at === 'start') {
      range.setStart(node, 0);
    } else {
      const { node: last, blank } = bodyEnd(node);
      if (last) {
        range.selectNodeContents(last);
        range.collapse(false);
      } else if (blank) {
        range.setStartBefore(blank);
      } else {
        range.setStart(node, 0);
      }
    }
    caretAt(range);
    // Inside the editor's own scroll box.
    (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.scrollIntoView?.({ block: 'nearest' });
  };

  /** Else the one kept from before a menu or dialog took focus. */
  const current = (): Range | null => {
    const sel = document.getSelection();
    if (sel?.rangeCount && el.current?.contains(sel.anchorNode)) {
      kept.current = sel.getRangeAt(0).cloneRange();
      return kept.current;
    }
    return kept.current && el.current?.contains(kept.current.startContainer) ? kept.current : null;
  };

  const closestLink = (): HTMLAnchorElement | null => {
    const r = current();
    if (!r || !el.current) return null;
    const start = r.startContainer instanceof Element ? r.startContainer : r.startContainer.parentElement;
    const a = start?.closest('a');
    return a && el.current.contains(a) ? a : null;
  };

  useImperativeHandle(ref, () => ({
    ownText: () => (el.current ? ownTextMap(el.current).text.replace(/\n+$/, '') : ''),
    replaceOwn: (html, options) => {
      const node = el.current;
      if (!node) return '';
      // Straight on the DOM: insertHTML across the signature's edge pulls its "--" line out of it.
      const end = ownEnd(node);
      const before: Node[] = [];
      for (const c of [...node.childNodes]) {
        if (c === end) break;
        before.push(c);
      }
      const box = document.createElement('div');
      before.forEach((c) => box.append(c.cloneNode(true)));
      before.forEach((c) => (c as ChildNode).remove());
      const fresh = document.createElement('template');
      // Undo puts back the editor's own markup; anything new is cleaned like a paste.
      fresh.innerHTML = options?.restore ? sanitizeForEditor(html) : (DOMPurify.sanitize(html, INSERT_CONFIG) as string);
      // A blank line before the signature, as Gmail leaves it.
      if (end && html.trim() && !options?.restore && !/<div><br><\/div>\s*$/.test(html)) fresh.content.append(Object.assign(document.createElement('div'), { innerHTML: '<br>' }));
      node.insertBefore(fresh.content, end);
      node.focus({ preventScroll: true });
      focusAt('end');
      emit();
      return box.innerHTML;
    },
    replaceInOwn: (start, end, text) => {
      const node = el.current;
      if (!node) return false;
      const { nodes } = ownTextMap(node);
      const hit = nodes.find((n) => start >= n.at && end <= n.at + (n.node.textContent?.length ?? 0));
      if (!hit) return false;
      node.focus({ preventScroll: true });
      const range = document.createRange();
      range.setStart(hit.node, start - hit.at);
      range.setEnd(hit.node, end - hit.at);
      caretAt(range);
      document.execCommand('insertText', false, text);
      emit();
      return true;
    },
    focus: (at) => {
      const node = el.current;
      if (!node) return;
      // Without a place, a caret already in the message stays.
      if (!at && current()) {
        restore();
        return;
      }
      focusAt(at ?? 'start');
    },
    exec: (command, value) => {
      restore();
      document.execCommand(command, false, value);
      emit();
    },
    insertHtml: (html) => {
      restore();
      document.execCommand('insertHTML', false, DOMPurify.sanitize(html, INSERT_CONFIG) as string);
      emit();
    },
    insertText: (text) => {
      restore();
      document.execCommand('insertText', false, text);
      emit();
    },
    replaceSlash: (html) => {
      const sel = window.getSelection();
      const q = slashQuery();
      if (sel && q !== null && sel.anchorNode) {
        const range = sel.getRangeAt(0);
        range.setStart(sel.anchorNode, Math.max(0, sel.anchorOffset - q.length - 1));
        sel.removeAllRanges();
        sel.addRange(range);
      }
      document.execCommand('insertHTML', false, DOMPurify.sanitize(html, INSERT_CONFIG) as string);
      emit();
    },
    getSelectionText: () => {
      const r = current();
      return r ? r.toString() : '';
    },
    linkAtSelection: () => {
      const a = closestLink();
      return a ? { href: a.getAttribute('href') ?? '', text: a.textContent ?? '' } : null;
    },
    setLink: (href, text) => {
      if (!isSafeLink(href)) return;
      const a = closestLink();
      restore();
      if (a) {
        a.setAttribute('href', href);
        if (text && text !== a.textContent) a.textContent = text;
        const after = document.createRange();
        after.setStartAfter(a);
        caretAt(after);
      } else {
        const selected = kept.current && !kept.current.collapsed ? kept.current.toString() : '';
        if (selected && (!text || text === selected)) document.execCommand('createLink', false, href);
        else document.execCommand('insertHTML', false, `<a href="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`);
      }
      emit();
    },
    removeLink: () => {
      const a = closestLink();
      if (!a) return;
      restore();
      const range = document.createRange();
      range.selectNodeContents(a);
      caretAt(range);
      document.execCommand('unlink');
      emit();
    },
    clearColors: () => {
      const node = el.current;
      const r = kept.current;
      if (!node || !r) return;
      for (const c of [...node.querySelectorAll<HTMLElement>('font[color], [style*="color"]')]) {
        if (!r.intersectsNode(c)) continue;
        if (c.tagName === 'FONT' && !c.getAttribute('size')) c.replaceWith(...c.childNodes);
        else {
          c.removeAttribute('color');
          c.style.removeProperty('color');
          c.style.removeProperty('background-color');
          if (!c.getAttribute('style')) c.removeAttribute('style');
        }
      }
      emit();
    },
    setSignature: (html) => {
      const node = el.current;
      if (!node) return;
      applySignature(node, html);
      emit();
    },
    appendQuote: (html) => {
      const node = el.current;
      if (!node) return;
      appendQuote(node, html);
      emit();
    },
    removeQuotes: () => {
      const node = el.current;
      if (!node || !node.querySelector(':scope > .gmail_quote')) return;
      removeQuotes(node);
      emit();
    },
    root: () => el.current,
  }));

  function slashQuery(): string | null {
    const sel = window.getSelection();
    if (!sel?.anchorNode || !el.current?.contains(sel.anchorNode) || sel.anchorNode.nodeType !== Node.TEXT_NODE) return null;
    const before = (sel.anchorNode.textContent ?? '').slice(0, sel.anchorOffset);
    const m = before.match(/(?:^|\s)\/([\w-]{0,24})$/);
    return m ? m[1] : null;
  }

  const run = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    emit();
  };

  const inQuote = () => {
    const sel = document.getSelection();
    const n = sel?.anchorNode;
    const start = n instanceof Element ? n : n?.parentElement;
    const q = start?.closest('blockquote');
    return !!q && !!el.current?.contains(q);
  };

  return (
    <div
      className="editor"
      style={minHeight ? { minHeight } : undefined}
      onMouseDown={(e) => {
        // A click under the text lands where you were writing, not after the signature.
        const node = el.current;
        if (!node || (e.target !== node && e.target !== e.currentTarget)) return;
        const sig = findSignature(node);
        const below = sig ? sig.getBoundingClientRect().bottom : node.lastElementChild?.getBoundingClientRect().bottom ?? 0;
        if (e.clientY > below || e.target === e.currentTarget) {
          e.preventDefault();
          focusAt('end');
        }
      }}
    >
      <div
        ref={el}
        className="editor__content"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        aria-activedescendant={activeDescendant}
        aria-controls={controls}
        data-placeholder={placeholder}
        data-empty={empty || undefined}
        suppressContentEditableWarning
        spellCheck
        onInput={emit}
        onKeyDown={(e) => {
          // Letters typed here never reach the app's single-key shortcuts.
          e.stopPropagation();
          const mod = e.metaKey || e.ctrlKey;
          const key = e.key.toLowerCase();
          plainPaste.current = mod && e.shiftKey && key === 'v';
          const toggles: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' };
          if (mod && !e.shiftKey && !e.altKey && toggles[key]) {
            // Some browsers (WebKit without its menu bar) don't do it themselves.
            e.preventDefault();
            run(toggles[key]);
          } else if (mod && !e.shiftKey && key === 'k') {
            if (!onLink) return;
            e.preventDefault();
            onLink();
          } else if (mod && e.shiftKey && (e.code === 'Digit7' || e.key === '&')) {
            e.preventDefault();
            run('insertOrderedList');
          } else if (mod && e.shiftKey && (e.code === 'Digit8' || e.key === '*')) {
            e.preventDefault();
            run('insertUnorderedList');
          } else if (mod && e.shiftKey && (e.code === 'Digit9' || e.key === '(')) {
            e.preventDefault();
            if (inQuote()) run('outdent');
            else run('formatBlock', 'blockquote');
          } else if (mod && e.shiftKey && key === 'x') {
            e.preventDefault();
            run('strikeThrough');
          } else if (mod && !e.shiftKey && e.key === ']') {
            e.preventDefault();
            run('indent');
          } else if (mod && !e.shiftKey && e.key === '[') {
            e.preventDefault();
            run('outdent');
          } else if (mod && e.key === '\\') {
            e.preventDefault();
            run('removeFormat');
          } else if (e.key === 'Tab' && !mod && !e.altKey) {
            // Tab nests a list item; anywhere else it moves on.
            const sel = document.getSelection();
            const n = sel?.anchorNode;
            const li = (n instanceof Element ? n : n?.parentElement)?.closest('li');
            if (li && el.current?.contains(li)) {
              e.preventDefault();
              run(e.shiftKey ? 'outdent' : 'indent');
            }
          }
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            onFiles?.(files);
            return;
          }
          const text = e.clipboardData.getData('text/plain');
          const url = pastedUrl(text);
          const sel = document.getSelection();
          if (url && sel && !sel.isCollapsed) {
            e.preventDefault();
            run('createLink', url);
            return;
          }
          if (plainPaste.current) {
            plainPaste.current = false;
            e.preventDefault();
            run('insertText', text);
            return;
          }
          const html = e.clipboardData.getData('text/html');
          if (html) {
            e.preventDefault();
            run('insertHTML', cleanPaste(html));
          }
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files.length) {
            e.preventDefault();
            onFiles?.([...e.dataTransfer.files]);
          }
        }}
      />
    </div>
  );
}
