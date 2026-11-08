import { isPhone } from './mobile';

// A delegated mailbox (/mail/u/N/d/<token>/ or the older /mail/b/<id>/u/N/) stays classic:
// the session backend would read the signed-in account instead.

const DELEGATED_PATH = /^\/mail\/(?:u\/\d{1,2}\/d\/[\w-]{8,}|b\/[\w.-]+\/u\/\d{1,2}|b\/[\w.-]{4,})(?=\/|$)/;

export function delegatedPath(pathname: string): string | undefined {
  return DELEGATED_PATH.exec(pathname)?.[0];
}

export function takesOver(url: URL, top: boolean): boolean {
  // Gmail's own popups and print views open in this origin too.
  if (!top || /[?&](view|ui)=(cm|pt|att|om)\b/.test(url.search)) return false;
  return !delegatedPath(url.pathname);
}

/** Gmail tabs that run the app; delegated mailboxes and Gmail's popups may hold unsent typing. */
export function runsApp(href: string | undefined): boolean {
  try {
    return takesOver(new URL(href ?? ''), true);
  } catch {
    return false;
  }
}

/**
 * Phones get desktop Gmail for delegated mailboxes as well: mobile Gmail's own page can't be told
 * apart in the request rule, and its redirects would land in the signed-in account's inbox.
 */
export function fitsDelegated(url: URL, top: boolean, ua: string): boolean {
  return top && !!delegatedPath(url.pathname) && isPhone(ua);
}
