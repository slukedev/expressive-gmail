/** A real subset of Gmail search, with Gmail's precedence: OR binds tighter than the implicit AND. */

export type QueryNode =
  | { type: 'and'; children: QueryNode[] }
  | { type: 'or'; children: QueryNode[] }
  | { type: 'not'; child: QueryNode }
  | { type: 'term'; op: string | null; value: string; phrase: boolean };

type Token =
  | { k: '(' | ')' | '{' | '}' | 'OR' | 'NOT' }
  | { k: 'term'; op: string | null; value: string; phrase: boolean }
  | { k: 'group'; op: string; inner: string };

const OP_RE = /^([a-zA-Z_]+):/;

function readQuoted(q: string, i: number): [string, number] {
  // q[i] === '"'
  let j = i + 1;
  while (j < q.length && q[j] !== '"') j++;
  return [q.slice(i + 1, j), Math.min(j + 1, q.length)];
}

function readBare(q: string, i: number): [string, number] {
  let j = i;
  while (j < q.length && !/\s/.test(q[j]!) && q[j] !== ')' && q[j] !== '(' && q[j] !== '}' && q[j] !== '{') j++;
  return [q.slice(i, j), j];
}

function readBalanced(q: string, i: number): [string, number] {
  // q[i] === '('
  let depth = 0;
  let j = i;
  for (; j < q.length; j++) {
    if (q[j] === '"') {
      j = readQuoted(q, j)[1] - 1;
      continue;
    }
    if (q[j] === '(') depth++;
    else if (q[j] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  return [q.slice(i + 1, j), Math.min(j + 1, q.length)];
}

function tokenize(q: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === '{' || c === '}') {
      out.push({ k: c });
      i++;
      continue;
    }
    if (c === '-' && i + 1 < q.length && !/\s/.test(q[i + 1]!)) {
      out.push({ k: 'NOT' });
      i++;
      continue;
    }
    if (c === '+' && i + 1 < q.length && !/\s/.test(q[i + 1]!)) {
      i++; // "+word" is an exact word in Gmail; every word is exact here.
      continue;
    }
    if (c === '"') {
      const [v, j] = readQuoted(q, i);
      if (v.trim()) out.push({ k: 'term', op: null, value: v, phrase: true });
      i = j;
      continue;
    }
    const rest = q.slice(i);
    const m = OP_RE.exec(rest);
    if (m) {
      const op = m[1]!.toLowerCase();
      const at = i + m[0].length;
      const next = q[at];
      if (next === '"') {
        const [v, j] = readQuoted(q, at);
        out.push({ k: 'term', op, value: v, phrase: true });
        i = j;
        continue;
      }
      if (next === '(') {
        const [inner, j] = readBalanced(q, at);
        out.push({ k: 'group', op, inner });
        i = j;
        continue;
      }
      if (next !== undefined && !/\s/.test(next)) {
        const [v, j] = readBare(q, at);
        out.push({ k: 'term', op, value: v, phrase: false });
        i = j;
        continue;
      }
    }
    const [word, j] = readBare(q, i);
    if (word === 'OR' || word === '|') out.push({ k: 'OR' });
    else if (word === 'AND') {
      // Implicit.
    } else if (word) out.push({ k: 'term', op: null, value: word, phrase: false });
    i = j === i ? i + 1 : j;
  }
  return out;
}

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Token[],
    private readonly defaultOp: string | null,
  ) {}

  private peek(): Token | undefined {
    return this.toks[this.i];
  }

  parseAll(): QueryNode | null {
    const parts: QueryNode[] = [];
    // Stray closers: skip and keep going so a typo never kills the search.
    for (;;) {
      const n = this.parseAnd();
      if (n) parts.push(n);
      if (this.i >= this.toks.length) break;
      this.i++;
    }
    if (parts.length === 0) return null;
    return parts.length === 1 ? parts[0]! : { type: 'and', children: parts };
  }

  private parseAnd(): QueryNode | null {
    const kids: QueryNode[] = [];
    for (;;) {
      const t = this.peek();
      if (!t || t.k === ')' || t.k === '}') break;
      if (t.k === 'OR') {
        this.i++; // dangling OR
        continue;
      }
      const n = this.parseOr();
      if (n) kids.push(n);
    }
    if (kids.length === 0) return null;
    return kids.length === 1 ? kids[0]! : { type: 'and', children: kids };
  }

  private parseOr(): QueryNode | null {
    const first = this.parseUnary();
    const kids: QueryNode[] = first ? [first] : [];
    while (this.peek()?.k === 'OR') {
      this.i++;
      const n = this.parseUnary();
      if (n) kids.push(n);
    }
    if (kids.length === 0) return null;
    return kids.length === 1 ? kids[0]! : { type: 'or', children: kids };
  }

  private parseUnary(): QueryNode | null {
    const t = this.peek();
    if (!t) return null;
    if (t.k === 'NOT') {
      this.i++;
      const c = this.parseUnary();
      return c ? { type: 'not', child: c } : null;
    }
    if (t.k === '(') {
      this.i++;
      const inner = this.parseAnd();
      if (this.peek()?.k === ')') this.i++;
      return inner;
    }
    if (t.k === '{') {
      this.i++;
      const kids: QueryNode[] = [];
      while (this.peek() && this.peek()!.k !== '}') {
        if (this.peek()!.k === 'OR') {
          this.i++;
          continue;
        }
        const n = this.parseUnary();
        if (n) kids.push(n);
        else if (this.peek() && this.peek()!.k === ')') this.i++;
      }
      if (this.peek()?.k === '}') this.i++;
      if (kids.length === 0) return null;
      return kids.length === 1 ? kids[0]! : { type: 'or', children: kids };
    }
    if (t.k === 'group') {
      this.i++;
      return new Parser(tokenize(t.inner), t.op).parseAll();
    }
    if (t.k === 'term') {
      this.i++;
      const op = t.op ?? this.defaultOp;
      return { type: 'term', op, value: t.value, phrase: t.phrase };
    }
    // Let the caller deal with it.
    return null;
  }
}

