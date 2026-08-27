import { AppError } from '../../lib/errors';
import type { Question } from '../../quiz/types';
import type { LlmProviderDefinition } from './contract';
import { parseQuestions } from './parseQuestions';
import { buildSystemPrompt } from './prompt';

/**
 * "Make this one shorter" — a question, an instruction, a better question back.
 *
 * Deliberately built on the SAME parser the generation path uses. A revision is
 * a question arriving from a model, which is exactly what `parseQuestions`
 * exists to validate, and giving edits their own looser path would mean the
 * bank could hold shapes that generation could never produce — a fill-blank
 * whose answer isn't in its sentence, a multiple-choice with one option.
 *
 * Three things are NOT the model's to change, and are restored afterwards:
 *
 *  - The `id`. It keys review state, session items and coverage. Re-deriving it
 *    from the new prompt (which is what `parseQuestions` does) would orphan
 *    every review the user has ever done on this card and hand them a fresh one
 *    at interval zero. Editing a question is a correction to something they are
 *    already learning.
 *  - `provenance`. The question still came from the same passage of the same
 *    note; a rewording does not change where it came from.
 *  - `addedAt` / `contentAt`. Bumping these would make an edited question look
 *    newly generated to the date filters and to the Daily quiz.
 *
 * One thing that IS re-derived and cannot be helped: a timeline's event ids.
 * They are positional (`e0`..`en`), so revising a question mid-session can
 * leave an in-flight answer holding ids that no longer line up. `scoreTimeline`
 * ignores ids it does not recognise, so the worst case is a low score on an
 * attempt that was already answering a different question.
 */

/** A ceiling on the instruction, which rides in the prompt. */
const MAX_INSTRUCTION_CHARS = 1_000;

/**
 * One question in, one question out — so a small budget, and no chunking.
 * Roughly ten times a single question's measured output cost, which leaves
 * plenty for a reasoning model to think first.
 */
const REVISE_TOKEN_BUDGET = 4_000;

export type ReviseQuestionInput = {
  question: Question;
  /** What the user wants changed, in their own words. */
  instruction: string;
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
  /** The reader's own generation notes, so a revision obeys the same taste. */
  guidance?: string;
  signal?: AbortSignal;
};

export type ReviseQuestionResult = {
  question: Question;
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * The question as the MODEL's own row format, not as stored.
 *
 * It has to go back out in the shape the prompt documents and the parser reads
 * — `correctIndex` rather than `correctChoiceId`, `sentence` + `answer` rather
 * than a spliced `{{a}}` template. Showing it the stored shape and expecting
 * the documented shape back is how you get a revision that fails to parse.
 */
export function toModelRow(question: Question): Record<string, unknown> {
  const base = {
    format: question.format,
    prompt: question.prompt,
    explanation: question.explanation,
    difficulty: question.difficulty,
    ...(question.provenance.quote ? { source: question.provenance.quote } : {}),
  };

  switch (question.format) {
    case 'multiple-choice':
      return {
        ...base,
        choices: question.choices.map((choice) => choice.text),
        correctIndex: Math.max(
          0,
          question.choices.findIndex((choice) => choice.id === question.correctChoiceId),
        ),
      };
    case 'true-false':
      return { ...base, correct: question.correct };
    case 'short-answer':
      return {
        ...base,
        modelAnswer: question.modelAnswer,
        ...(question.acceptable?.length ? { acceptable: question.acceptable } : {}),
      };
    case 'list-recall':
      return { ...base, items: question.items };
    case 'timeline':
      return {
        ...base,
        events: question.events.map((event) => event.label),
        // Always full length, gaps included as empty strings. The parser pairs
        // the two arrays BY POSITION, so compacting out an undated event would
        // re-date every event after it.
        dates: question.events.map((event) => event.date ?? ''),
      };
    case 'fill-blank': {
      // Undo the splice: the parser wants the sentence whole plus the words to
      // hide, and re-derives the template itself.
      const answer = question.blanks[0]?.accepted[0] ?? '';
      return {
        ...base,
        sentence: question.template.replace(/\{\{[^}]*\}\}/, answer),
        answer,
      };
    }
    /*
      Unreachable in practice, and present so that adding a format still has to
      make a decision here rather than silently falling out of the switch.

      A map question cannot be revised by a model: its answer is a region id
      from a generated table, and the revise prompt has no way to name one. It
      also never reaches this function, because revision runs over the BANK and
      geography questions are derived rather than stored — see
      `src/quiz/geography/types.ts`. Returning the base keeps the contract
      (a row the parser can read) without inviting the model to edit a map.
    */
    case 'map-locate':
      return base;
  }
}

