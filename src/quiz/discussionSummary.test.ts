import { buildDiscussionSummary, vocabSubjectOf } from './discussionSummary';
import { transcribeAnswer } from './questionTypes/registry';
import { VOCAB_SOURCE_ID, VOCAB_TOPIC, vocabPath, type VocabWord } from './vocab/types';
import type {
  FillBlankQuestion,
  ListRecallQuestion,
  MultipleChoiceQuestion,
  QuestionBase,
  ShortAnswerQuestion,
  TimelineQuestion,
  TrueFalseQuestion,
} from './types';

const base: QuestionBase = {
  id: 'q1',
  prompt: 'Which state did Lincoln keep troops out of early in the war?',
  explanation: 'Kentucky — he did not want to push it towards the Confederacy.',
  topics: ['history-of-america'],
  difficulty: 'core',
  sourceId: 'github-repo:1',
  provenance: {
    sourceId: 'github-repo:1',
    path: 'History/First Year of Fighting.md',
    noteTitle: 'First Year of Fighting',
    section: 'Border States',
    quote: 'Lincoln kept troops out of Kentucky\nfor as long as he could.',
  },
  addedAt: 1_700_000_000_000,
};

const mcq: MultipleChoiceQuestion = {
  ...base,
  format: 'multiple-choice',
  choices: [
    { id: 'a', text: 'Kentucky' },
    { id: 'b', text: 'Delaware' },
  ],
  correctChoiceId: 'a',
};

const tf: TrueFalseQuestion = { ...base, id: 'q2', format: 'true-false', correct: true };

const sa: ShortAnswerQuestion = {
  ...base,
  id: 'q3',
  format: 'short-answer',
  modelAnswer: 'Kentucky, to avoid pushing it south.',
  rubric: ['Names Kentucky', 'Says why'],
};

const lr: ListRecallQuestion = {
  ...base,
  id: 'q4',
  format: 'list-recall',
  required: 2,
  items: ['Population', 'Economic Strength', 'Professional Military'],
};

const fb: FillBlankQuestion = {
  ...base,
  id: 'q5',
  format: 'fill-blank',
  template: 'Population — {{a}} ratio of people in north to {{b}}.',
  blanks: [
    { id: 'a', accepted: ['5:2'] },
    { id: 'b', accepted: ['south', 'the south'] },
  ],
};

const tl: TimelineQuestion = {
  ...base,
  id: 'q6',
  format: 'timeline',
  events: [
    { id: 'e0', label: 'Fort Sumter is shelled', date: 'April 1861' },
    { id: 'e1', label: 'Bull Run', date: 'July 1861' },
    { id: 'e2', label: 'Lee surrenders', date: '1865' },
  ],
};