export function parseQuery(q: string): QueryNode | null {
  return new Parser(tokenize(q), null).parseAll();
}

export interface IndexedMessage {
  /** Folded lowercase "name email". */
  from: string;
  fromEmail: string;
  to: string[];
  toEmails: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Everything searchable as free text, folded. */
  text: string;
  filenames: string[];
  hasAttachment: boolean;
  size: number;
  date: number;
  listId: string;
  rfcId: string;
}

export interface IndexedThread {
  labels: Set<string>;
  /** Labels a message must have for the thread to count as fully in trash/spam. */
  allTrash: boolean;
  allSpam: boolean;
  anyTrash: boolean;
  anySpam: boolean;
  muted: boolean;
  messages: IndexedMessage[];
}

export interface SearchEnv {
  now: number;
  selfEmail: string;
  /** Undefined when unknown. */
  resolveLabel(name: string): string | undefined;
  userLabelIds: Set<string>;
}

export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC');
}

const LATIN_START = /^[a-z0-9]/;
const WORDCHAR = /[\p{L}\p{N}]/u;

/** At a word boundary (for Latin words). */
function containsWord(hay: string, needle: string): boolean {
  if (!needle) return true;
  if (!LATIN_START.test(needle)) return hay.includes(needle);
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    if (at === 0 || !WORDCHAR.test(hay[at - 1]!)) return true;
    from = at + 1;
  }
}

function matchText(hay: string, value: string, phrase: boolean): boolean {
  const v = fold(value).trim();
  if (!v) return true;
  if (phrase) return containsWord(hay, v.replace(/\s+/g, ' '));
  return containsWord(hay, v);
}

const SIZE_RE = /^(\d+(?:\.\d+)?)([kmg]?)b?$/i;

function parseSize(v: string): number | null {
  const m = SIZE_RE.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!.toLowerCase();
  const mult = unit === 'k' ? 1024 : unit === 'm' ? 1024 ** 2 : unit === 'g' ? 1024 ** 3 : 1;
  return Math.round(n * mult);
}

/** Local midnight of YYYY/MM/DD, YYYY-MM-DD, MM/DD/YYYY, or epoch seconds. */
function parseDate(v: string): number | null {
  const s = v.trim();
  if (/^\d{9,}$/.test(s)) return Number(s) * 1000;
  let m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])).getTime();
  return null;
}

