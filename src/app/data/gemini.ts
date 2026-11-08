/** The account's own Gemini, reached through the same source as its mail. The UI never talks to Gemini any other way, and asks `geminiStatus` before it shows anything. */

/** As Gmail's Refine menu offers them. */
export type RefineMode = 'polish' | 'formalize' | 'elaborate' | 'shorten' | 'rephrase';

export interface GeminiTurn {
  role: 'user' | 'model';
  text: string;
}

/** `threadId` is a list id, so it opens like any row. */
export interface GeminiSource {
  threadId: string;
  subject: string;
  from?: string;
  /** Epoch ms of the newest message it used. */
  date?: number;
}

/** By character offsets into the plain text it was given. */
export interface ProofreadFix {
  start: number;
  end: number;
  replacement: string;
  /** Short reason ("Spelling", "Grammar", "Clarity"). */
  kind: string;
}

export type GeminiRequest =
  /** Side panel. `threadId` grounds it in one conversation; without it, the whole mailbox. */
  | { kind: 'chat'; turns: GeminiTurn[]; threadId?: string }
  | { kind: 'summarize'; threadId: string }
  /** Help me write: a new message, or a reply when `threadId` is set. */
  | { kind: 'write'; prompt: string; threadId?: string; subject?: string; to?: string[] }
  | { kind: 'refine'; text: string; mode: RefineMode; threadId?: string }
  /** Suggested replies written for this conversation. */
  | { kind: 'replies'; threadId: string }
  | { kind: 'proofread'; text: string }
  /** For searches that read as questions. */
  | { kind: 'search'; query: string }
  /** AI Inbox: what needs doing and what to catch up on, across recent mail. */
  | { kind: 'briefing' }
  /** Help me schedule: times that suit you, written into the message. */
  | { kind: 'schedule'; threadId?: string; durationMinutes?: number };

/** A small Markdown subset: paragraphs, `-` or `1.` lists, `**bold**`, and `[n]` markers into `sources` (1-based). */
export interface GeminiAnswer {
  text: string;
  sources: GeminiSource[];
}

export type GeminiResult =
  | ({ kind: 'answer' } & GeminiAnswer)
  /** Help me write and Refine. `subject` only for a new message without one. */
  | { kind: 'draft'; text: string; subject?: string }
  | { kind: 'replies'; replies: { label: string; text: string }[] }
  | { kind: 'proofread'; fixes: ProofreadFix[] }
  | { kind: 'briefing'; todos: BriefingTodo[]; topics: BriefingTopic[] };

export interface BriefingTodo {
  text: string;
  threadId: string;
  /** When the mail gives a deadline. */
  due?: number;
}

export interface BriefingTopic {
  title: string;
  summary: string;
  threadIds: string[];
  /** When the source knows them. */
  sources?: GeminiSource[];
}

/** So the app can say what would fix it. */
type GeminiBlock =
  /** Not in this account's plan (or a Workspace admin turned it off). */
  | 'plan'
  /** Gmail's "Smart features" setting is off; Gemini in Gmail needs it. */
  | 'smart-features'
  /** The Gmail API source, or another account in session mode. */
  | 'connection'
  /** Signed out, another language, or Gmail changed. */
  | 'page';

/** They depend on the account's plan, language and region. */
export type GeminiFeature = 'chat' | 'summary' | 'write' | 'refine' | 'replies' | 'proofread' | 'search' | 'inbox' | 'schedule';

export const ALL_GEMINI_FEATURES: readonly GeminiFeature[] = ['chat', 'summary', 'write', 'refine', 'replies', 'proofread', 'search', 'inbox', 'schedule'];

export type GeminiStatus = { ready: true; features: GeminiFeature[] } | { ready: false; block: GeminiBlock; detail?: string };

/** `text` is everything so far, not a delta. */
export interface GeminiProgress {
  type: 'gemini';
  requestId: string;
  text: string;
}

/** The answer card only shows for questions. */
export function readsAsQuestion(query: string): boolean {
  const q = query.trim();
  // Operators mean a search.
  if (!q || /\b[a-z]+:\S/i.test(q) || q.split(/\s+/).length < 3) return false;
  return /\?$/.test(q) || /^(what|when|where|who|whom|whose|which|why|how|did|does|do|is|are|was|were|has|have|can|could|should|will|would|summari[sz]e|list|find me|show me|tell me|catch me up)\b/i.test(q);
}

/** Gmail shows Gemini for this account: the only time any Gemini UI may show. */
export function geminiAvailable(status: GeminiStatus | undefined): status is Extract<GeminiStatus, { ready: true }> {
  return !!status?.ready;
}

/**
 * The one Gemini switch. `choice` is null until the person picks: then it follows what Gmail shows, so an account that gains or
 * loses Gemini in Gmail follows along. A choice is kept, but never turns on what Gmail doesn't offer.
 */
export function geminiOn(choice: boolean | null, status: GeminiStatus | undefined): boolean {
  return geminiAvailable(status) && choice !== false;
}

/** How soon to look again. A "no" can be Gmail's page still loading, so it's asked about often; a "yes" can go when a run finds a feature gone. */
export function geminiRecheckMs(status: GeminiStatus | undefined): number | false {
  if (status && !status.ready && status.block === 'connection') return false;
  return status?.ready ? 3 * 60_000 : 30_000;
}
