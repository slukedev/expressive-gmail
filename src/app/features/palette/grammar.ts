/** "snooze fri 9am" is the snooze page with "fri 9am" typed into it. Longer phrases are tried first, so "move to" wins over "move". */

export type Verb =
  | 'snooze'
  | 'remind'
  | 'label'
  | 'unlabel'
  | 'move'
  | 'write'
  | 'person'
  | 'theme'
  | 'density'
  | 'go'
  | 'switch'
  | 'template'
  | 'search'
  | 'setting'
  | 'pause';

const PHRASES: [string, Verb][] = [
  ['snooze until', 'snooze'],
  ['snooze', 'snooze'],
  ['remind me if no reply', 'remind'],
  ['remind me', 'remind'],
  ['remind', 'remind'],
  ['follow up', 'remind'],
  ['nudge', 'remind'],
  ['label as', 'label'],
  ['label', 'label'],
  ['tag', 'label'],
  ['remove label', 'unlabel'],
  ['unlabel', 'unlabel'],
  ['move to', 'move'],
  ['move', 'move'],
  ['mv', 'move'],
  ['to:', 'write'],
  ['write to', 'write'],
  ['compose to', 'write'],
  ['email', 'write'],
  ['write', 'write'],
  ['message', 'write'],
  ['conversations with', 'person'],
  ['mail from', 'person'],
  ['person', 'person'],
  ['people', 'person'],
  ['contact', 'person'],
  ['theme', 'theme'],
  ['density', 'density'],
  ['go to', 'go'],
  ['go', 'go'],
  ['open', 'go'],
  ['switch to', 'switch'],
  ['switch', 'switch'],
  ['account', 'switch'],
  ['insert template', 'template'],
  ['template', 'template'],
  ['search for', 'search'],
  ['search', 'search'],
  ['find', 'search'],
  ['setting', 'setting'],
  ['settings', 'setting'],
  ['turn on', 'setting'],
  ['turn off', 'setting'],
  ['toggle', 'setting'],
  ['pause inbox', 'pause'],
  ['pause', 'pause'],
];

const SORTED = [...PHRASES].sort((a, b) => b[0].length - a[0].length);

export interface Parsed {
  verb: Verb;
  phrase: string;
  arg: string;
}

/** Followed by a space (or glued on, for "to:priya"). A verb alone ("snooze") stays a search, which finds the command itself. */
export function parseVerb(input: string): Parsed | null {
  const text = input.replace(/^\s+/, '');
  const lower = text.toLowerCase();
  for (const [phrase, verb] of SORTED) {
    if (phrase.endsWith(':')) {
      if (lower.startsWith(phrase)) return { verb, phrase, arg: text.slice(phrase.length).trim() };
      continue;
    }
    if (lower.startsWith(`${phrase} `)) return { verb, phrase, arg: text.slice(phrase.length).trim() };
  }
  return null;
}

/** They turn the palette into mail search. */
const OPERATORS =
  /(^|\s)-?(from|to|cc|bcc|subject|label|has|is|in|after|before|older|newer|older_than|newer_than|filename|larger|smaller|size|category|list|deliveredto|rfc822msgid|around|AROUND):\S/i;

export function looksLikeSearch(input: string): boolean {
  return OPERATORS.test(input) || /(^|\s)"[^"]+"/.test(input) || /\b(OR|AND)\b/.test(input);
}

/** For the chips over the search row. */
export function operatorChips(query: string): string[] {
  return (query.match(/-?\w+:"[^"]*"|-?\w+:\([^)]*\)|-?\w+:\S+/g) ?? []).filter((t) => OPERATORS.test(` ${t}`));
}
