import { getVisibleThreadIds } from '../../data/actions';
import { backend, findThread, keys, queryClient } from '../../data/client';
import { myAddresses } from '../../data/hooks';
import type { Account, BackendCapabilities, Label, ThreadSummary } from '../../data/types';
import type { Route } from '../../router/routes';
import { getRoute } from '../../router/useRoute';
import { useUi, type ComposeDraft } from '../../state/ui';

/** The selection, else the open conversation, else the cursor's row. */
export interface Target {
  ids: string[];
  /** The ones the cache knows (normally all). */
  threads: ThreadSummary[];
  source: 'selection' | 'open' | 'cursor';
  /** "Onboarding v4: final review..." or 3 conversations. */
  name: string;
  heading: string;
}

export interface Context {
  now: Date;
  route: Route;
  target: Target | null;
  caps: BackendCapabilities;
  labels: Label[];
  me: string[];
  /** The compose window a template would go into. */
  composing?: ComposeDraft;
  listIds: string[];
}

const QUOTE_MAX = 30;

/** Short enough that the verb in front stays readable. */
function quoteSubject(subject: string): string {
  const s = subject.trim() || '(no subject)';
  if (s.length <= QUOTE_MAX) return `“${s}”`;
  const cut = s.slice(0, QUOTE_MAX);
  const space = cut.lastIndexOf(' ');
  return `“${(space > QUOTE_MAX * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,:;.-]+$/, '')}…”`;
}

function targetFor(ids: string[], source: Target['source']): Target | null {
  if (!ids.length) return null;
  const threads = ids.map((id) => findThread(id)).filter((t): t is ThreadSummary => !!t);
  const one = ids.length === 1;
  return {
    ids,
    threads,
    source,
    name: one ? quoteSubject(threads[0]?.subject ?? '') : `${ids.length} conversations`,
    heading: one ? (source === 'open' ? 'This conversation' : (threads[0]?.subject.trim() || 'This conversation')) : `${ids.length} selected conversations`,
  };
}

/** Read when it opens; reopening picks up later changes. */
export function readContext(now = new Date()): Context {
  const route = getRoute();
  const ui = useUi.getState();
  const listIds = getVisibleThreadIds();
  let target: Target | null = null;
  if (ui.selected.size) target = targetFor([...ui.selected], 'selection');
  else if (route.threadId) target = targetFor([route.threadId], 'open');
  else if (ui.cursor >= 0 && listIds[ui.cursor]) target = targetFor([listIds[ui.cursor]!], 'cursor');
  const composing = [...ui.composes].reverse().find((c) => c.window !== 'minimized');
  return {
    now,
    route,
    target,
    caps: backend().capabilities,
    labels: queryClient.getQueryData<Label[]>(keys.labels) ?? [],
    me: myAddresses(queryClient.getQueryData<Account>(keys.account)),
    composing,
    listIds,
  };
}
