import { getQuestionLogic } from '../questionTypes/registry';
import type { QuestionFormat } from '../types';
import { describeScope, normalizeForMatch } from './scope';
import {
  clampQuestionsPerNote,
  DEFAULT_QUESTIONS_PER_NOTE,
  emptyScope,
  isPlanFormat,
  MAX_BULLET_CHARS,
  MAX_BULLETS,
  MAX_STYLE_CHARS,
  MAX_SUMMARY_CHARS,
  MAX_TERM_CHARS,
  MAX_TERMS,
  MAX_TITLE_CHARS,
  PLAN_DIFFICULTIES,
  PLAN_FORMATS,
  type PlanDifficulty,
  type PlanScope,
  type PlanSpec,
} from './types';

/**
 * Turning a plan into something safe to store, something a writer can follow,
 * and something a reader can compare.
 *
 * Pure throughout. The planner's JSON is untrusted in the ordinary sense — a
 * model's reply, not an attacker's — so the job here is the one
 * `parseQuestions` does for questions: keep what is usable, clamp what is out
 * of range, and never let one malformed field cost the reader the whole plan.
 */

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Trimmed, de-duplicated (ignoring case), empty entries dropped, capped. */
export function cleanList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    const text = cleanText(entry, maxChars);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

/** Match phrases additionally need to survive normalization, or they match nothing. */
function cleanTerms(value: unknown): string[] {
  return cleanList(value, MAX_TERMS, MAX_TERM_CHARS).filter((term) => normalizeForMatch(term).length > 0);
}

/** Every format listed is the same as none listed — and reads better as "any". */
function cleanFormats(value: unknown): QuestionFormat[] {
  if (!Array.isArray(value)) return [];
  const formats = Array.from(new Set(value.filter(isPlanFormat)));
  return formats.length === PLAN_FORMATS.length ? [] : formats;
}

const DIFFICULTY_SYNONYMS: Record<string, PlanDifficulty> = {
  gentle: 'gentle',
  easy: 'gentle',
  easier: 'gentle',
  beginner: 'gentle',
  mixed: 'mixed',
  medium: 'mixed',
  moderate: 'mixed',
  balanced: 'mixed',
  challenging: 'challenging',
  hard: 'challenging',
  harder: 'challenging',
  difficult: 'challenging',
  advanced: 'challenging',
};

function cleanDifficulty(value: unknown): PlanDifficulty | undefined {
  return typeof value === 'string' ? DIFFICULTY_SYNONYMS[value.trim().toLowerCase()] : undefined;
}

function cleanPerNote(value: unknown): number | undefined {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? clampQuestionsPerNote(parsed) : undefined;
}

function has(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key) && row[key] !== undefined && row[key] !== null;
}

/** The parts of a spec that are its CONTENT — what a reader would call a change. */
function contentOf(spec: PlanSpec): unknown {
  const { version: _version, author: _author, updatedAt: _updatedAt, ...content } = spec;
  return content;
}

export function sameContent(a: PlanSpec, b: PlanSpec): boolean {
  return JSON.stringify(contentOf(a)) === JSON.stringify(contentOf(b));
}

// ---------------------------------------------------------------------------
// Sanitizing a proposal
// ---------------------------------------------------------------------------

/** Note keys and source ids: exact strings, so only de-duplicated and bounded. */
function cleanKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)),
  ).slice(0, MAX_HAND_PICKS);
}

/** Generous — a reader ticking notes one by one will never reach it. */
const MAX_HAND_PICKS = 2_000;

/**
 * The planner's `plan` object — or the editor's draft — as a stored spec, or
 * null when there is nothing usable in it.
 *
 * A field LEFT OUT keeps its previous value; a field SENT, even empty,
 * replaces it. That is the difference between a reply that forgot to repeat
 * the focus list and one that deliberately cleared it.
 *
 * Three parts of the scope belong to the reader alone: `include` and `exclude`
 * are notes ticked by hand in the editor, which the planner never sees, and
 * `sourceIds` names connections it has no ids for. From the model they are
 * carried over untouched; from the editor (`author: 'user'`) they are taken.
 *
 * Returns `previous` itself — same object, same version — when nothing changes,
 * so a chat turn that only answered a question does not ask the reader to
 * accept a plan identical to the one they already accepted.
 */
