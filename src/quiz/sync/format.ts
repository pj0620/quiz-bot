import { startOfDay } from '../../lib/day';
import { noteFilename } from '../../notes/paths';
import { parseTemplate } from '../questionTypes/fillBlank';
import { getQuestionLogic, isValidQuestion } from '../questionTypes/registry';
import { MASTERY_LABELS, masteryOf } from '../srs/mastery';
import { isValidReviewState } from '../srs/schedule';
import {
  DIFFICULTY_ORDER,
  type Blank,
  type Difficulty,
  type FlagReason,
  type Outcome,
  type Provenance,
  type Question,
  type QuestionBase,
  type ReviewState,
} from '../types';
import { slugFromPath } from '../vocab/types';
import {
  asBullet,
  asCorrectChoice,
  asIndented,
  asNumbered,
  asPlain,
  asQuote,
  asSubBullet,
  BLANK_RUN,
  CALLOUT,
  classify,
  CORRECT_PREFIX,
  decodeComment,
  DETAIL,
  encodeComment,
  escapeCell,
  escapeTemplateText,
  formatDay,
  formatFileStamp,
  formatIso,
  formatLongDate,
  formatNumber,
  formatShortDate,
  HEADING,
  INDENT,
  isStarter,
  joinValue,
  LABEL,
  type LineKind,
  NAME_OF,
  parseDay,
  parseIso,
  parseNumber,
  roundTo2,
  splitRow,
  SUB_BULLET_PREFIX,
  toSeconds,
  unescapeTemplateText,
  unescapeValue,
  valueLine,
  valueLines,
} from './markdown';

/**
 * A quiz file: the question bank as a note someone can read.
 *
 * `renderQuizFile` writes one, `parseQuizFile` reads one back, and the two are
 * inverses up to `normalizeQuestion` — the losses are listed on that function,
 * and the round-trip test pins every one of them.
 *
 * The grammar itself lives in `markdown.ts`. This file knows what each segment
 * MEANS: which answer block belongs to which format, how provenance is written
 * for a note, a vocabulary word and an asked-for prompt, and how a review
 * state folds into two readable lines.
 */

export const QUIZ_FILE_TYPE = 'quizbot-questions';
export const QUIZ_FILE_PREFIX = 'quiz-questions-';

export type QuizFileEntry = { question: Question; review?: ReviewState };

export type QuizFileMeta = {
  /**
   * When this batch was first written; the title keeps it across rewrites.
   *
   * Deliberately the only timestamp in the file's own header. An "updated"
   * stamp would change on every render, so every file would look changed on
   * every sync and be rewritten for nothing. Git already records when a file
   * was last touched.
   */
  createdAt: number;
  /** A plan's title for the `Plan:` line, when the plan still exists. */
  planTitle?: (planId: string) => string | undefined;
};

export type RenderResult = {
  text: string;
  /** What was actually written, normalized and in file order. */
  entries: QuizFileEntry[];
  skipped: { id: string; reason: string }[];
};

export type ParseWarning = { heading?: string; id?: string; reason: string };

export type ParsedQuizFile = { entries: QuizFileEntry[]; warnings: ParseWarning[] };

export function quizFilePath(folder: string, now: number): string {
  return `${folder}/${QUIZ_FILE_PREFIX}${formatFileStamp(now)}.md`;
}

// ---------------------------------------------------------------------------
// Normalization — what the file can carry
// ---------------------------------------------------------------------------

const DIFFICULTIES = Object.keys(DIFFICULTY_ORDER) as Difficulty[];
const FLAG_REASONS: readonly FlagReason[] = ['wrong', 'unclear', 'duplicate', 'not-useful', 'other'];
const OUTCOMES: readonly Outcome[] = ['correct', 'partial', 'incorrect'];

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text ? text : undefined;
}

function cleanList(values: readonly string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  const out = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return out.length > 0 ? out : undefined;
}

/** Answer strings that the file can only hold on one line. */
function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').trim();
}

function normalizeProvenance(provenance: Provenance): Provenance {
  const quote = trimmed(provenance.quote);
  const excerpt = quote ? undefined : trimmed(provenance.excerpt);
  const path = trimmed(provenance.path);
  const revision = trimmed(provenance.revision);
  const noteTitle = trimmed(provenance.noteTitle);
  const section = trimmed(provenance.section);
  return {
    sourceId: provenance.sourceId,
    ...(path ? { path } : {}),
    ...(revision ? { revision } : {}),
    ...(noteTitle ? { noteTitle } : {}),
    ...(section ? { section } : {}),
    ...(excerpt ? { excerpt } : {}),
    ...(quote ? { quote } : {}),
  };
}