describe('transcribe', () => {
  it('names the choice the reader picked and the one that was right', () => {
    const transcript = transcribeAnswer(mcq, { format: 'multiple-choice', choiceId: 'b' });
    expect(transcript.given).toBe('Delaware');
    expect(transcript.expected).toBe('Kentucky');
    expect(transcript.detail).toBe('Options:\n- Kentucky\n- Delaware');
  });

  /** `false` is an answer. Truthiness here would report it as "did not answer". */
  it('treats a false true/false answer as an answer', () => {
    expect(transcribeAnswer(tf, { format: 'true-false', value: false }).given).toBe('False');
    expect(transcribeAnswer(tf, null).given).toBeUndefined();
  });

  it('carries the rubric, which is what the answer was marked against', () => {
    const transcript = transcribeAnswer(sa, { format: 'short-answer', text: '  Kentucky  ' });
    expect(transcript.given).toBe('Kentucky');
    expect(transcript.detail).toBe('A good answer covers:\n- Names Kentucky\n- Says why');
  });

  it('states the whole list and the bar that had to be cleared', () => {
    const transcript = transcribeAnswer(lr, { format: 'list-recall', entries: ['Population', ' ', ''] });
    expect(transcript.given).toBe('- Population');
    expect(transcript.expected).toBe(
      'Any 2 of:\n- Population\n- Economic Strength\n- Professional Military',
    );
  });

  /* Blanks have ids, not names, so a list of values is unreadable off-screen. */
  it('fills the whole sentence in for both sides of a fill-blank', () => {
    const transcript = transcribeAnswer(fb, { format: 'fill-blank', values: { a: '5:2', b: 'north' } });
    expect(transcript.given).toBe('Population — 5:2 ratio of people in north to north.');
    expect(transcript.expected).toBe('Population — 5:2 ratio of people in north to south.');
  });

  it('marks blanks that were never filled rather than closing the gap silently', () => {
    const transcript = transcribeAnswer(fb, { format: 'fill-blank', values: { a: '5:2' } });
    expect(transcript.given).toBe('Population — 5:2 ratio of people in north to ____.');
  });

  it('reports no answer when every blank is empty', () => {
    expect(transcribeAnswer(fb, { format: 'fill-blank', values: { a: '  ' } }).given).toBeUndefined();
  });

  it('gives the timeline order back as labels, with the dates only on the answer key', () => {
    const transcript = transcribeAnswer(tl, { format: 'timeline', order: ['e1', 'e0', 'e2'] });
    expect(transcript.given).toBe('1. Bull Run\n2. Fort Sumter is shelled\n3. Lee surrenders');
    expect(transcript.expected).toBe(
      '1. Fort Sumter is shelled — April 1861\n2. Bull Run — July 1861\n3. Lee surrenders — 1865',
    );
  });

  /** An answer stored before the question was edited can name events that are gone. */
  it('drops timeline ids it no longer recognises instead of printing them raw', () => {
    const transcript = transcribeAnswer(tl, { format: 'timeline', order: ['e0', 'gone'] });
    expect(transcript.given).toBe('1. Fort Sumter is shelled');
  });

  /** The pair can't be trusted, and every transcribe reads its own answer shape. */
  it('ignores an answer belonging to a different format', () => {
    expect(transcribeAnswer(mcq, { format: 'true-false', value: true }).given).toBeUndefined();
  });
});

describe('buildDiscussionSummary', () => {
  const summary = buildDiscussionSummary({
    question: mcq,
    answer: { format: 'multiple-choice', choiceId: 'b' },
    outcome: 'incorrect',
  });

  it('states the question, the answer, the right answer and the verdict', () => {
    expect(summary).toContain(mcq.prompt);
    expect(summary).toContain('**My answer**\nDelaware');
    expect(summary).toContain('**Correct answer**\nKentucky');
    expect(summary).toContain('**Result**\nIncorrect');
  });

  it('carries the stored explanation, so no model call is needed to build it', () => {
    expect(summary).toContain(mcq.explanation);
  });

  it('quotes the passage the question came from, captioned with the note', () => {
    expect(summary).toContain('**From my notes — First Year of Fighting › Border States**');
    // Every line of the passage, not just the first — a blockquote that stops
    // after one line reads as the app's own prose from there on.
    expect(summary).toContain('> Lincoln kept troops out of Kentucky\n> for as long as he could.');
  });

  it('opens and closes with an instruction, so it can be pasted straight into a chat', () => {
    expect(summary.startsWith('I got this quiz question wrong')).toBe(true);
    expect(summary.trimEnd().endsWith('check I have got it.')).toBe(true);
  });

  it('asks to be checked rather than taught when the answer was right', () => {
    const right = buildDiscussionSummary({
      question: mcq,
      answer: { format: 'multiple-choice', choiceId: 'a' },
      outcome: 'correct',
    });
    expect(right.startsWith('I got this quiz question right')).toBe(true);
    expect(right).toContain('**Result**\nCorrect');
  });

  /*
    Giving up produces a graded item with no answer on it. A blank here would
    read as something lost in the paste rather than as a deliberate skip.
  */
  it('says so explicitly when the reader never answered', () => {
    const skipped = buildDiscussionSummary({ question: mcq, outcome: 'incorrect' });
    expect(skipped).toContain('I did not answer');
  });

  it("leads with the model's remark about this answer when there was one", () => {
    const judged = buildDiscussionSummary({
      question: sa,
      answer: {
        format: 'short-answer',
        text: 'Delaware',
        judged: { outcome: 'incorrect', reason: 'You named the wrong border state.' },
      },
      outcome: 'incorrect',
    });
    expect(judged.indexOf('You named the wrong border state.')).toBeLessThan(
      judged.indexOf(sa.explanation),
    );
  });

  it('caps the note passage so the clipboard stays chat-sized', () => {
    const long = 'x'.repeat(4000);
    const summary = buildDiscussionSummary({
      question: { ...mcq, provenance: { ...mcq.provenance, quote: long } },
      outcome: 'incorrect',
    });
    expect(summary).toContain('…');
    expect(summary.length).toBeLessThan(2500);
  });

  it('omits the notes section entirely when nothing was stored', () => {
    const summary = buildDiscussionSummary({
      question: { ...mcq, provenance: { sourceId: 'github-repo:1' } },
      outcome: 'incorrect',
    });
    expect(summary).not.toContain('From my notes');
  });
});