export function buildRevisePrompt(question: Question, instruction: string): string {
  return `Here is one existing quiz question, in the same JSON shape you write them in:

${JSON.stringify(toModelRow(question), null, 2)}

The person revising it asked for this change:

"""
${instruction.slice(0, MAX_INSTRUCTION_CHARS)}
"""

Rewrite the question to satisfy that request, and change NOTHING ELSE. This is
an edit, not a new question: if they asked you to shorten the wording, the
answer and the explanation stay as they are.

You may change "format" if the request calls for it — "make this multiple
choice" is a reasonable thing to ask — but keep the same underlying subject.

A true/false question may come back either way: as the single statement you
were given with its "correct" boolean, or as the "claim"/"distortion" pair the
rules describe. Send the PAIR whenever the request is about the question itself
— too easy, too obvious, guessable — since a lone statement is most of why it
was. Send the single statement when the request is only about the wording of
the one in front of you.

Everything in the rules above still applies to the result: it must stand alone,
carry its own context, and be answerable months from now.

Return JSON only, in the usual shape, containing EXACTLY ONE question:
{"questions":[ ... ]}`;
}

export async function reviseQuestion(input: ReviseQuestionInput): Promise<ReviseQuestionResult> {
  const { question, instruction, provider, apiKey, model, signal } = input;

  if (!apiKey) throw new AppError('llm_not_configured');
  if (!instruction.trim()) throw new AppError('llm_bad_response', { message: 'Say what to change first.' });

  const completion = await provider.complete({
    apiKey,
    model,
    system: buildSystemPrompt(input.guidance),
    user: buildRevisePrompt(question, instruction),
    maxTokens: REVISE_TOKEN_BUDGET,
    json: true,
    signal,
  });

  if (completion.stopReason === 'length') {
    throw new AppError('llm_bad_response', {
      message: `${model} was cut off before finishing the revision. Try a shorter instruction.`,
    });
  }

  /*
    Parsed with the ORIGINAL question's provenance and topics.

    Those are not the model's to invent — the question still comes from the same
    passage of the same note — and passing them through the parser rather than
    patching them on afterwards keeps one place that decides a question's shape.
  */
  const { questions, rejected } = parseQuestions(
    completion.text,
    {
      sourceId: question.sourceId,
      path: question.provenance.path ?? '',
      noteTitle: question.provenance.noteTitle ?? '',
      // Conditional rather than `undefined`, which `exactOptionalPropertyTypes`
      // treats as a different thing from an absent key.
      ...(question.provenance.section ? { section: question.provenance.section } : {}),
      ...(question.provenance.revision ? { revision: question.provenance.revision } : {}),
      topics: question.topics,
      excerpt: question.provenance.excerpt ?? '',
      addedAt: question.addedAt,
      contentAt: question.contentAt,
    },
    /*
      The one place an unpaired true/false row is still legal. A stored question
      holds only the statement the reader was shown — the other half of the pair
      was never kept — so a revision of one comes back in the shape it went out
      in, and rejecting that would make every true/false question uneditable.
    */
    { allowUnpairedTrueFalse: true },
  );

  const revised = questions[0];
  if (!revised) {
    throw new AppError('llm_bad_response', {
      message: rejected[0]
        ? `The revision came back unusable (${rejected[0].reason}).`
        : 'The model returned no question.',
    });
  }

  return {
    // `id` last and explicit: `parseQuestions` has just hashed a NEW id out of
    // the new prompt, and keeping that would cost the user their whole review
    // history for this card. See the note at the top of this file.
    // Spread conditionally: writing `flagged: undefined` is not the same as
    // omitting it under `exactOptionalPropertyTypes`.
    question: { ...revised, id: question.id, ...(question.flagged ? { flagged: question.flagged } : {}) },
    usage: completion.usage,
  };
}