export function sanitizeSpec(
  raw: unknown,
  previous: PlanSpec | null,
  now: number,
  author: PlanSpec['author'] = 'ai',
): PlanSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const base = previous ?? null;
  const previousScope = base?.scope ?? emptyScope();
  const fromReader = author === 'user';

  const scopeRow =
    row.scope && typeof row.scope === 'object' && !Array.isArray(row.scope)
      ? (row.scope as Record<string, unknown>)
      : null;

  const scope: PlanScope = scopeRow
    ? {
        sourceIds:
          fromReader && has(scopeRow, 'sourceIds') ? cleanKeys(scopeRow.sourceIds) : previousScope.sourceIds,
        terms: has(scopeRow, 'terms') ? cleanTerms(scopeRow.terms) : previousScope.terms,
        excludeTerms: has(scopeRow, 'excludeTerms')
          ? cleanTerms(scopeRow.excludeTerms)
          : previousScope.excludeTerms,
        folders: has(scopeRow, 'folders')
          ? cleanList(scopeRow.folders, MAX_TERMS, MAX_TERM_CHARS)
          : previousScope.folders,
        include: fromReader && has(scopeRow, 'include') ? cleanKeys(scopeRow.include) : previousScope.include,
        exclude: fromReader && has(scopeRow, 'exclude') ? cleanKeys(scopeRow.exclude) : previousScope.exclude,
      }
    : previousScope;

  const title = cleanText(row.title, MAX_TITLE_CHARS) || base?.title || '';
  // A plan nobody named and that names nothing is not a plan yet.
  if (!title && !scopeRow && !has(row, 'focus')) return null;

  const candidate: PlanSpec = {
    version: (base?.version ?? 0) + 1,
    title: title || 'Untitled plan',
    summary: has(row, 'summary') ? cleanText(row.summary, MAX_SUMMARY_CHARS) : (base?.summary ?? ''),
    scope,
    focus: has(row, 'focus') ? cleanList(row.focus, MAX_BULLETS, MAX_BULLET_CHARS) : (base?.focus ?? []),
    avoid: has(row, 'avoid') ? cleanList(row.avoid, MAX_BULLETS, MAX_BULLET_CHARS) : (base?.avoid ?? []),
    formats: has(row, 'formats') ? cleanFormats(row.formats) : (base?.formats ?? []),
    difficulty: cleanDifficulty(row.difficulty) ?? base?.difficulty ?? 'mixed',
    questionsPerNote:
      cleanPerNote(row.questionsPerNote) ?? base?.questionsPerNote ?? DEFAULT_QUESTIONS_PER_NOTE,
    style: has(row, 'style') ? cleanText(row.style, MAX_STYLE_CHARS) : (base?.style ?? ''),
    author,
    updatedAt: now,
  };

  if (base && sameContent(candidate, base)) return base;
  return candidate;
}

/**
 * A hand edit, cleaned by the same rules as a proposal — so the editor can
 * never store a shape the planner could not have produced.
 */
export function applyHandEdit(edited: PlanSpec, previous: PlanSpec | null, now: number): PlanSpec {
  // Only null for an object with no title, scope or focus at all, which the
  // editor cannot produce — but a stored plan must never become null by being
  // edited, so the fallback keeps what the reader had.
  return sanitizeSpec(edited, previous, now, 'user') ?? previous ?? edited;
}

// ---------------------------------------------------------------------------
// Telling the writer
// ---------------------------------------------------------------------------

const DIFFICULTY_GUIDANCE: Record<PlanDifficulty, string> = {
  gentle:
    'Keep it approachable: definitions, the main ideas, plain recall. No trick questions, and nothing that turns on a fine distinction.',
  mixed:
    'A spread: mostly the main ideas, some definitions and key facts, and a few questions that connect one idea to another.',
  challenging:
    'Push for understanding over recall: why and how, consequences, comparisons, applying an idea to a new case. Few plain definitions.',
};

export const DIFFICULTY_LABELS: Record<PlanDifficulty, string> = {
  gentle: 'Gentle',
  mixed: 'Mixed',
  challenging: 'Challenging',
};

export function formatLabels(formats: readonly QuestionFormat[]): string {
  if (formats.length === 0) return 'Any format';
  return formats.map((format) => getQuestionLogic(format).label).join(', ');
}