/** Calendar months and years, like Gmail. */
function parseRelative(v: string, now: number): number | null {
  const m = /^(\d+)([dmyh])$/i.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const d = new Date(now);
  switch (m[2]!.toLowerCase()) {
    case 'h':
      return now - n * 3_600_000;
    case 'd':
      d.setDate(d.getDate() - n);
      break;
    case 'm':
      d.setMonth(d.getMonth() - n);
      break;
    case 'y':
      d.setFullYear(d.getFullYear() - n);
      break;
  }
  return d.getTime();
}

const CATEGORY: Record<string, string> = {
  primary: 'CATEGORY_PERSONAL',
  personal: 'CATEGORY_PERSONAL',
  social: 'CATEGORY_SOCIAL',
  promotions: 'CATEGORY_PROMOTIONS',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS',
};

const IN_LABEL: Record<string, string> = {
  inbox: 'INBOX',
  sent: 'SENT',
  draft: 'DRAFT',
  drafts: 'DRAFT',
  spam: 'SPAM',
  trash: 'TRASH',
  bin: 'TRASH',
  snoozed: 'SNOOZED',
  scheduled: 'SCHEDULED',
  starred: 'STARRED',
  important: 'IMPORTANT',
  unread: 'UNREAD',
  chats: 'CHAT',
};

type Pred = (t: IndexedThread, m: IndexedMessage) => boolean;

const NEVER: Pred = () => false;
const ALWAYS: Pred = () => true;

function textPred(value: string, phrase: boolean): Pred {
  return (_t, m) => matchText(m.text, value, phrase);
}

function addressPred(field: 'from' | 'to' | 'cc' | 'bcc', value: string, phrase: boolean, env: SearchEnv): Pred {
  const v = fold(value).trim();
  if (v === 'me') {
    const self = fold(env.selfEmail);
    if (field === 'from') return (_t, m) => m.fromEmail === self;
    return (_t, m) => {
      const list = field === 'to' ? [...m.to, ...m.cc, ...m.bcc] : field === 'cc' ? m.cc : m.bcc;
      return list.some((a) => a.endsWith(' ' + self) || a === self);
    };
  }
  return (_t, m) => {
    const list = field === 'from' ? [m.from] : field === 'to' ? [...m.to, ...m.cc, ...m.bcc] : field === 'cc' ? m.cc : m.bcc;
    return list.some((a) => matchText(a, v, phrase));
  };
}

function labelPred(id: string): Pred {
  return (t) => t.labels.has(id);
}

