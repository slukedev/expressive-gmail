import { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from '../../data/client';
import type { Message } from '../../data/types';
import { sanitizeEmail, splitQuoted, textToHtml } from '../../lib/sanitize';
import { useResolvedDark } from '../../theme/ThemeProvider';
import { Tooltip } from '../../ui/Tooltip';
import { composeFromMailto } from '../compose/open';
import { openUrl } from '../../lib/host';
import { snack } from '../../ui/Snackbar';
import { useSettings } from '../../state/settings';
import { Icon } from '../../ui/Icon';
import { adaptDocument, parseColor } from '../darkmail/adapt';
import { useShowsOriginal } from '../darkmail/original';
import { useBodySizing } from './sizing';
import '../darkmail/darkmail.css';

let frameSeq = 0;
const FRAME_CSS_ID = 'bg-frame-css';

/** In dark mode they're darkened, or keep a light "paper". */
export function isDesigned(html: string) {
  return /bgcolor=|background(-color)?\s*:|<table[^>]+width=["']?\d{3}/i.test(html);
}

const cid = (id: string) => id.replace(/^<|>$/g, '');

/** Ones with a preview URL go into the first render; the rest fill into the open frame as they arrive. */
function useCidMap(message: Message) {
  // Keyed on content: a label change hands over a new message object.
  const { id, attachments, bodyHtml } = message;
  const known = useMemo(
    () => new Map(attachments.flatMap((a) => (a.contentId && a.previewUrl ? [[cid(a.contentId), a.previewUrl] as const] : []))),
    [attachments],
  );
  const [fetched, setFetched] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const inline = attachments.filter((a) => a.contentId && !a.previewUrl);
    if (!inline.length || !bodyHtml?.includes('cid:')) return;
    let cancelled = false;
    const urls: string[] = [];
    void Promise.all(
      inline.map(async (a) => {
        const { data, mimeType } = await backend().getAttachment(id, a.id);
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: mimeType || a.mimeType }));
        urls.push(url);
        return [a.contentId!, url] as const;
      }),
    )
      .then((pairs) => !cancelled && setFetched(new Map(pairs.map(([k, v]) => [cid(k), v]))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [id, attachments, bodyHtml]);
  return { known, fetched };
}

/** Then it shows anyway; pictures fade in when ready. */
const DECODE_WAIT_MS = 250;
/** WebKit can stall a decode. */
const DECODE_GIVE_UP_MS = 1500;
const watched = new WeakSet<HTMLImageElement>();

/** Every picture starts hidden (data-bg-wait) and shows exactly once, after it has downloaded and decoded, so a big one never paints half drawn. Resolves once those already downloaded are ready, or after DECODE_WAIT_MS. */
function watchImages(doc: Document, onSettle: () => void): Promise<unknown> {
  const loaded: Promise<void>[] = [];
  doc.querySelectorAll<HTMLImageElement>('img[data-bg-wait]').forEach((img) => {
    // An inline picture waits for its file; it's watched once fillCids gives it one.
    if (watched.has(img) || img.dataset.cid !== undefined) return;
    watched.add(img);
    const complete = img.complete;
    const arrived = complete
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        });
    const ready = arrived
      .then(() =>
        img.naturalWidth > 0 && typeof img.decode === 'function'
          ? Promise.race([img.decode(), new Promise((r) => setTimeout(r, DECODE_GIVE_UP_MS))])
          : undefined,
      )
      .catch(() => undefined)
      .then(() => {
        delete img.dataset.bgWait;
        onSettle();
      });
    if (complete) loaded.push(ready);
  });
  if (!loaded.length) return Promise.resolve();
  return Promise.race([Promise.all(loaded), new Promise((r) => setTimeout(r, DECODE_WAIT_MS))]);
}

/** The root's scrollHeight never drops below the frame's current height, so a frame could grow but never shrink. */
function contentHeight(doc: Document) {
  const root = doc.documentElement.getBoundingClientRect().height;
  return Math.ceil(Math.max(root, doc.body?.scrollHeight ?? 0));
}