/**
 * The question as the file will give it back.
 *
 * Accepted losses, all of them deliberate:
 *  - strings trimmed, empty list entries dropped, `acceptable`/`rubric` `[]`
 *    becomes absent;
 *  - `excerpt` dropped when `quote` exists (the file shows one passage);
 *  - `contentAt` defaults to `addedAt` (every producer already sets it so);
 *  - timestamps to the second, `ease`/`intervalDays` to two decimals;
 *  - fill-blank blanks reordered to the order they appear in the template,
 *    `caseSensitive: false` becomes absent; one-line answer strings lose
 *    interior newlines;
 *  - a question that is invalid after this, or whose `sourceId` disagrees with
 *    its provenance, is not written at all — the load path would drop it too.
 *
 * Returns undefined for anything that cannot be written: that includes
 * `map-locate`, which never enters the bank (geography is derived per session).
 */
export function normalizeQuestion(question: Question): Question | undefined {
  if (question.sourceId !== question.provenance.sourceId) return undefined;
  if (!DIFFICULTIES.includes(question.difficulty)) return undefined;

  const note = trimmed(question.flagged?.note);
  const base: QuestionBase = {
    id: question.id.trim(),
    prompt: question.prompt.trim(),
    explanation: question.explanation.trim(),
    topics: cleanList(question.topics) ?? [],
    difficulty: question.difficulty,
    sourceId: question.sourceId,
    provenance: normalizeProvenance(question.provenance),
    addedAt: toSeconds(question.addedAt),
    contentAt: toSeconds(question.contentAt ?? question.addedAt),
    ...(question.updatedAt !== undefined ? { updatedAt: toSeconds(question.updatedAt) } : {}),
    ...(question.flagged
      ? {
          flagged: {
            reason: question.flagged.reason,
            at: toSeconds(question.flagged.at),
            ...(note ? { note } : {}),
          },
        }
      : {}),
    ...(question.figure ? { figure: question.figure } : {}),
    ...(question.planId ? { planId: question.planId } : {}),
  };

  let normalized: Question;
  switch (question.format) {
    case 'multiple-choice':
      normalized = {
        ...base,
        format: 'multiple-choice',
        choices: question.choices.map((choice) => ({ id: choice.id, text: choice.text.trim() })),
        correctChoiceId: question.correctChoiceId,
      };
      break;
    case 'true-false':
      normalized = { ...base, format: 'true-false', correct: question.correct };
      break;
    case 'short-answer': {
      const acceptable = cleanList(question.acceptable?.map(oneLine));
      const rubric = cleanList(question.rubric);
      normalized = {
        ...base,
        format: 'short-answer',
        modelAnswer: question.modelAnswer.trim(),
        ...(acceptable ? { acceptable } : {}),
        ...(rubric ? { rubric } : {}),
      };
      break;
    }
    case 'list-recall':
      normalized = {
        ...base,
        format: 'list-recall',
        required: question.required,
        items: cleanList(question.items) ?? [],
      };
      break;
    case 'fill-blank': {
      const template = question.template.trim();
      const order = parseTemplate(template)
        .filter((run) => run.kind === 'blank')
        .map((run) => (run as { blankId: string }).blankId);
      const byId = new Map(question.blanks.map((blank) => [blank.id, blank]));
      const ordered = order.map((id) => byId.get(id));
      // A placeholder with no definition is invalid either way; keep the
      // original list so `isValidQuestion` rejects it below.
      const blanks: Blank[] = ordered.every(Boolean)
        ? (ordered as Blank[]).map((blank) => ({
            id: blank.id,
            accepted: cleanList(blank.accepted.map(oneLine)) ?? [],
            ...(blank.caseSensitive ? { caseSensitive: true } : {}),
          }))
        : question.blanks;
      normalized = { ...base, format: 'fill-blank', template, blanks };
      break;
    }
    case 'timeline':
      normalized = {
        ...base,
        format: 'timeline',
        events: question.events.map((event) => ({
          id: event.id,
          label: event.label.trim(),
          date: oneLine(event.date),
        })),
      };
      break;
    case 'map-locate':
      return undefined;
  }

  return isValidQuestion(normalized) ? normalized : undefined;
}

