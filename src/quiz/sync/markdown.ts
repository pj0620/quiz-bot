/**
 * The grammar shared by the quiz-file writer and parser.
 *
 * A quiz file is a note first. Someone opens it in Obsidian or on GitHub and
 * reads a quiz sheet: a numbered heading per question, the choices, the
 * explanation, where it came from, how they are doing on it. Nothing in it is
 * JSON. The only thing hidden from the reader is one HTML comment per question
 * holding ids that mean nothing to a person.
 *
 * That puts the whole burden on the grammar: every line is classified by how it
 * STARTS, and a value that happens to begin with a marker is escaped with one
 * backslash, which markdown renders invisibly for punctuation. The writer and
 * the parser both go through `classify`, so an escape the writer thinks it
 * needs is exactly the one the parser removes — the two cannot drift apart.
 *
 * Deliberately dependency-free so the format round-trips under jest with no
 * mocks at all.
 */

// ---------------------------------------------------------------------------
// Line kinds
// ---------------------------------------------------------------------------

export type LineKind =
  | 'heading'
  | 'comment'
  | 'choices'
  | 'answer'
  | 'model-answer'
  | 'also-accepted'
  | 'rubric'
  | 'name-of'
  | 'fill-in'
  | 'blanks'
  | 'in-order'
  | 'why'
  | 'callout'
  | 'quote'
  | 'detail'
  | 'correct-choice'
  | 'checkbox'
  | 'bullet'
  | 'numbered'
  | 'sub-bullet'
  | 'table-row'
  | 'indented'
  | 'blank'
  | 'text';

/** `## 3. Which state…` — the only thing that splits a file into questions. */
export const HEADING = /^## (\d+)\. (.*)$/;
export const COMMENT_PREFIX = '<!-- quizbot ';
export const COMMENT = /^<!-- quizbot (\{.*\}) -->$/;

export const LABEL = {
  choices: '**Choices:**',
  answer: '**Answer:**',
  modelAnswer: '**Model answer:**',
  alsoAccepted: '**Also accepted:**',
  rubric: '**A good answer covers:**',
  fillIn: '**Fill in:**',
  blanks: '**Blanks:**',
  inOrder: '**In order:**',
  why: '**Why:**',
  leech: '- Leech',
  correct: '✓',
  alsoAcceptedBlank: 'also accepted: ',
  caseSensitive: 'case sensitive',
} as const;

export const NAME_OF = /^\*\*Name (\d+) of these:\*\*$/;
export const DETAIL_KEYS = [
  'Format',
  'Topics',
  'Difficulty',
  'Created',
  'Material',
  'Edited',
  'Plan',
  'Progress',
  'Schedule',
] as const;
export type DetailKey = (typeof DETAIL_KEYS)[number];
export const DETAIL = new RegExp(`^- (${DETAIL_KEYS.join('|')}):(?: (.*))?$`);
export const CALLOUT = /^> \[!([a-z]+)\] (.*)$/;
export const CORRECT_PREFIX = `- ${LABEL.correct} `;
export const SUB_BULLET_PREFIX = '   - ';
export const INDENT = '  ';

const STARTERS: ReadonlySet<LineKind> = new Set<LineKind>([
  'heading',
  'comment',
  'choices',
  'answer',
  'model-answer',
  'also-accepted',
  'rubric',
  'name-of',
  'fill-in',
  'blanks',
  'in-order',
  'why',
  'callout',
  'quote',
  'detail',
]);

/** Whether a line of this kind begins a new segment of a question block. */
export function isStarter(kind: LineKind): boolean {
  return STARTERS.has(kind);
}

