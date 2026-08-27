import { hashString, seededInt } from '../../lib/random';
import { isValidQuestion } from '../../quiz/questionTypes/registry';
import { MAX_EVENTS, MIN_EVENTS } from '../../quiz/questionTypes/timeline';
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
 *  - Which half of a true/false pair the reader is shown. The model writes both
 *    the claim and a distortion of it and is told it does not get to choose;
 *    left to choose, it wrote statements that were true four times in five.
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

export type ParseOptions = {
  /**
   * Accept a true/false row written as one statement plus a `correct` boolean.
   *
   * Generation must NOT set this. The pair is the whole of what makes the
   * format worth asking (see `pickTrueFalseSide`), and a model that ignores it
   * has to fail loudly in `rejected` rather than quietly go back to writing
   * questions whose answer is "true" four times out of five.
   *
   * The revise path sets it because it has no choice: a stored question holds
   * only the statement the reader was shown, so an edit to one comes back in
   * the shape it went out in.
   */
  allowUnpairedTrueFalse?: boolean;
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

/** The passage a question came from, if the model gave a usable one. */
function quoteFrom(raw: Record<string, unknown>): string | undefined {
  const quote = asString(raw.source).trim();
  /*
    Not validated against the note here.

    The parser doesn't hold the note text, and more importantly a quote that
    doesn't match is still worth keeping: matching is deliberately lenient and
    happens at render time, where failing to find it costs a highlight rather
    than the question. Rejecting here would throw away good questions over
    punctuation.
  */
  return quote.length > 0 ? quote : undefined;
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
      quote: quoteFrom(raw),
    },
    addedAt: context.addedAt,
    contentAt: context.contentAt ?? context.addedAt,
  };
}

/**
 * Takes the date back out of an event label.
 *
 * A timeline whose labels read "Fort Sumter is shelled (1861)" is a reading
 * test, not a memory test — the order can be sorted off the screen without
 * remembering anything. The prompt says so, and models leak it anyway.
 *
 * Repairs rather than rejects, because a dropped row is a silent loss. Matched
 * against the date the model supplied FOR THAT EVENT, as a whole word, never as
 * a general year pattern: "The 1922 Committee is founded" dated 1923 has to
 * survive intact, and a blanket strip would gut it.
 */
function withoutDate(label: string, date: string): string {
  const escaped = date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = label
    .replace(new RegExp(`[(\\[]?\\s*\\b${escaped}\\b\\s*[)\\]]?`, 'gi'), ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, '')
    .trim();

  // A label that was ONLY its date is left alone: an odd label beats a row
  // dropped for being empty, and the editor flags it either way.
  return stripped || label;
}

/**
 * Which half of a true/false pair the reader is shown.
 *
 * Seeded from the id — which hashes the CLAIM, never the statement on screen —
 * so the side is stable across regenerations of an unchanged note, and the two
 * halves collapse into one card instead of two.
 *
 * This flip is the point of the pair. A model asked for one true-or-false
 * statement writes down what the note says, so the answer is "true" almost
 * every time; deciding the side here takes that out of its hands entirely and
 * fixes the base rate at even. It also forces the false statement to be written
 * alongside the true one about the same fact, which is what stops it being a
 * shorter, flatter sentence the reader can spot without knowing anything.
 */
function pickTrueFalseSide(id: string): boolean {
  return seededInt(hashString(`true-false|${id}`), 0, 1) === 1;
}

/** The correction, then the fact. Both are written to stand as sentences. */
function joinExplanation(whyWrong: string, explanation: string): string {
  const lead = /[.!?]$/.test(whyWrong) ? whyWrong : `${whyWrong}.`;
  return `${lead} ${explanation}`;
}

/** Builds one question, or explains why it couldn't be built. */
function buildQuestion(
  raw: unknown,
  context: ParseContext,
  options: ParseOptions,
): { question: Question } | { reason: string } {
  if (!raw || typeof raw !== 'object') return { reason: 'not an object' };
  const row = raw as Record<string, unknown>;

  const format = asString(row.format);

  /*
    A paired true/false row carries no "prompt" — the statement shown is chosen
    below from "claim" and "distortion". The claim stands in for it here, and so
    seeds the id: hashing the shown statement instead would give one fact two
    ids depending on which way the coin fell.
  */
  const claim = format === 'true-false' ? asString(row.claim) : '';
  const prompt = claim || asString(row.prompt);
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
      if (claim) {
        const distortion = asString(row.distortion);
        if (!distortion) return { reason: 'true-false needs a "distortion"' };
        // Two identical halves are not a pair, and the coin flip would then
        // decide the answer to a question the reader cannot possibly get right.
        if (distortion === claim) return { reason: 'distortion repeats the claim' };

        const showsClaim = pickTrueFalseSide(base.id);
        const whyWrong = asString(row.whyWrong);
        return {
          question: {
            ...base,
            format: 'true-false',
            prompt: showsClaim ? claim : distortion,
            /*
              "whyWrong" is used, not required. It only sharpens an explanation
              that already states the true fact, and dropping an otherwise good
              pair over a missing clause costs more than the clause is worth.
            */
            explanation:
              showsClaim || !whyWrong ? base.explanation : joinExplanation(whyWrong, base.explanation),
            correct: showsClaim,
          },
        };
      }

      if (!options.allowUnpairedTrueFalse) {
        return { reason: 'true-false needs "claim" and "distortion"' };
      }
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

    case 'timeline': {
      /*
        Read WITHOUT `asStringArray`, which drops empty entries.

        Dates pair with events BY POSITION, so compacting either array would
        re-date every event after the gap — the one failure mode here that
        produces a question which looks perfectly fine and is wrong.
      */
      const labels = Array.isArray(row.events) ? row.events.map(asString) : [];
      const dates = Array.isArray(row.dates) ? row.dates.map(asString) : [];

      if (labels.length < MIN_EVENTS) return { reason: `needs at least ${MIN_EVENTS} events` };
      if (labels.length > MAX_EVENTS) return { reason: `at most ${MAX_EVENTS} events` };
      if (labels.some((label) => !label)) return { reason: 'blank event label' };
      if (dates.length !== labels.length) return { reason: 'one date per event required' };
      if (dates.some((date) => !date)) return { reason: 'blank event date' };
      // The dates are the slots the reader drags onto, so a repeated one draws
      // two identical rows and makes one of them unwinnable. Named here rather
      // than left to `isValidQuestion`, so a run reports why it dropped the row.
      if (new Set(dates).size !== dates.length) return { reason: 'two events share a date' };

      /*
        The model writes the events IN ORDER, and ids are assigned here exactly
        as multiple-choice ids are. Asking for an order AND an index into it is
        two fields it can contradict itself with, for no gain — the view
        shuffles at render, so the stored order never reaches the reader.
      */
      const events = labels.map((label, position) => ({
        id: `e${position}`,
        label: withoutDate(label, dates[position]),
        date: dates[position],
      }));

      return { question: { ...base, format: 'timeline', events } };
    }

    default:
      return { reason: `unknown format "${format}"` };
  }
}

export function parseQuestions(
  text: string,
  context: ParseContext,
  options: ParseOptions = {},
): ParseOutcome {
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
    const result = buildQuestion(raw, context, options);
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