function compileTerm(n: Extract<QueryNode, { type: 'term' }>, env: SearchEnv): Pred {
  const { op, value, phrase } = n;
  if (!op) return textPred(value, phrase);
  const v = value.trim().toLowerCase();
  switch (op) {
    case 'in':
    case 'is': {
      if (v === 'anywhere') return ALWAYS;
      if (v === 'all' || v === 'allmail') return (t) => !t.allSpam && !t.allTrash;
      if (v === 'read') return (t) => !t.labels.has('UNREAD');
      if (v === 'muted') return (t) => t.muted;
      if (v === 'trash' || v === 'bin') return (t) => t.anyTrash;
      if (v === 'spam') return (t) => t.anySpam;
      const sys = IN_LABEL[v];
      if (sys) return labelPred(sys);
      if (op === 'in') {
        const id = env.resolveLabel(value);
        return id ? labelPred(id) : NEVER;
      }
      return NEVER;
    }
    case 'label': {
      const id = env.resolveLabel(value);
      if (!id) return NEVER;
      if (id === 'TRASH') return (t) => t.anyTrash;
      if (id === 'SPAM') return (t) => t.anySpam;
      return labelPred(id);
    }
    case 'category': {
      const id = CATEGORY[v];
      if (!id) return NEVER;
      if (id === 'CATEGORY_PERSONAL') {
        return (t) =>
          t.labels.has(id) ||
          ![...t.labels].some((l) => l.startsWith('CATEGORY_'));
      }
      return labelPred(id);
    }
    case 'from':
    case 'to':
    case 'cc':
    case 'bcc':
      return addressPred(op, value, phrase, env);
    case 'subject':
      return (_t, m) => matchText(m.subject, value, phrase);
    case 'has': {
      if (v === 'attachment' || v === 'attachments') return (_t, m) => m.hasAttachment;
      if (v === 'userlabels') return (t) => [...t.labels].some((l) => env.userLabelIds.has(l));
      if (v === 'nouserlabels') return (t) => ![...t.labels].some((l) => env.userLabelIds.has(l));
      if (v === 'star' || v.endsWith('-star')) return labelPred('STARRED');
      return NEVER;
    }
    case 'filename': {
      const f = fold(value).replace(/^\*+/, '').trim();
      if (!f) return NEVER;
      return (_t, m) => m.filenames.some((name) => containsWord(name, f) || name.endsWith(f));
    }
    case 'larger':
    case 'size':
    case 'smaller': {
      const bytes = parseSize(value);
      if (bytes == null) return textPred(`${op}:${value}`, false);
      return op === 'smaller' ? (_t, m) => m.size < bytes : (_t, m) => m.size > bytes;
    }
    case 'after':
    case 'before':
    case 'newer':
    case 'older': {
      const at = parseDate(value);
      if (at == null) return textPred(`${op}:${value}`, false);
      return op === 'after' || op === 'newer' ? (_t, m) => m.date >= at : (_t, m) => m.date < at;
    }
    case 'older_than':
    case 'newer_than': {
      const at = parseRelative(value, env.now);
      if (at == null) return textPred(`${op}:${value}`, false);
      return op === 'older_than' ? (_t, m) => m.date < at : (_t, m) => m.date > at;
    }
    case 'list': {
      const f = fold(value);
      return (_t, m) => m.listId.includes(f);
    }
    case 'rfc822msgid': {
      const f = fold(value).replace(/^<|>$/g, '');
      return (_t, m) => m.rfcId === f;
    }
    default:
      // Unknown operators are plain words in Gmail.
      return textPred(`${op}:${value}`, phrase);
  }
}

function compile(n: QueryNode, env: SearchEnv): Pred {
  switch (n.type) {
    case 'term':
      return compileTerm(n, env);
    case 'not': {
      const c = compile(n.child, env);
      return (t, m) => !c(t, m);
    }
    case 'and': {
      const cs = n.children.map((c) => compile(c, env));
      return (t, m) => cs.every((c) => c(t, m));
    }
    case 'or': {
      const cs = n.children.map((c) => compile(c, env));
      return (t, m) => cs.some((c) => c(t, m));
    }
  }
}

/** So Gmail's default exclusion of spam and trash is lifted. */
function scopeMentions(n: QueryNode | null, env: SearchEnv): { spam: boolean; trash: boolean } {
  const acc = { spam: false, trash: false };
  const walk = (x: QueryNode) => {
    if (x.type === 'term') {
      const v = x.value.trim().toLowerCase();
      if (x.op === 'in' || x.op === 'is' || x.op === 'label') {
        const resolved = x.op === 'label' ? env.resolveLabel(x.value) : undefined;
        if (v === 'anywhere') {
          acc.spam = true;
          acc.trash = true;
        }
        if (v === 'spam' || resolved === 'SPAM') acc.spam = true;
        if (v === 'trash' || v === 'bin' || resolved === 'TRASH') acc.trash = true;
      }
    } else if (x.type === 'not') walk(x.child);
    else x.children.forEach(walk);
  };
  if (n) walk(n);
  return acc;
}

export function compileQuery(q: string, env: SearchEnv): (t: IndexedThread) => boolean {
  const ast = parseQuery(q);
  const scope = scopeMentions(ast, env);
  const pred = ast ? compile(ast, env) : ALWAYS;
  return (t) => {
    if (!scope.trash && t.allTrash) return false;
    if (!scope.spam && t.allSpam) return false;
    return t.messages.some((m) => pred(t, m));
  };
}

/** Case-insensitive, with spaces, "/" and "-" interchangeable. */
export function normalizeLabelName(name: string): string {
  return fold(name).trim().replace(/[\s/\-_]+/g, '-');
}
