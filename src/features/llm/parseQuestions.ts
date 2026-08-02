import { hashString } from '../../lib/random';
import { isValidQuestion } from '../../quiz/questionTypes/registry';
import type { Difficulty, Question, QuestionBase } from '../../quiz/types';

/**
 * Turns a model's reply into questions the bank will accept.
 *
 * The division of labour is the important part. The model supplies the parts
 * that need judgement — the question, the answer, why it's right. Everything
 * that needs to be CONSISTENT is assigned here:
 *
 *  - `id`, from a hash of source + path + section + format + prompt, so
 *    re-generating an unchanged note dedupes instead of piling up near-copies
 *    that spaced repetition would then schedule separately.
 *  - `topics`, from the note's series and tags. Letting a model invent topic
 *    strings per call would re-fragment the vocabulary within a few runs, and a
 *    coherent vocabulary is what makes topic quizzes and mastery mean anything.
 *  - `provenance`, because only the caller knows where the text came from.
 *
 * A model that supplies these anyway is ignored, which is asserted in tests.
 *
 * Every row is finally put through `isValidQuestion` — the same gate storage
 * uses — and a row that fails is dropped on its own, never taking the batch
 * with it.
 */

export type ParseContext = {
  sourceId: string;
  path: string;
  noteTitle: string;
  section?: string;
  topics: string[];
  revision?: string;
  excerpt: string;
  addedAt: number;
  contentAt?: number;
};

export type RejectedQuestion = { reason: string; raw: unknown };

export type ParseOutcome = {
  questions: Question[];
  rejected: RejectedQuestion[];
};

const DIFFICULTIES: Difficulty[] = ['intro', 'core', 'deep'];

/** How many entries a recall question asks for, when the list is long enough. */
const RECALL_TARGET = 3;

/**
 * Pulls the JSON object out of a reply.
 *
 * Models wrap JSON in markdown fences often enough that failing on it would be
 * a self-inflicted error rate, and Anthropic has no native JSON mode to lean
 * on. Falls back to the outermost braces, which also survives a short preamble.
 */
