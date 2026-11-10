/**
 * The installed app: the web app manifest the content script gives mail.google.com, and the
 * launches it can bring (a mailto link, a share, files, a shortcut). Pure, so it's tested alone.
 */

/** Marks the URLs the manifest launches, so the hidden Gmail page never sees them. */
export const LAUNCH_PARAM = 'expressive';

export type Launch =
  | { kind: 'compose' }
  | { kind: 'mailto'; href: string }
  | { kind: 'share'; title: string; text: string; url: string }
  /** Files come through the launch queue only; this marks the URL that brought them. */
  | { kind: 'files' }
  | { kind: 'route'; hash: string };

/** What the frame shows and offers. Sent to the app whenever it changes. */
export interface AppHostState {
  /** The browser offered to install (beforeinstallprompt) and nothing is installed from this page yet. */
  installable: boolean;
  /** Running in the app's own window. */
  standalone: boolean;
  /** navigator.setAppBadge exists. */
  badge: boolean;
  /** navigator.registerProtocolHandler exists. */
  mailto: boolean;
}

export const NO_APP_HOST: AppHostState = { installable: false, standalone: false, badge: false, mailto: false };

/** One unread count, "dot" for a plain mark, or null to clear it. */
export type BadgeValue = number | 'dot' | null;

export interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: 'any' | 'maskable';
}

interface ManifestOptions {
  origin: string;
  /** The account slot (/mail/u/N/) that installs, and where the app opens. */
  index: number;
  name: string;
  shortName: string;
  /** The app's surface color, so the window and splash screen match the theme. */
  background: string;
  icons: ManifestIcon[];
}

// Types Gmail can attach and people open from their file manager. No executables.
const FILE_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.avif'],
  'text/plain': ['.txt', '.md'],
  'text/csv': ['.csv'],
  'text/calendar': ['.ics'],
  'application/zip': ['.zip'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'application/vnd.oasis.opendocument.presentation': ['.odp'],
};

/**
 * Every URL is absolute: the manifest is a data: URL, which relative ones would resolve against.
 * The id stays the same for every account and color, so the browser treats it as one app.
 */
export function appManifest(o: ManifestOptions) {
  const base = `${o.origin}/mail/u/${o.index}/`;
  const launch = (what: string) => `${base}?${LAUNCH_PARAM}=${what}`;
  return {
    id: `${o.origin}/mail/?${LAUNCH_PARAM}=app`,
    name: o.name,
    short_name: o.shortName,
    start_url: `${base}#inbox`,
    scope: `${o.origin}/mail/`,
    display: 'standalone',
    background_color: o.background,
    theme_color: o.background,
    categories: ['productivity', 'communication'],
    icons: o.icons,
    shortcuts: [
      { name: 'New message', short_name: 'Compose', url: launch('compose') },
      { name: 'Inbox', url: `${base}#inbox` },
      { name: 'Starred', url: `${base}#starred` },
      { name: 'Drafts', url: `${base}#drafts` },
    ],
    protocol_handlers: [{ protocol: 'mailto', url: `${launch('mailto')}&url=%s` }],
    // GET replaces the action's query with these, so a share is told apart by its fields.
    share_target: {
      action: base,
      method: 'GET',
      enctype: 'application/x-www-form-urlencoded',
      params: { title: 'title', text: 'text', url: 'url' },
    },
    file_handlers: [{ action: launch('files'), accept: FILE_TYPES, launch_type: 'single-client' }],
    // A launch into an open window is handled in place: reloading would reload Gmail underneath too.
    launch_handler: { client_mode: ['focus-existing', 'auto'] },
  };
}

export function manifestDataUrl(manifest: object): string {
  return `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`;
}

const LIMIT = 10_000;
const clip = (s: string | null) => (s ?? '').slice(0, LIMIT);

/** What a launch URL asks for, or null for an ordinary Gmail URL. */
export function readLaunch(url: URL): Launch | null {
  if (!/^\/mail\/(u\/\d{1,2}\/)?$/.test(url.pathname)) return null;
  const p = url.searchParams;
  const what = p.get(LAUNCH_PARAM);
  if (what === 'compose') return { kind: 'compose' };
  if (what === 'files') return { kind: 'files' };
  if (what === 'mailto' || p.get('extsrc') === 'mailto') {
    const href = p.get('url') ?? '';
    return /^mailto:/i.test(href) ? { kind: 'mailto', href: clip(href) } : { kind: 'compose' };
  }
  // Gmail's own URLs never carry these on the inbox page.
  if (!what && (p.has('title') || p.has('text') || p.has('url')) && !p.has('view') && !p.has('ui')) {
    const share = { kind: 'share' as const, title: clip(p.get('title')).trim(), text: clip(p.get('text')).trim(), url: clip(p.get('url')).trim() };
    return share.title || share.text || share.url ? share : null;
  }
  return null;
}

/** The same URL without what `readLaunch` read, for the address bar and the Gmail page underneath. */
export function withoutLaunch(url: URL): string {
  if (!readLaunch(url)) return url.href;
  const out = new URL(url.href);
  for (const k of [LAUNCH_PARAM, 'extsrc', 'url', 'title', 'text']) out.searchParams.delete(k);
  return `${out.pathname}${out.search}${out.hash || '#inbox'}`;
}

/**
 * A launch into the window that's already open (launch_handler focus-existing). A shortcut to
 * another view arrives as its hash; another account's URL is for that account's page.
 */
export function launchInPlace(target: URL, here: URL): Launch | 'navigate' | null {
  const index = (u: URL) => /^\/mail\/u\/(\d{1,2})\//.exec(u.pathname)?.[1] ?? '0';
  const asked = readLaunch(target);
  if (asked) return asked;
  if (target.origin !== here.origin || !target.pathname.startsWith('/mail/')) return null;
  if (index(target) !== index(here)) return 'navigate';
  const hash = target.hash && target.hash !== '#' ? target.hash : '';
  return hash && /^#[\w/%+.-]+$/.test(hash) ? { kind: 'route', hash } : null;
}

/** The text a share puts in the message: what was shared, then its link unless the text has it. */
export function sharedText(share: { text: string; url: string }): string {
  const parts = [share.text];
  if (share.url && !share.text.includes(share.url)) parts.push(share.url);
  return parts.filter(Boolean).join('\n\n');
}

/** The badge the app icon shows for a count, as the person chose. */
export function badgeFor(unread: number, mode: 'count' | 'dot' | 'off'): BadgeValue {
  if (mode === 'off' || unread <= 0) return null;
  return mode === 'dot' ? 'dot' : unread;
}
