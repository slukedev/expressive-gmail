import { useSyncExternalStore } from 'react';
import { NO_APP_HOST, type AppHostState, type BadgeValue, type Launch } from '../../shared/pwa';

/**
 * The installed app, as the page hosting this frame offers it (src/shared/pwa-host.ts):
 * install, the icon badge, email links, and launches from the app's shortcuts, shares and files.
 */

const GMAIL = 'https://mail.google.com';
// The preview's stand-in host (preview/frame.html) frames the app from its own origin.
const HOST = import.meta.env.DEV && typeof location !== 'undefined' && location.protocol.startsWith('http') ? location.origin : GMAIL;

export type AppLaunch = Launch & { files?: File[] };

let state: AppHostState = NO_APP_HOST;
const listeners = new Set<() => void>();
const launches: AppLaunch[] = [];
let launchHandler: ((launch: AppLaunch) => void) | undefined;
const waiting = new Map<string, (data: Record<string, unknown>) => void>();

function post(type: string, payload: Record<string, unknown> = {}) {
  if (typeof window === 'undefined' || window.parent === window) return false;
  window.parent.postMessage({ source: 'better-gmail/app', type, ...payload }, HOST);
  return true;
}

function isState(v: unknown): v is AppHostState {
  const s = v as AppHostState | null;
  return !!s && typeof s === 'object' && ['installable', 'standalone', 'badge', 'mailto'].every((k) => typeof (s as unknown as Record<string, unknown>)[k] === 'boolean');
}

function isLaunch(v: unknown): v is AppLaunch {
  const l = v as AppLaunch | null;
  if (!l || typeof l !== 'object') return false;
  switch (l.kind) {
    case 'compose':
      return true;
    case 'mailto':
      return typeof l.href === 'string' && /^mailto:/i.test(l.href);
    case 'share':
      return typeof l.title === 'string' && typeof l.text === 'string' && typeof l.url === 'string';
    case 'route':
      return typeof l.hash === 'string' && l.hash.startsWith('#');
    case 'files':
      return Array.isArray(l.files) && l.files.every((f) => f instanceof File);
  }
  return false;
}

if (typeof window !== 'undefined' && window.parent !== window) {
  window.addEventListener('message', (e) => {
    const d = e.data as { source?: string; type?: string; [k: string]: unknown };
    if (e.source !== window.parent || d?.source !== 'better-gmail/content' || typeof d.type !== 'string') return;
    if (d.type === 'app-state' && isState(d.state)) {
      state = d.state;
      listeners.forEach((fn) => fn());
    } else if (d.type === 'launch' && isLaunch(d.launch)) {
      if (launchHandler) launchHandler(d.launch);
      else launches.push(d.launch);
    } else {
      const done = waiting.get(d.type);
      if (done) {
        waiting.delete(d.type);
        done(d);
      }
    }
  });
  post('app-hello');
}

function ask(type: string, answer: string, timeout: number): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve) => {
    // A newer ask replaces an unanswered one.
    waiting.get(answer)?.({});
    const timer = setTimeout(() => {
      waiting.delete(answer);
      resolve(undefined);
    }, timeout);
    waiting.set(answer, (d) => {
      clearTimeout(timer);
      resolve(d);
    });
    if (!post(type)) {
      clearTimeout(timer);
      waiting.delete(answer);
      resolve(undefined);
    }
  });
}

export function useAppHost(): AppHostState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => NO_APP_HOST,
  );
}

export function getAppHost(): AppHostState {
  return state;
}

/** Whether any of it applies here; Settings shows the App section only then. */
export function appFeatures(s: AppHostState) {
  return s.installable || s.standalone || s.badge || s.mailto;
}

/** The browser's own install dialog. Waits as long as the person takes to answer it. */
export async function installApp(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const d = await ask('app-install', 'app-install-result', 10 * 60_000);
  const outcome = d?.outcome;
  return outcome === 'accepted' || outcome === 'dismissed' ? outcome : 'unavailable';
}

/** Asks the browser to send mailto links here. It confirms with the person itself, and never says what they chose. */
export async function openEmailLinksHere(): Promise<boolean> {
  const d = await ask('app-mailto', 'app-mailto-result', 5_000);
  return d?.ok === true;
}

let lastBadge: BadgeValue | undefined;
export function setAppBadge(value: BadgeValue) {
  if (value === lastBadge) return;
  lastBadge = value;
  post('app-badge', { value });
}

/** One handler at a time; launches that came before it are handed over in order. */
export function onAppLaunch(handler: (launch: AppLaunch) => void) {
  launchHandler = handler;
  for (const launch of launches.splice(0)) handler(launch);
  return () => {
    if (launchHandler === handler) launchHandler = undefined;
  };
}
