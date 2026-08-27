// The registry directly, not the `questionTypes` index: that also exports the
// views, and pulling React Native in here would make this module — and its
// tests — need a renderer to build a string.
import { getQuestionLogic, transcribeAnswer } from './questionTypes/registry';
import { isVocabQuestion, type VocabWord } from './vocab/types';
import type { Answer, Outcome, Question } from './types';

/**
 * A question, an attempt at it, and everything the app already knows about it,
 * written out for a chat with a model somewhere else.
 *
 * The point is the moment AFTER a wrong answer: the reader wants to argue with
 * something about it, and the app is a quiz player, not a tutor. So it hands
 * over a block of text that stands entirely on its own — no ids, no "the
 * question above", nothing that assumes the reader of it has seen this screen.
 *
 * Assembled from what is already stored, never from a fresh model call: the
 * explanation and the source passage were written when the question was
 * generated, and paying again to restate them would be both slower and less
 * faithful than the words the question actually carries.
 */

/** Enough of the note to argue from, without pasting a whole file into a chat. */
const MAX_CONTEXT_CHARS = 1200;

export type DiscussionSummaryInput = {
  question: Question;
  /** What the reader put. Absent when they pressed "I don't know". */
  answer?: Answer | null;
  /** The verdict as recorded on the session item. */
  outcome?: Outcome;
  /**
   * The ledger row, for a vocabulary question. Optional because the question
   * carries the word and the definition it was written against — the ledger
   * only adds the part of speech, and may no longer hold the word at all.
   */
  word?: VocabWord | undefined;
};

/** What a vocabulary question is ABOUT, as opposed to what it asks. */
export type VocabSubject = {
  word: string;
  definition?: string;
  partOfSpeech?: string;
};

/**
 * The word behind a vocab question, from the ledger where it still exists and
 * from the question itself where it doesn't.
 *
 * Exported because the copy buttons need exactly this: one of them copies this
 * summary, and one copies nothing but `word`.
 */
export function vocabSubjectOf(question: Question, word?: VocabWord): VocabSubject | undefined {
  if (!isVocabQuestion(question)) return undefined;

  // `noteTitle` is the word and `excerpt` the definition — see
  // `generateVocabQuestions`, which writes both onto every vocab question so it
  // reads on its own after the word row is gone.
  const text = (word?.word ?? question.provenance.noteTitle ?? '').trim();
  if (!text) return undefined;

  const definition = (word?.definition ?? question.provenance.excerpt ?? '').trim();
  const partOfSpeech = word?.partOfSpeech?.trim();
  return {
    word: text,
    ...(definition ? { definition } : {}),
    ...(partOfSpeech ? { partOfSpeech } : {}),
  };
}

const OPENING: Record<Outcome, string> = {
  correct: "I got this quiz question right, and I'd like to understand it more deeply.",
  partial: "I got this quiz question partly right, and I'd like to understand it properly.",
  incorrect: "I got this quiz question wrong, and I'd like to understand it properly.",
};

/**
 * The vocabulary openings and closings.
 *
 * A separate pair rather than the general ones, because what you want from a
 * chat about a word is not what you want from a chat about a fact. "Explain the
 * correct answer" is the wrong ask when the answer is a definition: knowing a
 * word means using it, so the closing asks for real sentences, for the
 * near-synonyms it gets confused with, and for practice — the same view of what
 * knowing a word means that `vocabPrompt.ts` writes the questions from.
 */
const VOCAB_OPENING: Record<Outcome, (word: string) => string> = {
  correct: (word) => `I got a vocabulary question about "${word}" right, and I'd like to know the word better.`,
  partial: (word) => `I got a vocabulary question about "${word}" partly right, and I'd like to learn it properly.`,
  incorrect: (word) => `I got a vocabulary question about "${word}" wrong, and I'd like to learn it properly.`,
};

const VOCAB_CLOSING = (word: string) =>
  `Please tell me what "${word}" really means and how it is actually used — its register, what sorts of things it is said about, and a couple of natural example sentences. Then tell me which near-synonyms it gets confused with and how it differs from them, and give me two or three sentences to try using it in.`;