/*
  A vocabulary question is an ordinary question with a reserved sourceId, so
  everything above applies to it. What changes is what it is ABOUT: the word,
  not the sentence it happened to be asked in.
*/
describe('buildDiscussionSummary — vocabulary', () => {
  const vocab: ShortAnswerQuestion = {
    ...base,
    format: 'short-answer',
    id: 'v1',
    prompt: 'What does "laconic" mean?',
    explanation: 'It describes speech, not mood — a laconic reply, not a laconic afternoon.',
    topics: [VOCAB_TOPIC],
    sourceId: VOCAB_SOURCE_ID,
    modelAnswer: 'Using very few words.',
    provenance: {
      sourceId: VOCAB_SOURCE_ID,
      path: vocabPath('laconic'),
      // Written onto every vocab question by `generateVocabQuestions`.
      noteTitle: 'laconic',
      excerpt: 'Using very few words; terse to the point of bluntness.',
    },
  };

  const ledger: VocabWord = {
    slug: 'laconic',
    word: 'laconic',
    definition: 'Using very few words.',
    partOfSpeech: 'adjective',
    addedAt: 0,
    addedBy: 'user',
  };

  it('leads with the word, its part of speech and its meaning', () => {
    const summary = buildDiscussionSummary({ question: vocab, word: ledger, outcome: 'incorrect' });
    expect(summary).toContain('**The word**\nlaconic (adjective) — Using very few words.');
    // Above the question that happened to test it.
    expect(summary.indexOf('**The word**')).toBeLessThan(summary.indexOf('**Question**'));
  });

  it('names the word in the opening and asks about using it in the closing', () => {
    const summary = buildDiscussionSummary({ question: vocab, word: ledger, outcome: 'incorrect' });
    expect(summary.startsWith('I got a vocabulary question about "laconic" wrong')).toBe(true);
    expect(summary).toContain('near-synonyms');
    expect(summary).not.toContain('where my thinking most likely went wrong');
  });

  /** The question carries both — see `generateVocabQuestions`. */
  it('falls back to the question when the word has been removed from the ledger', () => {
    const summary = buildDiscussionSummary({ question: vocab, outcome: 'incorrect' });
    expect(summary).toContain('**The word**\nlaconic — Using very few words; terse to the point of bluntness.');
  });

  /*
    The definition is already printed as the word, and 'vocabulary' is a
    constant every vocab question carries — neither is worth a section.
  */
  it('drops the notes section and the topic line', () => {
    const summary = buildDiscussionSummary({ question: vocab, word: ledger, outcome: 'incorrect' });
    expect(summary).not.toContain('From my notes');
    expect(summary).not.toContain('Topics:');
  });

  it('still reports the answer and the verdict like any other question', () => {
    const summary = buildDiscussionSummary({
      question: vocab,
      answer: { format: 'short-answer', text: 'relaxed', selfGrade: 'missed' },
      word: ledger,
      outcome: 'incorrect',
    });
    expect(summary).toContain('**My answer**\nrelaxed');
    expect(summary).toContain('**Correct answer**\nUsing very few words.');
    expect(summary).toContain('**Result**\nIncorrect');
  });

  describe('vocabSubjectOf', () => {
    it('prefers the ledger, which holds the part of speech', () => {
      expect(vocabSubjectOf(vocab, ledger)).toEqual({
        word: 'laconic',
        definition: 'Using very few words.',
        partOfSpeech: 'adjective',
      });
    });

    it('is undefined for a question that is not about a word', () => {
      expect(vocabSubjectOf(mcq, ledger)).toBeUndefined();
    });

    it('is undefined when the word cannot be recovered at all', () => {
      const nameless = { ...vocab, provenance: { sourceId: VOCAB_SOURCE_ID, path: vocabPath('x') } };
      expect(vocabSubjectOf(nameless)).toBeUndefined();
    });
  });
});