export function extractJson(text: string): unknown {
  const withoutFence = text
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (match) => (match.includes('```') ? '' : match))
    .replace(/```[\s\S]*$/, '')
    .trim();

  const candidates = [withoutFence, text.trim()];
  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;

    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const sliced = tryParse(candidate.slice(start, end + 1));
      if (sliced !== undefined) return sliced;
    }
  }
  return undefined;
}

function tryParse(value: string): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function deterministicId(context: ParseContext, format: string, prompt: string): string {
  const seed = `${context.sourceId}|${context.path}|${context.section ?? ''}|${format}|${prompt}`;
  return `q-${hashString(seed).toString(36)}`;
}

function baseFor(context: ParseContext, format: string, prompt: string, raw: Record<string, unknown>): QuestionBase {
  const difficulty = asString(raw.difficulty) as Difficulty;

  return {
    id: deterministicId(context, format, prompt),
    prompt,
    explanation: asString(raw.explanation),
    topics: context.topics,
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'core',
    sourceId: context.sourceId,
    provenance: {
      sourceId: context.sourceId,
      path: context.path,
      revision: context.revision,
      noteTitle: context.noteTitle,
      section: context.section,
      excerpt: context.excerpt,
    },
    addedAt: context.addedAt,
    contentAt: context.contentAt ?? context.addedAt,
  };
}

/** Builds one question, or explains why it couldn't be built. */
function buildQuestion(
  raw: unknown,
  context: ParseContext,
): { question: Question } | { reason: string } {
  if (!raw || typeof raw !== 'object') return { reason: 'not an object' };
  const row = raw as Record<string, unknown>;

  const format = asString(row.format);
  const prompt = asString(row.prompt);
  if (!prompt) return { reason: 'missing prompt' };

  const base = baseFor(context, format, prompt, row);
  if (!base.explanation) return { reason: 'missing explanation' };

  switch (format) {
    case 'multiple-choice': {
      const texts = asStringArray(row.choices);
      if (texts.length < 2) return { reason: 'needs at least 2 choices' };

      const index = typeof row.correctIndex === 'number' ? row.correctIndex : -1;
      if (!Number.isInteger(index) || index < 0 || index >= texts.length) {
        return { reason: 'correctIndex out of range' };
      }

      // Ids are assigned here rather than asked for: grading is by id, and a
      // model mismatching two of its own fields is a bug class worth removing
      // rather than validating against.
      const choices = texts.map((text, position) => ({ id: `c${position}`, text }));
      return {
        question: { ...base, format: 'multiple-choice', choices, correctChoiceId: choices[index].id },
      };
    }

    case 'true-false': {
      if (typeof row.correct !== 'boolean') return { reason: 'missing boolean "correct"' };
      return { question: { ...base, format: 'true-false', correct: row.correct } };
    }

    case 'short-answer': {
      const modelAnswer = asString(row.modelAnswer);
      if (!modelAnswer) return { reason: 'missing modelAnswer' };
      const acceptable = asStringArray(row.acceptable);
      return {
        question: {
          ...base,
          format: 'short-answer',
          modelAnswer,
          ...(acceptable.length > 0 ? { acceptable } : {}),
        },
      };
    }

    case 'list-recall': {
      const items = asStringArray(row.items);
      if (items.length < 2) return { reason: 'needs at least 2 items' };
      // Computed, not taken from the model — "name 5 of 3" is unanswerable.
      const required = Math.min(RECALL_TARGET, items.length);
      return { question: { ...base, format: 'list-recall', items, required } };
    }

    case 'fill-blank': {
      const sentence = asString(row.sentence);
      const answer = asString(row.answer);
      if (!sentence || !answer) return { reason: 'missing sentence or answer' };

      /*
        The model gives a sentence and the words to hide; the placeholder is
        spliced in here. Asking it to emit our `{{a}}` syntax directly invites
        malformed templates that the renderer would then draw ungradeable inputs
        for — this way a mismatch is simply a dropped row.
      */
      const at = sentence.indexOf(answer);
      if (at < 0) return { reason: 'answer not found in sentence' };

      const template = `${sentence.slice(0, at)}{{a}}${sentence.slice(at + answer.length)}`;
      return {
        question: {
          ...base,
          format: 'fill-blank',
          template,
          blanks: [{ id: 'a', accepted: [answer] }],
        },
      };
    }

    default:
      return { reason: `unknown format "${format}"` };
  }
}

export function parseQuestions(text: string, context: ParseContext): ParseOutcome {
  const parsed = extractJson(text);
  if (parsed === undefined) return { questions: [], rejected: [{ reason: 'reply was not JSON', raw: text }] };

  // `{questions: [...]}` is what the prompt asks for — OpenAI's JSON mode needs
  // an object at the root — but a bare array is tolerated.
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { questions?: unknown }).questions)
      ? ((parsed as { questions: unknown[] }).questions)
      : null;

  if (!rows) return { questions: [], rejected: [{ reason: 'no "questions" array', raw: parsed }] };

  const questions: Question[] = [];
  const rejected: RejectedQuestion[] = [];
  const seen = new Set<string>();

  for (const raw of rows) {
    const result = buildQuestion(raw, context);
    if ('reason' in result) {
      rejected.push({ reason: result.reason, raw });
      continue;
    }

    // The same gate storage uses. Anything failing here would be dropped on the
    // next launch anyway, so it must not reach the bank in the first place.
    if (!isValidQuestion(result.question)) {
      rejected.push({ reason: 'failed validation', raw });
      continue;
    }
    if (seen.has(result.question.id)) {
      rejected.push({ reason: 'duplicate', raw });
      continue;
    }

    seen.add(result.question.id);
    questions.push(result.question);
  }

  return { questions, rejected };
}
