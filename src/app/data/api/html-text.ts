/**
 * HTML to plain text for the text/plain alternative of outgoing mail. Runs in a service worker too, so no DOMParser: a tag-aware string pass.
 * Script, style and head go with their content; blocks get line breaks; links become "text (url)"; entities are decoded after tags are gone,
 * or "&lt;b&gt;" would turn into a tag and be stripped.
 */
import { decodeSnippet } from './payload';

export function htmlToText(html: string): string {
  let s = html.replace(/\r\n?/g, '\n');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  // Source newlines are just whitespace in HTML.
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi, (_m, _q, d, sq, bare, inner: string) => {
    const href: string = (d ?? sq ?? bare ?? '').trim();
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return inner;
    const target = href.replace(/^mailto:/i, '');
    if (!text || text === href || text === target) return target;
    return `${inner} (${target})`;
  });
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  s = s.replace(/<\/(p|div|h[1-6]|blockquote|pre|table|ul|ol|section|article|header|footer)\s*>/gi, '\n\n');
  s = s.replace(/<(p|div|h[1-6]|blockquote|pre|table|ul|ol|section|article|header|footer)\b[^>]*>/gi, '\n\n');
  s = s.replace(/<\/tr\s*>/gi, '\n');
  s = s.replace(/<\/t[dh]\s*>/gi, '\t');
  s = s.replace(/<hr\b[^>]*>/gi, '\n---\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeSnippet(s);
  s = s.replace(/\u00a0/g, ' ');
  s = s
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
