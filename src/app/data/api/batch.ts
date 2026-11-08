/**
 * Google API batch requests (multipart/mixed of application/http parts): https://developers.google.com/gmail/api/guides/batch
 * Parts can come back in any order, so they're matched by Content-ID ("<response-item3>" answers "<item3>"), then position.
 * A missing part is status 0 so the caller can retry it. An empty or non-JSON body leaves body undefined and keeps the text.
 */
import { parseHeaderParams } from './payload';

export interface BatchItem {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Relative to the host, e.g. "/gmail/v1/users/me/threads/abc?format=metadata". */
  path: string;
  body?: unknown;
}

export interface BatchResult {
  status: number;
  body?: unknown;
  text: string;
  headers: Record<string, string>;
}

export function buildBatchBody(items: BatchItem[], boundaryValue: string): string {
  const lines: string[] = [];
  items.forEach((item, i) => {
    lines.push(`--${boundaryValue}`);
    lines.push('Content-Type: application/http');
    lines.push(`Content-ID: <item${i}>`);
    lines.push('');
    lines.push(`${item.method} ${item.path} HTTP/1.1`);
    if (item.body !== undefined) {
      const json = JSON.stringify(item.body);
      lines.push('Content-Type: application/json; charset=UTF-8');
      lines.push('');
      lines.push(json);
    } else {
      lines.push('');
    }
  });
  lines.push(`--${boundaryValue}--`, '');
  return lines.join('\r\n');
}

function parseHeaderBlock(block: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

function splitOnce(text: string): [string, string] {
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return [text, ''];
  return [text.slice(0, m.index), text.slice(m.index + m[0].length)];
}

/** Results in request order. */
export function parseBatchResponse(contentType: string | null, body: string, count: number): BatchResult[] {
  const boundaryValue = parseHeaderParams(contentType ?? '').params.boundary;
  const results: (BatchResult | undefined)[] = new Array(count).fill(undefined);
  if (!boundaryValue) {
    return results.map(() => ({ status: 0, text: '', headers: {} }));
  }
  const chunks = body.split(`--${boundaryValue}`);
  // chunks[0] is the preamble; a chunk starting with "--" is the closing delimiter.
  let position = 0;
  for (const chunk of chunks.slice(1)) {
    if (chunk.startsWith('--')) break;
    const trimmed = chunk.replace(/^[ \t]*\r?\n/, '');
    const [outerHead, http] = splitOnce(trimmed);
    const outer = parseHeaderBlock(outerHead);
    const [statusAndHeaders, rawBody] = splitOnce(http);
    const [statusLine, ...headerLines] = statusAndHeaders.split(/\r?\n/);
    const status = Number(/^HTTP\/[\d.]+\s+(\d{3})/.exec(statusLine.trim())?.[1] ?? 0);
    const text = rawBody.replace(/\r?\n$/, '');
    let parsed: unknown;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
    }
    const idMatch = /item(\d+)/.exec(outer['content-id'] ?? '');
    let index = idMatch ? Number(idMatch[1]) : position;
    if (index >= count || results[index]) index = position;
    position++;
    if (index < count) {
      results[index] = { status, body: parsed, text, headers: parseHeaderBlock(headerLines.join('\n')) };
    }
  }
  return results.map((r) => r ?? { status: 0, text: '', headers: {} });
}