function fillCids(doc: Document, map: Map<string, string>) {
  doc.querySelectorAll<HTMLImageElement>('img[data-cid]').forEach((img) => {
    const url = map.get(img.dataset.cid!);
    if (!url) return;
    delete img.dataset.cid;
    img.src = url;
  });
}

export function EmailBody({ message, loadImages, linksOff }: { message: Message; loadImages: boolean; linksOff?: boolean }) {
  const dark = useResolvedDark();
  const { known: cidMap, fetched: fetchedCids } = useCidMap(message);
  const fetchedRef = useRef(fetchedCids);
  fetchedRef.current = fetchedCids;
  const [showQuoted, setShowQuoted] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(48);
  // Hidden until the frame has measured itself once.
  const [sized, setSized] = useState(false);
  const sizing = useBodySizing();

  useEffect(() => {
    sizing.register(message.id);
    return () => sizing.unregister(message.id);
  }, [sizing, message.id]);
  useEffect(() => {
    if (!sized) return;
    sizing.sized(message.id);
    // Later height changes ease; the first one doesn't.
    const raf = requestAnimationFrame(() => {
      if (frameRef.current) frameRef.current.dataset.sized = '';
    });
    return () => cancelAnimationFrame(raf);
  }, [sized, sizing, message.id]);

  const blockTrackers = useSettings((s) => s.blockTrackers);
  const darkEmails = useSettings((s) => s.darkEmails);
  const original = useShowsOriginal(message.id);
  const { bodyHtml, bodyText, snippet } = message;
  const { main, quoted, designed, trackers } = useMemo(() => {
    if (bodyHtml) {
      let trackers = 0;
      const clean = sanitizeEmail(bodyHtml, {
        blockRemoteImages: !loadImages,
        cidMap,
        disableLinks: linksOff,
        blockTrackers,
        onTrackers: (n) => (trackers = n),
      });
      const parts = splitQuoted(clean);
      return { ...parts, designed: isDesigned(bodyHtml), trackers };
    }
    return { ...textToHtml(bodyText ?? snippet), designed: false, trackers: 0 };
  }, [bodyHtml, bodyText, snippet, loadImages, cidMap, linksOff, blockTrackers]);

  // Gmail on Android darkens designed emails in its dark theme; "View in light theme" undoes it per message.
  const adapt = dark && designed && darkEmails && !original;
  // Mail a person wrote has no design to darken, but Apple Mail and others still hard-code black text that vanishes on the dark pane.
  const fixText = dark && !designed && !original;

  // A theme flip restyles the open frame in place instead of reloading it, unless the email's own colors need rewriting.
  const darkNow = useRef(dark);
  darkNow.current = dark;
  const [html, frameKey] = useMemo(() => {
    const doc = new DOMParser().parseFromString(main, 'text/html');
    // So the effect can tell when the frame already holds this document.
    const key = String(++frameSeq);
    doc.documentElement.setAttribute('data-bg-frame', key);
    if (showQuoted && quoted) {
      const q = doc.createElement('div');
      q.className = 'bg-quoted';
      q.innerHTML = quoted;
      doc.body.appendChild(q);
    }
    for (const img of doc.images) {
      img.setAttribute('data-bg-wait', '');
      // Shrunk to fit, a picture keeps its aspect ratio, so a spacer stays the gap it was drawn as.
      const w = Number(img.getAttribute('width'));
      const h = Number(img.getAttribute('height'));
      if (w > 0 && h > 0 && !img.style.aspectRatio) img.style.aspectRatio = `${w} / ${h}`;
    }
    const style = doc.createElement('style');
    style.id = FRAME_CSS_ID;
    style.textContent = frameCss(designed, darkNow.current, adapt);
    doc.head.prepend(style);
    return [`<!doctype html>${doc.documentElement.outerHTML}`, key] as const;
  }, [main, quoted, showQuoted, designed, adapt, fixText]);

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc?.documentElement?.getAttribute('data-bg-frame') !== frameKey) return;
    const style = doc.getElementById(FRAME_CSS_ID);
    const css = frameCss(designed, dark, adapt);
    if (style && style.textContent !== css) style.textContent = css;
  }, [dark, designed, adapt, frameKey]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let ro: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;
      setHeight(contentHeight(doc));
      setSized(true);
    };
    // Hidden until its colors are rewritten, so a dark pane never flashes a white email.
    if (adapt || fixText) frame.dataset.adapting = '';
    let done = false;
    let live = true;
    let clickDoc: Document | null = null;
    let themeObserver: MutationObserver | null = null;
    const onLoad = () => {
      const doc = frame.contentDocument;
      if (!doc || done) return;
      done = true;
      if ((adapt || fixText) && doc.body) {
        const paper = parseColor(getComputedStyle(frame.parentElement ?? frame).backgroundColor);
        try {
          adaptDocument(doc, paper && paper.a > 0 ? { ...paper, a: 1 } : { r: 30, g: 31, b: 32, a: 1 }, { textOnly: !adapt });
        } catch {
          // A document the walk can't handle still shows, in its own colors.
        }
      }
      delete frame.dataset.adapting;
      // The theme may have flipped while the frame loaded.
      const style = doc.getElementById(FRAME_CSS_ID);
      const css = frameCss(designed, darkNow.current, adapt);
      if (style && style.textContent !== css) style.textContent = css;
      syncSelection(doc);
      themeObserver = new MutationObserver(() => syncSelection(doc));
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme-mode'] });
      fillCids(doc, fetchedRef.current);
      clickDoc = doc;
      doc.addEventListener('click', onClick);
      doc.addEventListener('keydown', onKey);
      void watchImages(doc, measure).then(() => {
        if (!live) return;
        measure();
        ro = new ResizeObserver(measure);
        ro.observe(doc.documentElement);
      });
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest?.('a');
      if (!a) return;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#')) return;
      e.preventDefault();
      if (linksOff || a.hasAttribute('data-href')) {
        snack('Links are turned off for messages in Spam. Move it out of Spam to use them.');
        return;
      }
      if (href.startsWith('mailto:')) {
        composeFromMailto(href);
      } else if (/^https?:/i.test(href)) {
        openUrl(href);
      }
    };
    // Keys pressed after clicking into an email land in its document; the app's shortcuts listen on this window. WebKit runs no listeners in a frame without allow-scripts, so Safari still loses them.
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '')) return;
      const copy = new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        location: e.location,
        repeat: e.repeat,
        isComposing: e.isComposing,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(copy);
      if (copy.defaultPrevented) e.preventDefault();
    };
    frame.addEventListener('load', onLoad);
    // A srcdoc can finish loading before this effect runs (a busy WebKit does), and then no load event comes.
    const loaded = frame.contentDocument;
    if (loaded?.readyState === 'complete' && loaded.documentElement?.getAttribute('data-bg-frame') === frameKey) onLoad();
    return () => {
      live = false;
      frame.removeEventListener('load', onLoad);
      themeObserver?.disconnect();
      clickDoc?.removeEventListener('click', onClick);
      clickDoc?.removeEventListener('keydown', onKey);
      ro?.disconnect();
    };
  }, [html, frameKey, linksOff, adapt, designed, fixText]);

  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!fetchedCids.size || doc?.documentElement?.getAttribute('data-bg-frame') !== frameKey) return;
    fillCids(doc, fetchedCids);
    watchImages(doc, () => setHeight(contentHeight(doc)));
  }, [fetchedCids, frameKey]);

  return (
    <>
      <div className="msg__body" data-designed={designed || undefined} data-adapted={adapt || undefined}>
        <iframe
          ref={frameRef}
          title={`Message from ${message.from.name ?? message.from.email}`}
          className="msg__frame"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={html}
          data-sizing={sized ? undefined : ''}
          // Must match the document's own color-scheme, or the browser paints an opaque backdrop behind it.
          style={{ height, colorScheme: (designed && !adapt) || !dark ? 'light' : 'dark' }}
        />
        {quoted && (
          <Tooltip content={showQuoted ? 'Hide expanded content' : 'Show trimmed content'}>
            <button
              type="button"
              className="msg__trimmed"
              aria-expanded={showQuoted}
              aria-label={showQuoted ? 'Hide expanded content' : 'Show trimmed content'}
              onClick={() => setShowQuoted((s) => !s)}
            >
              <Icon name="more_horiz" size={20} />
            </button>
          </Tooltip>
        )}
      </div>
      {/* Under the message, not inside it: a designed email's white page is the sender's. */}
      {trackers > 0 && (
        <Tooltip content="Invisible images that tell the sender when you open their email. Removed before the message loaded.">
          <p className="msg__trackers md-label-medium" tabIndex={0}>
            <Icon name="shield" size={16} />
            {trackers === 1 ? '1 tracker blocked' : `${trackers} trackers blocked`}
          </p>
        </Tooltip>
      )}
    </>
  );
}