export function classify(line: string): LineKind {
  if (line === '') return 'blank';
  if (HEADING.test(line)) return 'heading';
  if (line.startsWith(COMMENT_PREFIX)) return 'comment';
  if (line === LABEL.choices) return 'choices';
  if (line.startsWith(`${LABEL.answer} `)) return 'answer';
  if (line === LABEL.modelAnswer || line.startsWith(`${LABEL.modelAnswer} `)) return 'model-answer';
  if (line === LABEL.alsoAccepted) return 'also-accepted';
  if (line === LABEL.rubric) return 'rubric';
  if (NAME_OF.test(line)) return 'name-of';
  if (line === LABEL.fillIn || line.startsWith(`${LABEL.fillIn} `)) return 'fill-in';
  if (line === LABEL.blanks) return 'blanks';
  if (line === LABEL.inOrder) return 'in-order';
  if (line === LABEL.why || line.startsWith(`${LABEL.why} `)) return 'why';
  if (CALLOUT.test(line)) return 'callout';
  if (line === '>' || line.startsWith('> ')) return 'quote';
  if (line === LABEL.leech || DETAIL.test(line)) return 'detail';
  if (line.startsWith(CORRECT_PREFIX)) return 'correct-choice';
  // An Obsidian checkbox: interactive in reading view, so never written as content.
  if (/^- \[[ xX]\] /.test(line)) return 'checkbox';
  if (line.startsWith('- ')) return 'bullet';
  if (/^\d+\. /.test(line)) return 'numbered';
  if (line.startsWith(SUB_BULLET_PREFIX)) return 'sub-bullet';
  if (line.startsWith('|')) return 'table-row';
  if (line.startsWith(INDENT)) return 'indented';
  return 'text';
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * One line of a value under `prefix`, escaped when the grammar would otherwise
 * read it as structure.
 *
 * `allowed` says which kinds the parser will treat as this value's own line.
 * Anything else — or a value that itself starts with a backslash, which must
 * survive the parser removing one — gets a backslash after the prefix. For
 * punctuation that is a markdown escape and renders as the bare character; for
 * a letter (an item reading "Format: x") the backslash shows, which is rare
 * and cosmetic.
 */
export function valueLine(prefix: string, text: string, allowed: (kind: LineKind) => boolean): string {
  const line = prefix + text;
  const escape = text.startsWith('\\') || !allowed(classify(line));
  return escape ? `${prefix}\\${text}` : line;
}

/** The parser's half of `valueLine`: strips exactly one leading backslash. */
export function unescapeValue(text: string): string {
  return text.startsWith('\\') ? text.slice(1) : text;
}

/** Plain paragraphs: anything that is not a segment starter is the value's own. */
export const asPlain = (kind: LineKind): boolean => !isStarter(kind);
export const asBullet = (kind: LineKind): boolean => kind === 'bullet';
export const asCorrectChoice = (kind: LineKind): boolean => kind === 'correct-choice';
export const asIndented = (kind: LineKind): boolean => kind === 'indented';
export const asQuote = (kind: LineKind): boolean => kind === 'quote';
export const asNumbered = (kind: LineKind): boolean => kind === 'numbered';
export const asSubBullet = (kind: LineKind): boolean => kind === 'sub-bullet';

// ---------------------------------------------------------------------------
// Multi-line values
// ---------------------------------------------------------------------------

/**
 * A value's lines under a prefix: the first on the marker line (caller supplies
 * that prefix), the rest as indented or plain continuation. Blank lines inside
 * the value are kept as empty lines.
 */
export function valueLines(
  text: string,
  firstPrefix: string,
  firstAllowed: (kind: LineKind) => boolean,
  restPrefix: string,
  restAllowed: (kind: LineKind) => boolean,
): string[] {
  const lines = text.split('\n');
  return lines.map((line, index) => {
    if (index === 0) return valueLine(firstPrefix, line, firstAllowed);
    if (line === '') return '';
    return valueLine(restPrefix, line, restAllowed);
  });
}

/**
 * Collects continuation lines back into a value. `strip` removes the prefix of
 * a continuation line; blank lines inside the run are kept, and blank lines at
 * either end are dropped along with surrounding whitespace.
 */
export function joinValue(first: string, rest: readonly string[], strip: (line: string) => string): string {
  const lines = [first, ...rest.map((line) => (line === '' ? '' : unescapeValue(strip(line))))];
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// Hidden comment
// ---------------------------------------------------------------------------

/**
 * `<!-- quizbot {...} -->`, one line. `--` cannot appear inside an HTML comment,
 * so any run of two hyphens in the payload is written as a JSON escape — valid
 * JSON, invisible to the reader, and impossible to confuse with the closer.
 */
export function encodeComment(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload).replace(/--/g, '-\\u002d');
  if (json.includes('\n')) throw new Error('quiz comment payload must be one line');
  return `${COMMENT_PREFIX}${json} -->`;
}

export function decodeComment(line: string): Record<string, unknown> | undefined {
  const match = COMMENT.exec(line);
  if (!match) return undefined;
  try {
    const value: unknown = JSON.parse(match[1]);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** A cell: pipes and backslashes escaped, newlines as `<br>` so the row stays one line. */
export function escapeCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

/** Splits a `| a | b |` row into trimmed, unescaped cells. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let index = 0;
  // Drop the leading pipe; a trailing one leaves an empty final cell, removed below.
  if (line.startsWith('|')) index = 1;
  while (index < line.length) {
    const char = line[index];
    if (char === '\\' && index + 1 < line.length) {
      const next = line[index + 1];
      if (next === '|' || next === '\\') {
        current += next;
        index += 2;
        continue;
      }
    }
    if (char === '|') {
      cells.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += char;
    index += 1;
  }
  cells.push(current);
  if (line.endsWith('|') && !line.endsWith('\\|') && cells[cells.length - 1] === '') cells.pop();
  return cells.map((cell) => cell.replace(/<br>/g, '\n').trim());
}

// ---------------------------------------------------------------------------
// Fill-in templates
// ---------------------------------------------------------------------------

/** What a blank looks like in the note. Six, so a stray `__` in prose cannot match. */
export const BLANK_RUN = '______';

/** Template prose: literal underscores and backslashes escaped, so only ours read as blanks. */
export function escapeTemplateText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/_/g, '\\_');
}

export function unescapeTemplateText(text: string): string {
  return text.replace(/\\([\\_])/g, '$1');
}

// ---------------------------------------------------------------------------
// Dates and numbers
// ---------------------------------------------------------------------------

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** ISO 8601 with the device's offset, to the second: `2026-10-20T14:02:11-04:00`. */
export function formatIso(ms: number): string {
  const date = new Date(ms);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Any ISO 8601 timestamp, or undefined. */
export function parseIso(text: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text)) return undefined;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : undefined;
}

/** A local calendar day: `2026-10-29`. */
export function formatDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of a `YYYY-MM-DD`, which is what the scheduler stores for `dueAt`. */
export function parseDay(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return undefined;
  const ms = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/** UTC, colon-free, for a filename: `2026-10-23T21-30-00Z`. */
export function formatFileStamp(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `23 Oct 2026`, for a title. */
export function formatShortDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** `23 October 2026`, for prose. */
export function formatLongDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

/** Two decimals, which is exact for ease and close enough for a fuzzed interval. */
export function formatNumber(value: number): string {
  return value.toFixed(2);
}

export function parseNumber(text: string): number | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Whole seconds, the precision the file carries. */
export function toSeconds(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

export function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}