/**
 * The plan, written as instructions for the question writer, followed by the
 * reader's general preferences from Settings.
 *
 * Handed to `buildSystemPrompt` as its guidance, which places it last and says
 * outright that it outranks the built-in rules — exactly the standing the plan
 * should have, since it is what the reader agreed. The general preferences sit
 * below it and say so: "use multiple choice only" in this plan should beat
 * "I like short answers" written once in Settings for every quiz.
 */
export function specGuidance(spec: PlanSpec, readerGuidance?: string): string {
  const lines: string[] = [
    'THIS QUIZ HAS A PLAN, agreed with the reader. Every question you write belongs to it, so follow it closely.',
    '',
    `Quiz: ${spec.title}`,
  ];
  if (spec.summary) lines.push(`What it is for: ${spec.summary}`);

  if (spec.focus.length > 0) {
    lines.push('', 'Ask about:', ...spec.focus.map((item) => `- ${item}`));
  }
  if (spec.avoid.length > 0) {
    lines.push('', 'Leave alone — do not write questions about:', ...spec.avoid.map((item) => `- ${item}`));
  }

  lines.push('');
  if (spec.formats.length > 0) {
    lines.push(`Formats: use ONLY ${spec.formats.join(', ')}. Questions in any other format will be discarded.`);
  }
  lines.push(`Difficulty: ${DIFFICULTY_GUIDANCE[spec.difficulty]}`);
  if (spec.style) lines.push(`Style: ${spec.style}`);

  const general = readerGuidance?.trim();
  if (general) {
    lines.push(
      '',
      'THEIR GENERAL PREFERENCES, written once for every quiz. Apply them wherever the plan above does not say otherwise:',
      general,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Comparing versions
// ---------------------------------------------------------------------------

function listChanges(label: string, before: readonly string[], after: readonly string[]): string[] {
  const was = new Set(before.map((item) => item.toLowerCase()));
  const now = new Set(after.map((item) => item.toLowerCase()));
  return [
    ...after.filter((item) => !was.has(item.toLowerCase())).map((item) => `+ ${label}: ${item}`),
    ...before.filter((item) => !now.has(item.toLowerCase())).map((item) => `− ${label}: ${item}`),
  ];
}

/**
 * What changed between two versions, one line per change, for the reader to
 * check before accepting. Empty means nothing a reader would call a change.
 */
export function diffSpecs(before: PlanSpec | null, after: PlanSpec): string[] {
  if (!before) return [];
  const lines: string[] = [];

  if (before.title !== after.title) lines.push(`Renamed to “${after.title}”`);
  if (before.summary !== after.summary) lines.push('Rewrote what the quiz is for');

  const scopeBefore = describeScope(before.scope);
  const scopeAfter = describeScope(after.scope);
  if (JSON.stringify(before.scope) !== JSON.stringify(after.scope)) {
    lines.push(scopeBefore === scopeAfter ? 'Adjusted which notes it reads' : `Notes: ${scopeAfter}`);
  }

  lines.push(...listChanges('Ask about', before.focus, after.focus));
  lines.push(...listChanges('Leave alone', before.avoid, after.avoid));

  if (JSON.stringify(before.formats) !== JSON.stringify(after.formats)) {
    lines.push(`Formats: ${formatLabels(after.formats)}`);
  }
  if (before.difficulty !== after.difficulty) {
    lines.push(`Difficulty: ${DIFFICULTY_LABELS[before.difficulty]} → ${DIFFICULTY_LABELS[after.difficulty]}`);
  }
  if (before.questionsPerNote !== after.questionsPerNote) {
    lines.push(`Questions per note: ${before.questionsPerNote} → ${after.questionsPerNote}`);
  }
  if (before.style !== after.style) lines.push(after.style ? 'Changed the style notes' : 'Removed the style notes');

  return lines;
}

/** The spec as the planner should see it — the same shape it writes. */
export function specForPlanner(spec: PlanSpec): Record<string, unknown> {
  return {
    title: spec.title,
    summary: spec.summary,
    scope: { terms: spec.scope.terms, excludeTerms: spec.scope.excludeTerms, folders: spec.scope.folders },
    focus: spec.focus,
    avoid: spec.avoid,
    formats: spec.formats,
    difficulty: spec.difficulty,
    questionsPerNote: spec.questionsPerNote,
    style: spec.style,
  };
}

/** Exported so the planner prompt can name the vocabulary it may use. */
export const PLANNER_DIFFICULTIES = PLAN_DIFFICULTIES;