export function normalizeReview(state: ReviewState): ReviewState {
  return {
    questionId: state.questionId,
    ease: roundTo2(state.ease),
    intervalDays: roundTo2(state.intervalDays),
    dueAt: startOfDay(state.dueAt),
    streak: state.streak,
    lapses: state.lapses,
    reps: state.reps,
    lastReviewedAt: toSeconds(state.lastReviewedAt),
    lastOutcome: state.lastOutcome,
    ...(state.leech ? { leech: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Sub-item ids
// ---------------------------------------------------------------------------

function letter(index: number): string {
  return index < 26 ? String.fromCharCode(97 + index) : `b${index}`;
}

function defaultIds(format: 'multiple-choice' | 'fill-blank' | 'timeline', count: number): string[] {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(format === 'multiple-choice' ? `c${index}` : format === 'timeline' ? `e${index}` : letter(index));
  }
  return ids;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const asFillIn = (kind: LineKind): boolean => kind === 'fill-in';
const asWhy = (kind: LineKind): boolean => kind === 'why';
const asModelAnswer = (kind: LineKind): boolean => kind === 'model-answer';

function bulletLines(text: string): string[] {
  return valueLines(text, '- ', asBullet, INDENT, asIndented);
}

function correctLines(text: string): string[] {
  return valueLines(text, CORRECT_PREFIX, asCorrectChoice, INDENT, asIndented);
}

function plainLines(text: string, label: string, allowed: (kind: LineKind) => boolean): string[] {
  return valueLines(text, `${label} `, allowed, '', asPlain);
}

function renderAnswer(question: Question): { lines: string[]; ids?: string[] } {
  switch (question.format) {
    case 'multiple-choice': {
      const lines: string[] = [LABEL.choices];
      for (const choice of question.choices) {
        lines.push(
          ...(choice.id === question.correctChoiceId ? correctLines(choice.text) : bulletLines(choice.text)),
        );
      }
      const ids = question.choices.map((choice) => choice.id);
      return { lines, ids: sameIds(ids, defaultIds('multiple-choice', ids.length)) ? undefined : ids };
    }
    case 'true-false':
      return { lines: [`${LABEL.answer} ${question.correct ? 'True' : 'False'}`] };
    case 'short-answer': {
      const lines = plainLines(question.modelAnswer, LABEL.modelAnswer, asModelAnswer);
      if (question.acceptable?.length) {
        lines.push(LABEL.alsoAccepted);
        for (const entry of question.acceptable) lines.push(...bulletLines(entry));
      }
      if (question.rubric?.length) {
        lines.push(LABEL.rubric);
        for (const entry of question.rubric) lines.push(...bulletLines(entry));
      }
      return { lines };
    }
    case 'list-recall': {
      const lines = [`**Name ${question.required} of these:**`];
      for (const item of question.items) lines.push(...bulletLines(item));
      return { lines };
    }
    case 'fill-blank': {
      const runs = parseTemplate(question.template);
      const rendered = runs
        .map((run) => (run.kind === 'text' ? escapeTemplateText(run.text) : BLANK_RUN))
        .join('');
      const lines = plainLines(rendered, LABEL.fillIn, asFillIn);
      lines.push(LABEL.blanks);
      question.blanks.forEach((blank, index) => {
        lines.push(valueLine(`${index + 1}. `, oneLine(blank.accepted[0]), asNumbered));
        for (const alternative of blank.accepted.slice(1)) {
          lines.push(valueLine(`${SUB_BULLET_PREFIX}${LABEL.alsoAcceptedBlank}`, oneLine(alternative), asSubBullet));
        }
        if (blank.caseSensitive) lines.push(`${SUB_BULLET_PREFIX}${LABEL.caseSensitive}`);
      });
      const ids = question.blanks.map((blank) => blank.id);
      return { lines, ids: sameIds(ids, defaultIds('fill-blank', ids.length)) ? undefined : ids };
    }
    case 'timeline': {
      const lines = [LABEL.inOrder, '', '| # | Event | Date |', '|---|---|---|'];
      question.events.forEach((event, index) => {
        lines.push(`| ${index + 1} | ${escapeCell(event.label)} | ${escapeCell(event.date)} |`);
      });
      const ids = question.events.map((event) => event.id);
      return { lines, ids: sameIds(ids, defaultIds('timeline', ids.length)) ? undefined : ids };
    }
    case 'map-locate':
      // Never reached: `normalizeQuestion` refuses the format. Listed so adding
      // a format to the union is a compile error here rather than a silent gap.
      return { lines: [] };
  }
}

const VOCAB_ATTRIBUTION = 'From your vocabulary · ';
const PROMPT_ATTRIBUTION = 'Asked for: ';
const NOTE_EXTENSION = /\.mdx?$/i;

/** `[[target|alias]]` cannot hold these; fall back to plain text when they occur. */
function linkSafe(text: string): boolean {
  return !text.includes('|') && !text.includes(']]');
}

function renderAttribution(question: Question): string {
  const { provenance } = question;
  if (question.sourceId === 'vocab') {
    const word = provenance.noteTitle ?? slugFromPath(provenance.path) ?? '';
    return `${VOCAB_ATTRIBUTION}**${word}**`;
  }
  if (question.sourceId === 'prompt') {
    return `${PROMPT_ATTRIBUTION}${provenance.noteTitle ?? ''}`;
  }
  const section = provenance.section ? ` › ${provenance.section}` : '';
  // The LLM path stores the filename, extension included, as the title. Only
  // then is the extension dropped from the alias — the parser puts it back by
  // comparing against the path — so any other title survives verbatim.
  const alias =
    provenance.noteTitle && provenance.path && provenance.noteTitle === noteFilename(provenance.path)
      ? provenance.noteTitle.replace(NOTE_EXTENSION, '')
      : provenance.noteTitle;
  if (provenance.path) {
    const target = provenance.path.replace(NOTE_EXTENSION, '');
    if (linkSafe(target) && (!alias || linkSafe(alias))) {
      return `[[${target}${alias ? `|${alias}` : ''}]]${section}`;
    }
  }
  return `${provenance.noteTitle ?? ''}${section}`;
}

/** Which provenance field the quoted lines come from, if any. */
function quotedField(question: Question): 'quote' | 'excerpt' | undefined {
  const { provenance } = question;
  if (provenance.quote) return 'quote';
  if (!provenance.excerpt) return undefined;
  // A prompt's excerpt is its subject, already on the attribution line.
  if (question.sourceId === 'prompt' && provenance.excerpt === provenance.noteTitle) return undefined;
  return 'excerpt';
}

function renderSource(question: Question): string[] {
  const field = quotedField(question);
  const text = field ? question.provenance[field] ?? '' : '';
  const lines = text
    ? text.split('\n').map((line) => (line === '' ? '>' : valueLine('> ', line, asQuote)))
    : [];
  lines.push(`> — ${renderAttribution(question)}`);
  return lines;
}

function renderDetails(question: Question, review: ReviewState | undefined, meta: QuizFileMeta): string[] {
  const lines = [
    `- Format: ${getQuestionLogic(question.format).label}`,
    question.topics.length ? `- Topics: ${question.topics.map((topic) => `#${topic}`).join(' ')}` : '- Topics:',
    `- Difficulty: ${question.difficulty}`,
    `- Created: ${formatIso(question.addedAt)}`,
  ];
  if (question.contentAt !== undefined && question.contentAt !== question.addedAt) {
    lines.push(`- Material: ${formatIso(question.contentAt)}`);
  }
  if (question.updatedAt !== undefined) lines.push(`- Edited: ${formatIso(question.updatedAt)}`);
  if (question.planId) {
    const title = meta.planTitle?.(question.planId);
    if (title) lines.push(`- Plan: ${oneLine(title)}`);
  }
  if (review) {
    lines.push(
      `- Progress: answered ${review.reps} · missed ${review.lapses} · streak ${review.streak} · ${MASTERY_LABELS[masteryOf(review)]}`,
      `- Schedule: last ${formatIso(review.lastReviewedAt)} (${review.lastOutcome}) · due ${formatDay(review.dueAt)} · interval ${formatNumber(review.intervalDays)} days · ease ${formatNumber(review.ease)}`,
    );
    if (review.leech) lines.push(LABEL.leech);
  }
  return lines;
}

function renderFlag(question: Question): string[] {
  const flag = question.flagged;
  if (!flag) return [];
  const lines = [`> [!warning] Flagged ${flag.reason} on ${formatIso(flag.at)}`];
  if (flag.note) {
    for (const line of flag.note.split('\n')) lines.push(line === '' ? '>' : valueLine('> ', line, asQuote));
  }
  return lines;
}

function renderBlock(entry: QuizFileEntry, number: number, meta: QuizFileMeta): string[] {
  const { question, review } = entry;
  const answer = renderAnswer(question);
  const promptLines = question.prompt.split('\n');

  const payload: Record<string, unknown> = { v: 1, id: question.id, src: question.sourceId };
  if (question.provenance.path) payload.path = question.provenance.path;
  if (question.provenance.revision) payload.rev = question.provenance.revision;
  if (question.planId) payload.plan = question.planId;
  if (answer.ids) payload.ids = answer.ids;
  const field = quotedField(question);
  if (field) payload.pv = field;
  if (question.figure) payload.fig = question.figure;

  const lines = [`## ${number}. ${promptLines[0]}`, encodeComment(payload)];
  for (const line of promptLines.slice(1)) lines.push(line === '' ? '' : valueLine('', line, asPlain));
  lines.push('', ...answer.lines, '');
  if (question.explanation) lines.push(...plainLines(question.explanation, LABEL.why, asWhy), '');
  lines.push(...renderSource(question), '');
  lines.push(...renderDetails(question, review, meta));
  const flag = renderFlag(question);
  if (flag.length) lines.push('', ...flag);
  return lines;
}

function materialKey(question: Question): string {
  return `${question.sourceId}:${question.provenance.path ?? question.provenance.noteTitle ?? ''}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

export function renderQuizFile(input: readonly QuizFileEntry[], meta: QuizFileMeta): RenderResult {
  const entries: QuizFileEntry[] = [];
  const skipped: RenderResult['skipped'] = [];

  for (const entry of input) {
    const question = normalizeQuestion(entry.question);
    if (!question) {
      skipped.push({ id: entry.question.id, reason: 'not writable as a note' });
      continue;
    }
    const review = entry.review && isValidReviewState(entry.review) ? normalizeReview(entry.review) : undefined;
    entries.push(review ? { question, review } : { question });
  }

  // Stable order, so a rewrite never reshuffles the file under the reader.
  entries.sort((a, b) => a.question.addedAt - b.question.addedAt || a.question.id.localeCompare(b.question.id));

  const tags = ['quizbot'];
  const materials = new Set<string>();
  for (const { question } of entries) {
    for (const topic of question.topics) if (!tags.includes(topic)) tags.push(topic);
    materials.add(materialKey(question));
  }

  const count = entries.length;
  const notes = materials.size;
  const summary =
    `${count} question${count === 1 ? '' : 's'} added on ${formatLongDate(meta.createdAt)}` +
    (notes > 0 ? ` from ${notes} ${notes === 1 ? 'source' : 'sources'}` : '') +
    '. QuizBot rewrites this file when these questions change and drops questions the app ' +
    'has removed; a file you edit yourself is left alone from then on.';

  const lines = [
    '---',
    `type: ${QUIZ_FILE_TYPE}`,
    `created: ${yamlString(formatIso(meta.createdAt))}`,
    `questions: ${count}`,
    `tags: [${tags.map(yamlString).join(', ')}]`,
    '---',
    '',
    `# Quiz questions · ${formatShortDate(meta.createdAt)}`,
    '',
    summary,
  ];
  entries.forEach((entry, index) => {
    lines.push('', ...renderBlock(entry, index + 1, meta));
  });

  return { text: `${lines.join('\n')}\n`, entries, skipped };
}

/** The note that explains the folder, written once beside the first quiz file. */
export function renderFolderReadme(): string {
  return [
    '# Quiz questions',
    '',
    'QuizBot writes the questions in its bank here, one file per batch it synced.',
    'Each file is a quiz sheet you can read: the question, the answer, why, where in',
    'your notes it came from, and how you are doing on it.',
    '',
    '- The app rewrites a file when its questions change — an edit, a flag, a new',
    '  review — and removes questions it has deleted.',
    '- A file you edit yourself is left alone from then on, so nothing you write',
    '  here is lost. Importing from this folder brings your edits back into the app.',
    '- Questions the app builds on the fly (geography, calendar) are never stored',
    '  and are not here.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type Segment = { kind: LineKind; lines: string[] };

class BlockError extends Error {}

function fail(reason: string): never {
  throw new BlockError(reason);
}

/** Groups a question block's lines into marker-led segments. */
function segment(lines: readonly string[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let blanks: string[] = [];

  for (const line of lines) {
    const kind = classify(line);
    if (kind === 'blank') {
      blanks.push('');
      continue;
    }
    const inQuoteRun = current?.kind === 'quote' || current?.kind === 'callout';
    const starts = kind === 'quote' ? !inQuoteRun : isStarter(kind);
    if (starts) {
      current = { kind, lines: [line] };
      segments.push(current);
      blanks = [];
      continue;
    }
    if (!current) {
      current = { kind: 'text', lines: [] };
      segments.push(current);
    }
    current.lines.push(...blanks, line);
    blanks = [];
  }
  return segments;
}

type Item = { text: string; correct: boolean };

/** `- item` lines with indented continuation, as written by `bulletLines`. */
function parseItems(lines: readonly string[]): Item[] {
  const items: { first: string; rest: string[]; correct: boolean }[] = [];
  for (const line of lines) {
    const kind = classify(line);
    if (kind === 'bullet') {
      items.push({ first: unescapeValue(line.slice(2)), rest: [], correct: false });
    } else if (kind === 'correct-choice') {
      items.push({ first: unescapeValue(line.slice(CORRECT_PREFIX.length)), rest: [], correct: true });
    } else if (kind === 'indented' || kind === 'blank') {
      const last = items[items.length - 1];
      if (!last) fail('list continues before its first item');
      last.rest.push(line);
    } else {
      fail(`unexpected line in a list: ${line}`);
    }
  }
  return items.map((item) => ({
    text: joinValue(item.first, item.rest, (line) => line.slice(INDENT.length)),
    correct: item.correct,
  }));
}

function plainValue(segmentLines: readonly string[], label: string): string {
  const first = segmentLines[0];
  const firstText = first === label ? '' : unescapeValue(first.slice(label.length + 1));
  return joinValue(firstText, segmentLines.slice(1), (line) => line);
}

type Meta = {
  id: string;
  src: string;
  path?: string;
  rev?: string;
  plan?: string;
  ids?: string[];
  pv?: 'quote' | 'excerpt';
  fig?: unknown;
};

function readMeta(line: string): Meta {
  const raw = decodeComment(line);
  if (!raw) fail('unreadable quizbot comment');
  if (typeof raw.id !== 'string' || !raw.id) fail('comment has no id');
  if (typeof raw.src !== 'string' || !raw.src) fail('comment has no source');
  const meta: Meta = { id: raw.id, src: raw.src };
  if (typeof raw.path === 'string' && raw.path) meta.path = raw.path;
  if (typeof raw.rev === 'string' && raw.rev) meta.rev = raw.rev;
  if (typeof raw.plan === 'string' && raw.plan) meta.plan = raw.plan;
  if (isStringList(raw.ids)) meta.ids = raw.ids;
  if (raw.pv === 'quote' || raw.pv === 'excerpt') meta.pv = raw.pv;
  if (raw.fig !== undefined) meta.fig = raw.fig;
  return meta;
}

function idsFor(meta: Meta, format: 'multiple-choice' | 'fill-blank' | 'timeline', count: number): string[] {
  // A hand edit that added or removed an item leaves the comment's ids stale;
  // positional ids are what a model revision would assign too.
  return meta.ids && meta.ids.length === count ? meta.ids : defaultIds(format, count);
}

type AnswerFields =
  | { format: 'multiple-choice'; choices: { id: string; text: string }[]; correctChoiceId: string }
  | { format: 'true-false'; correct: boolean }
  | { format: 'short-answer'; modelAnswer: string; acceptable?: string[]; rubric?: string[] }
  | { format: 'list-recall'; required: number; items: string[] }
  | { format: 'fill-blank'; template: string; blanks: Blank[] }
  | { format: 'timeline'; events: { id: string; label: string; date: string }[] };

const ANSWER_KINDS: readonly LineKind[] = ['choices', 'answer', 'model-answer', 'name-of', 'fill-in', 'in-order'];

function parseAnswer(segments: readonly Segment[], meta: Meta): AnswerFields {
  const starters = segments.filter((entry) => ANSWER_KINDS.includes(entry.kind));
  if (starters.length !== 1) fail(starters.length === 0 ? 'no answer block' : 'more than one answer block');
  const block = starters[0];
  const byKind = (kind: LineKind) => segments.find((entry) => entry.kind === kind);

  switch (block.kind) {
    case 'choices': {
      const items = parseItems(block.lines.slice(1));
      const ids = idsFor(meta, 'multiple-choice', items.length);
      const correct = items.map((item, index) => (item.correct ? ids[index] : null)).filter(Boolean);
      if (correct.length !== 1) fail('a multiple-choice question needs exactly one ✓');
      return {
        format: 'multiple-choice',
        choices: items.map((item, index) => ({ id: ids[index], text: item.text })),
        correctChoiceId: correct[0] as string,
      };
    }
    case 'answer': {
      if (block.lines.length !== 1) fail('true/false answer has extra lines');
      const value = block.lines[0].slice(LABEL.answer.length + 1);
      if (value !== 'True' && value !== 'False') fail('true/false answer must be True or False');
      return { format: 'true-false', correct: value === 'True' };
    }
    case 'model-answer': {
      const modelAnswer = plainValue(block.lines, LABEL.modelAnswer);
      const accepted = byKind('also-accepted');
      const rubric = byKind('rubric');
      const acceptable = accepted ? parseItems(accepted.lines.slice(1)).map((item) => item.text) : undefined;
      const covers = rubric ? parseItems(rubric.lines.slice(1)).map((item) => item.text) : undefined;
      return {
        format: 'short-answer',
        modelAnswer,
        ...(acceptable?.length ? { acceptable } : {}),
        ...(covers?.length ? { rubric: covers } : {}),
      };
    }
    case 'name-of': {
      const required = Number(NAME_OF.exec(block.lines[0])?.[1]);
      return {
        format: 'list-recall',
        required,
        items: parseItems(block.lines.slice(1)).map((item) => item.text),
      };
    }
    case 'fill-in': {
      const rendered = plainValue(block.lines, LABEL.fillIn);
      const parts = rendered.split(BLANK_RUN);
      const ids = idsFor(meta, 'fill-blank', parts.length - 1);
      const template = parts
        .map((part, index) => unescapeTemplateText(part) + (index < ids.length ? `{{${ids[index]}}}` : ''))
        .join('');
      const list = byKind('blanks');
      if (!list) fail('fill-in question has no Blanks list');
      const blanks: Blank[] = [];
      for (const line of list.lines.slice(1)) {
        const kind = classify(line);
        if (kind === 'blank') continue;
        if (kind === 'numbered') {
          const text = unescapeValue(line.replace(/^\d+\. /, ''));
          blanks.push({ id: ids[blanks.length] ?? `extra${blanks.length}`, accepted: [text] });
          continue;
        }
        if (kind === 'sub-bullet') {
          const last = blanks[blanks.length - 1];
          if (!last) fail('blank detail before its first blank');
          const detail = line.slice(SUB_BULLET_PREFIX.length);
          if (detail === LABEL.caseSensitive) last.caseSensitive = true;
          else if (detail.startsWith(LABEL.alsoAcceptedBlank)) {
            last.accepted.push(unescapeValue(detail.slice(LABEL.alsoAcceptedBlank.length)));
          } else fail(`unexpected blank detail: ${line}`);
          continue;
        }
        fail(`unexpected line in Blanks: ${line}`);
      }
      if (blanks.length !== ids.length) fail('blanks do not match the underscores in the sentence');
      return { format: 'fill-blank', template, blanks };
    }
    case 'in-order': {
      const rows = block.lines.slice(1).filter((line) => line !== '');
      if (rows.length < 2 || !rows.every((line) => classify(line) === 'table-row')) fail('timeline is not a table');
      const data = rows.slice(2).map(splitRow);
      if (!data.every((cells) => cells.length === 3)) fail('timeline rows need three cells');
      const ids = idsFor(meta, 'timeline', data.length);
      return {
        format: 'timeline',
        events: data.map((cells, index) => ({ id: ids[index], label: cells[1], date: cells[2] })),
      };
    }
    default:
      return fail('unknown answer block');
  }
}

const LINK = /^\[\[([^\]|]*)(?:\|([^\]]*))?\]\](?: › (.*))?$/;

function parseSource(seg: Segment | undefined, meta: Meta): Provenance {
  const provenance: Provenance = { sourceId: meta.src };
  if (meta.path) provenance.path = meta.path;
  if (meta.rev) provenance.revision = meta.rev;
  if (!seg) return provenance;

  const texts = seg.lines.map((line) => (line === '>' ? '' : line.slice(2)));
  const last = texts[texts.length - 1];
  if (!last.startsWith('— ')) fail('source block has no attribution line');
  const attribution = last.slice(2);
  const quoted = texts
    .slice(0, -1)
    .map(unescapeValue)
    .join('\n')
    .trim();

  let field: 'quote' | 'excerpt' = 'quote';
  if (attribution.startsWith(VOCAB_ATTRIBUTION)) {
    const word = /^\*\*(.*)\*\*$/.exec(attribution.slice(VOCAB_ATTRIBUTION.length))?.[1];
    if (word) provenance.noteTitle = word;
    field = 'excerpt';
  } else if (attribution.startsWith(PROMPT_ATTRIBUTION)) {
    const subject = attribution.slice(PROMPT_ATTRIBUTION.length);
    if (subject) {
      provenance.noteTitle = subject;
      provenance.excerpt = subject;
    }
    field = 'excerpt';
  } else {
    const link = LINK.exec(attribution);
    let title: string | undefined;
    let section: string | undefined;
    if (link) {
      const alias = link[2];
      section = link[3];
      if (alias) {
        // The LLM path stores the filename, extension included, as the title.
        const filename = meta.path ? noteFilename(meta.path) : undefined;
        const extension = meta.path ? NOTE_EXTENSION.exec(meta.path)?.[0] : undefined;
        title = filename && extension && filename === alias + extension ? filename : alias;
      }
    } else {
      const split = attribution.indexOf(' › ');
      title = split === -1 ? attribution : attribution.slice(0, split);
      section = split === -1 ? undefined : attribution.slice(split + 3);
    }
    if (title) provenance.noteTitle = title;
    if (section) provenance.section = section;
  }

  if (quoted) {
    const target = meta.pv ?? field;
    provenance[target] = quoted;
  }
  return provenance;
}

type Details = {
  topics: string[];
  difficulty?: Difficulty;
  addedAt?: number;
  contentAt?: number;
  updatedAt?: number;
  progress?: { reps: number; lapses: number; streak: number };
  schedule?: { lastReviewedAt: number; lastOutcome: Outcome; dueAt: number; intervalDays: number; ease: number };
  leech: boolean;
};

const PROGRESS = /^answered (\d+) · missed (\d+) · streak (\d+)(?: · .*)?$/;
const SCHEDULE = /^last (\S+) \((correct|partial|incorrect)\) · due (\S+) · interval (\S+) days · ease (\S+)$/;

function parseDetails(segments: readonly Segment[]): Details {
  const details: Details = { topics: [], leech: false };
  for (const seg of segments) {
    if (seg.kind !== 'detail') continue;
    if (seg.lines.length !== 1) fail(`detail line has a continuation: ${seg.lines[0]}`);
    const line = seg.lines[0];
    if (line === LABEL.leech) {
      details.leech = true;
      continue;
    }
    const match = DETAIL.exec(line);
    if (!match) fail(`unreadable detail: ${line}`);
    const value = match[2] ?? '';
    switch (match[1]) {
      case 'Topics':
        details.topics = value
          .split(/\s+/)
          .filter(Boolean)
          .map((tag) => tag.replace(/^#/, ''))
          .filter(Boolean);
        break;
      case 'Difficulty':
        if (!DIFFICULTIES.includes(value as Difficulty)) fail(`unknown difficulty: ${value}`);
        details.difficulty = value as Difficulty;
        break;
      case 'Created':
        details.addedAt = parseIso(value) ?? fail(`unreadable Created date: ${value}`);
        break;
      case 'Material':
        details.contentAt = parseIso(value) ?? fail(`unreadable Material date: ${value}`);
        break;
      case 'Edited':
        details.updatedAt = parseIso(value) ?? fail(`unreadable Edited date: ${value}`);
        break;
      case 'Progress': {
        const parts = PROGRESS.exec(value);
        if (!parts) fail(`unreadable Progress: ${value}`);
        details.progress = { reps: Number(parts[1]), lapses: Number(parts[2]), streak: Number(parts[3]) };
        break;
      }
      case 'Schedule': {
        const parts = SCHEDULE.exec(value);
        if (!parts) fail(`unreadable Schedule: ${value}`);
        const lastReviewedAt = parseIso(parts[1]);
        const dueAt = parseDay(parts[3]);
        const intervalDays = parseNumber(parts[4]);
        const ease = parseNumber(parts[5]);
        if (lastReviewedAt === undefined || dueAt === undefined || intervalDays === undefined || ease === undefined) {
          fail(`unreadable Schedule: ${value}`);
        }
        details.schedule = { lastReviewedAt, lastOutcome: parts[2] as Outcome, dueAt, intervalDays, ease };
        break;
      }
      default:
        // Format and Plan are display only; the format comes from the answer
        // block and the plan id from the comment.
        break;
    }
  }
  return details;
}

function parseFlag(seg: Segment | undefined): QuestionBase['flagged'] | undefined {
  if (!seg) return undefined;
  const head = CALLOUT.exec(seg.lines[0]);
  const match = head ? /^Flagged (\S+) on (\S+)$/.exec(head[2]) : null;
  if (!match) fail(`unreadable flag: ${seg.lines[0]}`);
  const reason = match[1] as FlagReason;
  if (!FLAG_REASONS.includes(reason)) fail(`unknown flag reason: ${reason}`);
  const at = parseIso(match[2]) ?? fail(`unreadable flag date: ${match[2]}`);
  const note = seg.lines
    .slice(1)
    .map((line) => (line === '>' ? '' : unescapeValue(line.slice(2))))
    .join('\n')
    .trim();
  return { reason, at, ...(note ? { note } : {}) };
}

function parseBlock(lines: readonly string[], warnings: ParseWarning[]): QuizFileEntry | undefined {
  const heading = HEADING.exec(lines[0]);
  const headingText = heading?.[2] ?? '';
  try {
    const segments = segment(lines.slice(1));
    const comment = segments[0];
    if (!comment || comment.kind !== 'comment') fail('no quizbot comment under the heading');
    const meta = readMeta(comment.lines[0]);
    const prompt = joinValue(headingText, comment.lines.slice(1), (line) => line);

    const answer = parseAnswer(segments, meta);
    const why = segments.find((entry) => entry.kind === 'why');
    const explanation = why ? plainValue(why.lines, LABEL.why) : '';
    const provenance = parseSource(
      segments.find((entry) => entry.kind === 'quote'),
      meta,
    );
    const details = parseDetails(segments);
    const flagged = parseFlag(segments.find((entry) => entry.kind === 'callout'));

    if (details.addedAt === undefined) fail('no Created date');
    if (!details.difficulty) fail('no Difficulty');

    const base: QuestionBase = {
      id: meta.id,
      prompt,
      explanation,
      topics: details.topics,
      difficulty: details.difficulty,
      sourceId: meta.src,
      provenance,
      addedAt: details.addedAt,
      contentAt: details.contentAt ?? details.addedAt,
      ...(details.updatedAt !== undefined ? { updatedAt: details.updatedAt } : {}),
      ...(flagged ? { flagged } : {}),
      ...(meta.fig !== undefined ? { figure: meta.fig as QuestionBase['figure'] } : {}),
      ...(meta.plan ? { planId: meta.plan } : {}),
    };
    const question = { ...base, ...answer } as Question;
    if (!isValidQuestion(question)) fail('question is not valid');

    let review: ReviewState | undefined;
    if (details.progress && details.schedule) {
      const state: ReviewState = {
        questionId: meta.id,
        ...details.progress,
        ...details.schedule,
        ...(details.leech ? { leech: true } : {}),
      };
      if (isValidReviewState(state) && OUTCOMES.includes(state.lastOutcome)) review = state;
      else warnings.push({ id: meta.id, reason: 'review state is not valid; question kept' });
    } else if (details.progress || details.schedule) {
      warnings.push({ id: meta.id, reason: 'Progress without Schedule (or the reverse); question kept' });
    }

    return review ? { question, review } : { question };
  } catch (error) {
    if (error instanceof BlockError) {
      warnings.push({ heading: headingText, reason: error.message });
      return undefined;
    }
    throw error;
  }
}

/**
 * Reads a quiz file back. Frontmatter, the title and the summary are ignored:
 * the question blocks are the whole truth. A block that cannot be read becomes
 * a warning and the rest of the file is still returned.
 */
export function parseQuizFile(text: string): ParsedQuizFile {
  const lines = text.split(/\r?\n/);
  const starts: number[] = [];
  lines.forEach((line, index) => {
    if (HEADING.test(line)) starts.push(index);
  });

  const warnings: ParseWarning[] = [];
  const entries: QuizFileEntry[] = [];
  const seen = new Set<string>();
  starts.forEach((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : lines.length;
    const entry = parseBlock(lines.slice(start, end), warnings);
    if (!entry) return;
    if (seen.has(entry.question.id)) {
      warnings.push({ id: entry.question.id, reason: 'appears twice; later copy ignored' });
      return;
    }
    seen.add(entry.question.id);
    entries.push(entry);
  });
  return { entries, warnings };
}

/** Whether a file is one of ours, judged by the frontmatter `type` key. */
export function isQuizFileText(text: string): boolean {
  return /^---\r?\n(?:[^\n]*\r?\n)*?type: quizbot-questions\r?\n/.test(text);
}