/** Follows theme changes. */
function syncSelection(doc: Document) {
  // The theme sets its roles inline on the root; reading them there skips a forced style recalc.
  const inline = document.documentElement.style;
  const root = inline.getPropertyValue('--md-sys-color-primary') ? inline : getComputedStyle(document.documentElement);
  const bg = root.getPropertyValue('--md-sys-color-primary').trim();
  const fg = root.getPropertyValue('--md-sys-color-on-primary').trim();
  if (bg && fg) {
    doc.documentElement.style.setProperty('--bg-sel', bg);
    doc.documentElement.style.setProperty('--bg-on-sel', fg);
  }
}

// For a frame painted before the theme reaches it.
function selectionColors(dark: boolean) {
  return dark ? { bg: '#a8c7fa', fg: '#062e6f' } : { bg: '#0b57d0', fg: '#ffffff' };
}

function frameCss(designed: boolean, dark: boolean, adapt = false) {
  // A darkened email reads like plain mail in the dark theme.
  const light = (designed && !adapt) || !dark;
  const text = light ? '#1f1f1f' : '#e3e3e3';
  const link = light ? '#0b57d0' : '#a8c7fa';
  const quote = light ? '#5e5e5e' : '#c4c7c5';
  // Selected text is always readable, whatever colors the sender chose.
  const selection = selectionColors(dark);
  return `
@font-face{font-family:'Google Sans Flex';src:url('/fonts/google-sans-flex-latin.woff2') format('woff2');font-weight:300 800}
html,body{margin:0;padding:0}
html{background:transparent;color:${text};color-scheme:${light ? 'light' : 'dark'}}
body{font:400 14px/1.5 'Google Sans Flex','Google Sans Text',Roboto,Arial,sans-serif;letter-spacing:.1px;overflow-wrap:break-word;overflow-x:auto;overflow-y:hidden;padding:${designed ? '16px' : '0'};}
${designed ? '' : /* Mail a person wrote reads at BodyLarge and stops at a comfortable measure. */ 'body{font-size:16px;line-height:24px;letter-spacing:.15px;max-width:72ch}'}
:where(body:not([link])) a{color:${link}}
img{transition:opacity .15s}
img[data-bg-wait]{opacity:0}
@media (prefers-reduced-motion:reduce){img{transition:none}}
a[aria-disabled]{cursor:not-allowed;opacity:.7}
img{max-width:100%;height:auto;transition:opacity .25s cubic-bezier(.05,.7,.1,1)}
img[data-loading],img[data-cid]{opacity:0}
table{max-width:100%}
img[data-blocked-src]{display:inline-block;min-width:24px;min-height:24px;background:#e9eef6;border-radius:8px}
blockquote{margin:8px 0!important;padding:8px 12px!important;border:none!important;border-radius:12px;background:${light ? 'rgba(11,87,208,.05)' : 'rgba(168,199,250,.08)'};color:${quote}}
.bg-quoted{margin-top:12px;color:${quote}}
body>br:last-child{display:none}
pre,code{font-family:ui-monospace,Menlo,monospace;font-size:13px}
*::selection{background:var(--bg-sel,${selection.bg})!important;color:var(--bg-on-sel,${selection.fg})!important;-webkit-text-fill-color:var(--bg-on-sel,${selection.fg})!important;text-shadow:none!important}
`;
}