const VERDICT: Record<Outcome, string> = {
  correct: 'Correct',
  partial: 'Partly right',
  incorrect: 'Incorrect',
};

const CLOSING: Record<Outcome, string> = {
  correct:
    'Please check whether my reasoning actually holds up, add any nuance I might be missing, then ask me a couple of harder follow-up questions on this material.',
  partial:
    'Please explain the full answer, tell me which part I had right and which part I was missing, then ask me a couple of follow-up questions to check I have got it.',
  incorrect:
    'Please explain the correct answer, tell me where my thinking most likely went wrong, then ask me a couple of follow-up questions to check I have got it.',
};

export function buildDiscussionSummary({
  question,
  answer,
  outcome,
  word,
}: DiscussionSummaryInput): string {
  const transcript = transcribeAnswer(question, answer ?? null);
  const logic = getQuestionLogic(question.format);
  const subject = vocabSubjectOf(question, word);

  /*
    The model's remark about THIS answer, when a written answer was marked by
    one. Distinct from the explanation and worth carrying: it is the only line
    in the whole summary that speaks about what the reader actually wrote.
  */
  const judgeReason = answer?.format === 'short-answer' ? answer.judged?.reason : undefined;

  const sections: (string | undefined)[] = [
    subject
      ? VOCAB_OPENING[outcome ?? 'incorrect'](subject.word)
      : outcome
        ? OPENING[outcome]
        : 'I just answered this quiz question.',

    /*
      The word first, above the question that tested it.

      A vocabulary question is about the word, not about the sentence it happened
      to be asked in — and the reader is going to talk about the word for a
      while after the question that prompted it has stopped mattering.
    */
    subject ? section('The word', [wordLine(subject)]) : undefined,

    section('Question', [`(${logic.label} · ${question.difficulty})`, question.prompt, transcript.detail]),

    // "I did not answer" rather than a blank: silence in a pasted block reads
    // as something that got lost on the way, not as giving up.
    section('My answer', [transcript.given ?? '_(I did not answer — I asked to see the answer.)_']),
    section('Correct answer', [transcript.expected]),
    section('Result', [outcome ? VERDICT[outcome] : 'Not graded']),

    section('Why', [judgeReason, question.explanation]),

    // Both suppressed for a word: its "note" is the definition already printed
    // above, and its only topic is the constant every vocab question carries.
    subject ? undefined : noteSection(question),
    subject || question.topics.length === 0 ? undefined : `Topics: ${question.topics.join(', ')}`,

    '---',
    subject ? VOCAB_CLOSING(subject.word) : CLOSING[outcome ?? 'incorrect'],
  ];

  return sections.filter(Boolean).join('\n\n');
}

/** "laconic (adjective) — using very few words." */
function wordLine({ word, partOfSpeech, definition }: VocabSubject): string {
  const head = partOfSpeech ? `${word} (${partOfSpeech})` : word;
  return definition ? `${head} — ${definition}` : head;
}

/** A `**Heading**` and its body, or nothing at all when the body is empty. */
function section(heading: string, parts: (string | undefined)[]): string | undefined {
  const body = parts.filter((part) => part && part.trim()).join('\n\n');
  return body ? `**${heading}**\n${body}` : undefined;
}

/**
 * The passage the question was written from, quoted.
 *
 * `quote` first: it is the passage the generator says it used, where `excerpt`
 * is only the opening of the note and may be about something else entirely.
 */
function noteSection(question: Question): string | undefined {
  const { noteTitle, section: heading, quote, excerpt } = question.provenance;
  const passage = (quote ?? excerpt ?? '').trim();
  if (!passage) return undefined;

  const caption = [noteTitle, heading].filter(Boolean).join(' › ');
  const clipped = passage.length > MAX_CONTEXT_CHARS
    ? `${passage.slice(0, MAX_CONTEXT_CHARS).trimEnd()}…`
    : passage;
  // Blockquoted line by line, so the reader's own notes stay visibly theirs
  // rather than blurring into the app's copy around them.
  const body = clipped.split('\n').map((line) => `> ${line}`.trimEnd()).join('\n');

  return section(caption ? `From my notes — ${caption}` : 'From my notes', [body]);
}
