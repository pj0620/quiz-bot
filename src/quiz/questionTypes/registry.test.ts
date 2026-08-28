import type {
  FillBlankQuestion,
  ListRecallQuestion,
  MultipleChoiceQuestion,
  QuestionBase,
  ShortAnswerQuestion,
  TimelineQuestion,
  TrueFalseQuestion,
} from '../types';
import { isGraded } from '../types';
import {
  gradeAnswer,
  getQuestionLogic,
  isAnswerComplete,
  isKnownFormat,
  isValidQuestion,
  listQuestionFormats,
} from './registry';
import { parseTemplate } from './fillBlank';
import { multipleChoiceAnswer } from './multipleChoice';
import { trueFalseAnswer } from './trueFalse';
import { shortAnswerAnswer } from './shortAnswer';
import { listRecallAnswer } from './listRecall';
import { fillBlankAnswer } from './fillBlank';
import { timelineAnswer } from './timeline';

const base: QuestionBase = {
  id: 'q1',
  prompt: 'Which state did Lincoln keep troops out of early in the war?',
  explanation: 'Kentucky — he did not want to push it towards the Confederacy.',
  topics: ['history-of-america'],
  difficulty: 'core',
  sourceId: 'github-repo:1',
  provenance: {
    sourceId: 'github-repo:1',
    path: 'History/History of America 40 First Year of Fighting.md',
    noteTitle: 'First Year of Fighting',
    section: 'Border States',
  },
  addedAt: 1_700_000_000_000,
};

const mcq: MultipleChoiceQuestion = {
  ...base,
  format: 'multiple-choice',
  choices: [
    { id: 'a', text: 'Kentucky' },
    { id: 'b', text: 'Delaware' },
    { id: 'c', text: 'West Virginia' },
  ],
  correctChoiceId: 'a',
};

const tf: TrueFalseQuestion = { ...base, id: 'q2', format: 'true-false', correct: true };

/** Stored EARLIEST FIRST — the stored order is the answer key. */
const tl: TimelineQuestion = {
  ...base,
  id: 'q6',
  format: 'timeline',
  events: [
    { id: 'e0', label: 'Fort Sumter is shelled', date: 'April 1861' },
    { id: 'e1', label: 'Bull Run', date: 'July 1861' },
    { id: 'e2', label: 'The Emancipation Proclamation', date: '1863' },
    { id: 'e3', label: 'Lee surrenders at Appomattox', date: '1865' },
  ],
};

const sa: ShortAnswerQuestion = {
  ...base,
  id: 'q3',
  format: 'short-answer',
  modelAnswer: 'Kentucky, to avoid pressuring it towards the south.',
};

const lr: ListRecallQuestion = {
  ...base,
  id: 'q4',
  format: 'list-recall',
  prompt: 'Name 3 of the 4 things your notes list under “Northern Advantages”.',
  required: 3,
  items: ['Population', 'Economic Strength', 'Professional Military', 'Presidential Leadership'],
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

describe('registry wiring', () => {
  it('exposes every format exactly once', () => {
    const formats = listQuestionFormats().map((logic) => logic.format);
    expect(new Set(formats).size).toBe(formats.length);
    expect(formats).toEqual(
      expect.arrayContaining(['multiple-choice', 'true-false', 'short-answer', 'list-recall', 'fill-blank']),
    );
  });

  it('gives every format a label and icon for the UI', () => {
    for (const logic of listQuestionFormats()) {
      expect(logic.label.length).toBeGreaterThan(0);
      expect(logic.icon.length).toBeGreaterThan(0);
    }
  });

  it('recognizes known formats and rejects junk', () => {
    expect(isKnownFormat('multiple-choice')).toBe(true);
    expect(isKnownFormat('essay')).toBe(false);
    expect(isKnownFormat(undefined)).toBe(false);
  });
});

describe('multiple choice', () => {
  it('grades by choice id, not position', () => {
    // The player shuffles choices, so index-based grading would be wrong here.
    const shuffled: MultipleChoiceQuestion = { ...mcq, choices: [...mcq.choices].reverse() };
    const grade = gradeAnswer(shuffled, multipleChoiceAnswer('a'));
    expect(isGraded(grade) && grade.outcome).toBe('correct');
  });

  it('marks a wrong choice incorrect', () => {
    const grade = gradeAnswer(mcq, multipleChoiceAnswer('b'));
    expect(isGraded(grade) && grade.outcome).toBe('incorrect');
    expect(isGraded(grade) && grade.score).toBe(0);
  });

  it('is incomplete until a choice is made', () => {
    expect(isAnswerComplete(mcq, null)).toBe(false);
    expect(isAnswerComplete(mcq, multipleChoiceAnswer('a'))).toBe(true);
  });

  describe('validation', () => {
    it('accepts a well-formed question', () => {
      expect(isValidQuestion(mcq)).toBe(true);
    });

    /** The generator bug that produces an unanswerable question. */
    it('rejects a correctChoiceId that is not among the choices', () => {
      expect(isValidQuestion({ ...mcq, correctChoiceId: 'zzz' })).toBe(false);
    });

    it('rejects duplicate choice ids, which make grading ambiguous', () => {
      expect(
        isValidQuestion({
          ...mcq,
          choices: [
            { id: 'a', text: 'One' },
            { id: 'a', text: 'Two' },
          ],
        }),
      ).toBe(false);
    });

    it('enforces the 2..6 choice bounds', () => {
      expect(isValidQuestion({ ...mcq, choices: [{ id: 'a', text: 'Only' }], correctChoiceId: 'a' })).toBe(false);
      const seven = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, text: `Choice ${i}` }));
      expect(isValidQuestion({ ...mcq, choices: seven, correctChoiceId: 'c0' })).toBe(false);
    });

    it('rejects empty choice text', () => {
      expect(
        isValidQuestion({ ...mcq, choices: [{ id: 'a', text: '' }, { id: 'b', text: 'Two' }] }),
      ).toBe(false);
    });
  });
});

describe('true / false', () => {
  it('grades both values', () => {
    expect(isGraded(gradeAnswer(tf, trueFalseAnswer(true))) && true).toBe(true);
    const wrong = gradeAnswer(tf, trueFalseAnswer(false));
    expect(isGraded(wrong) && wrong.outcome).toBe('incorrect');
  });

  /** `false` is a real answer — truthiness checks would call it incomplete. */
  it('treats false as a complete answer', () => {
    expect(isAnswerComplete(tf, trueFalseAnswer(false))).toBe(true);
    expect(isAnswerComplete(tf, null)).toBe(false);
  });

  it('validates the correct flag', () => {
    expect(isValidQuestion(tf)).toBe(true);
    expect(isValidQuestion({ ...tf, correct: 'yes' })).toBe(false);
  });
});

describe('short answer', () => {
  it('asks for self-grading when there is nothing to match against', () => {
    const grade = gradeAnswer(sa, shortAnswerAnswer('something'));
    expect(grade.status).toBe('needs-self-grade');
    expect(grade.status === 'needs-self-grade' && grade.modelAnswer).toBe(sa.modelAnswer);
  });

  it('auto-grades a hit against acceptable answers, ignoring case and punctuation', () => {
    const question: ShortAnswerQuestion = { ...sa, acceptable: ['refresh token'] };
    const grade = gradeAnswer(question, shortAnswerAnswer('  Refresh Token.  '));
    expect(isGraded(grade) && grade.outcome).toBe('correct');
  });

  /**
   * A miss must NOT auto-fail: fuzzy text matching isn't reliable enough to
   * mark someone wrong, so the acceptable list can only ever help.
   */
  it('falls through to self-grading on a miss rather than failing the user', () => {
    const question: ShortAnswerQuestion = { ...sa, acceptable: ['refresh token'] };
    const grade = gradeAnswer(question, shortAnswerAnswer('it renews credentials'));
    expect(grade.status).toBe('needs-self-grade');
  });

  it('honours an explicit self grade', () => {
    for (const [selfGrade, outcome] of [['got-it', 'correct'], ['close', 'partial'], ['missed', 'incorrect']] as const) {
      const grade = gradeAnswer(sa, shortAnswerAnswer('x', selfGrade));
      expect(isGraded(grade) && grade.outcome).toBe(outcome);
    }
  });

  it("honours the model's verdict, so a tolerant match doesn't need self-grading", () => {
    for (const [outcome, score] of [['correct', 1], ['partial', 0.5], ['incorrect', 0]] as const) {
      const grade = gradeAnswer(sa, {
        ...shortAnswerAnswer('sys 1'),
        judged: { outcome, reason: 'why' },
      });
      expect(isGraded(grade) && grade.outcome).toBe(outcome);
      expect(isGraded(grade) && grade.score).toBe(score);
    }
  });

  /**
   * The user outranks the model. It is tolerant but not infallible, and being
   * stuck with a wrong verdict would quietly corrupt the review schedule.
   */
  it('lets an explicit self grade overrule the model', () => {
    const grade = gradeAnswer(sa, {
      ...shortAnswerAnswer('sys 1', 'got-it'),
      judged: { outcome: 'incorrect' },
    });
    expect(isGraded(grade) && grade.outcome).toBe('correct');
  });

  it('still self-grades when no verdict was reached', () => {
    // gradeShortAnswer returns null when offline or unconfigured; the answer
    // then carries no `judged` and must behave exactly as it always did.
    const grade = gradeAnswer(sa, { ...shortAnswerAnswer('sys 1'), judged: undefined });
    expect(grade.status).toBe('needs-self-grade');
  });

  it('treats whitespace-only text as incomplete', () => {
    expect(isAnswerComplete(sa, shortAnswerAnswer('   '))).toBe(false);
    expect(isAnswerComplete(sa, shortAnswerAnswer('a'))).toBe(true);
  });

  it('rejects a malformed rubric or acceptable list', () => {
    expect(isValidQuestion(sa)).toBe(true);
    expect(isValidQuestion({ ...sa, acceptable: 'not-an-array' })).toBe(false);
    expect(isValidQuestion({ ...sa, rubric: [1, 2] })).toBe(false);
  });
});

describe('list recall', () => {
  it('awards full credit for the required number, not the whole list', () => {
    const grade = gradeAnswer(
      lr,
      listRecallAnswer(['Population', 'Economic Strength', 'Professional Military']),
    );
    expect(isGraded(grade) && grade.outcome).toBe('correct');
    expect(isGraded(grade) && grade.score).toBe(1);
  });

  it('scores partial recall proportionally', () => {
    const grade = gradeAnswer(lr, listRecallAnswer(['Population', 'nonsense', '']));
    expect(isGraded(grade) && grade.outcome).toBe('partial');
    expect(isGraded(grade) && grade.score).toBeCloseTo(1 / 3);
  });

  it('reports which items were found so the reveal can mark them', () => {
    const grade = gradeAnswer(lr, listRecallAnswer(['Presidential Leadership']));
    expect(isGraded(grade) && grade.parts).toEqual({ '3': true });
  });

  it('will not let one item be claimed twice', () => {
    // Otherwise typing the same answer three times scores full marks.
    const grade = gradeAnswer(lr, listRecallAnswer(['Population', 'Population', 'population']));
    expect(isGraded(grade) && grade.score).toBeCloseTo(1 / 3);
  });

  it('accepts a near miss in either direction', () => {
    const grade = gradeAnswer(
      lr,
      listRecallAnswer(['the population ratio', 'Economic', 'Professional Military']),
    );
    expect(isGraded(grade) && grade.outcome).toBe('correct');
  });

  it('does not match on a fragment too short to mean anything', () => {
    const grade = gradeAnswer(lr, listRecallAnswer(['Pop']));
    expect(isGraded(grade) && grade.score).toBe(0);
  });

  it('counts items the model matched that string matching could not', () => {
    // "the number of people" names Population only to something that reads
    // meaning; the judge's matches make up what the matcher missed.
    const grade = gradeAnswer(
      lr,
      listRecallAnswer(['the number of people', 'Economic Strength', 'Professional Military'], {
        matchedItems: [0],
      }),
    );
    expect(isGraded(grade) && grade.outcome).toBe('correct');
    expect(isGraded(grade) && grade.parts).toEqual({ '0': true, '1': true, '2': true });
  });

  it('never lets the judge take away a literal match', () => {
    // The model can only add matches. An entry that literally matches the note
    // stays claimed even when the verdict omits it.
    const grade = gradeAnswer(lr, listRecallAnswer(['Population'], { matchedItems: [] }));
    expect(isGraded(grade) && grade.parts).toEqual({ '0': true });
  });

  it('ignores out-of-range indexes in a judgement', () => {
    const grade = gradeAnswer(lr, listRecallAnswer(['nonsense'], { matchedItems: [-1, 4, 99] }));
    expect(isGraded(grade) && grade.score).toBe(0);
  });

  it('lets a partial answer be submitted', () => {
    expect(isAnswerComplete(lr, listRecallAnswer(['', '', '']))).toBe(false);
    expect(isAnswerComplete(lr, listRecallAnswer(['Population', '', '']))).toBe(true);
  });

  it('rejects a question asking for more than it lists', () => {
    expect(isValidQuestion(lr)).toBe(true);
    expect(isValidQuestion({ ...lr, required: 9 })).toBe(false);
    expect(isValidQuestion({ ...lr, required: 0 })).toBe(false);
    expect(isValidQuestion({ ...lr, items: ['only one'] })).toBe(false);
  });
});

describe('fill in the blank', () => {
  it('splits a template into text and blank runs', () => {
    expect(parseTemplate('The {{a}} flow.')).toEqual([
      { kind: 'text', text: 'The ' },
      { kind: 'blank', blankId: 'a' },
      { kind: 'text', text: ' flow.' },
    ]);
  });

  it('handles adjacent and leading blanks', () => {
    expect(parseTemplate('{{a}}{{b}}')).toEqual([
      { kind: 'blank', blankId: 'a' },
      { kind: 'blank', blankId: 'b' },
    ]);
  });

  it('is not affected by a shared regex lastIndex across calls', () => {
    const first = parseTemplate('{{a}} x');
    const second = parseTemplate('{{a}} x');
    expect(first).toEqual(second);
  });

  it('awards full credit when every blank is right', () => {
    const grade = gradeAnswer(fb, fillBlankAnswer({ a: '5:2', b: 'south' }));
    expect(isGraded(grade) && grade.outcome).toBe('correct');
    expect(isGraded(grade) && grade.score).toBe(1);
  });

  it('awards partial credit and reports per-blank correctness', () => {
    const grade = gradeAnswer(fb, fillBlankAnswer({ a: '5:2', b: 'wrong' }));
    expect(isGraded(grade) && grade.outcome).toBe('partial');
    expect(isGraded(grade) && grade.score).toBe(0.5);
    expect(isGraded(grade) && grade.parts).toEqual({ a: true, b: false });
  });

  it('marks all-wrong incorrect', () => {
    const grade = gradeAnswer(fb, fillBlankAnswer({ a: 'x', b: 'y' }));
    expect(isGraded(grade) && grade.outcome).toBe('incorrect');
  });

  it('respects caseSensitive when set', () => {
    const strict: FillBlankQuestion = {
      ...fb,
      blanks: [fb.blanks[0], { id: 'b', accepted: ['South'], caseSensitive: true }],
    };
    const wrongCase = gradeAnswer(strict, fillBlankAnswer({ a: '5:2', b: 'south' }));
    expect(isGraded(wrongCase) && wrongCase.parts?.b).toBe(false);
  });

  it('requires every blank filled before checking', () => {
    expect(isAnswerComplete(fb, fillBlankAnswer({ a: '5:2', b: '' }))).toBe(false);
    expect(isAnswerComplete(fb, fillBlankAnswer({ a: '5:2', b: 'south' }))).toBe(true);
  });

  /*
    The untouched blank has no KEY at all, not an empty one — the view only
    writes a value once it has been typed into. Counting the keys present in
    the answer therefore said "complete" when half the question was blank.
  */
  it('counts a blank never typed into as unfilled, not as absent', () => {
    expect(isAnswerComplete(fb, fillBlankAnswer({ a: '5:2' }))).toBe(false);
    expect(isAnswerComplete(fb, fillBlankAnswer({}))).toBe(false);
  });

  it('rejects a template whose placeholders do not match its blanks', () => {
    expect(isValidQuestion(fb)).toBe(true);
    // Placeholder with no blank definition — renderer would draw an ungradeable input.
    expect(isValidQuestion({ ...fb, template: 'The {{a}} and {{missing}}.' })).toBe(false);
    // Blank with no placeholder — user never sees it.
    expect(
      isValidQuestion({ ...fb, blanks: [...fb.blanks, { id: 'c', accepted: ['x'] }] }),
    ).toBe(false);
  });

  it('rejects blanks with no accepted answers', () => {
    expect(isValidQuestion({ ...fb, blanks: [{ id: 'a', accepted: [] }, fb.blanks[1]] })).toBe(false);
  });
});

describe('isValidQuestion — storage safety', () => {
  it('drops rows with an unknown format instead of throwing', () => {
    expect(isValidQuestion({ ...base, format: 'essay' })).toBe(false);
    expect(isValidQuestion(null)).toBe(false);
    expect(isValidQuestion('nope')).toBe(false);
    expect(isValidQuestion({})).toBe(false);
  });

  it('enforces the shared base fields', () => {
    expect(isValidQuestion({ ...mcq, id: '' })).toBe(false);
    expect(isValidQuestion({ ...mcq, prompt: '' })).toBe(false);
    expect(isValidQuestion({ ...mcq, topics: 'auth' })).toBe(false);
    expect(isValidQuestion({ ...mcq, addedAt: 'yesterday' })).toBe(false);
    expect(isValidQuestion({ ...mcq, provenance: undefined })).toBe(false);
  });
});

describe('summarize', () => {
  it('describes each format for list rows', () => {
    expect(getQuestionLogic('multiple-choice').summarize(mcq)).toBe('3 choices');
    expect(getQuestionLogic('fill-blank').summarize(fb)).toBe('2 blanks');
    expect(getQuestionLogic('true-false').summarize(tf)).toBe('True or false');
    expect(getQuestionLogic('list-recall').summarize(lr)).toBe('Name 3 of 4');
    expect(getQuestionLogic('timeline').summarize(tl)).toBe('Order 4 events');
  });
});

describe('timeline', () => {
  const correctOrder = ['e0', 'e1', 'e2', 'e3'];

  it('awards full credit for the whole sequence and marks every event', () => {
    const grade = gradeAnswer(tl, timelineAnswer(correctOrder));
    if (!isGraded(grade)) throw new Error('expected a graded result');

    expect(grade.outcome).toBe('correct');
    expect(grade.score).toBe(1);
    expect(grade.parts).toEqual({ e0: true, e1: true, e2: true, e3: true });
  });

  it('gives partial credit for the events that landed in the right slot', () => {
    // The two middle events swapped: the outer two are still where they belong.
    const grade = gradeAnswer(tl, timelineAnswer(['e0', 'e2', 'e1', 'e3']));
    if (!isGraded(grade)) throw new Error('expected a graded result');

    expect(grade.outcome).toBe('partial');
    expect(grade.score).toBe(0.5);
    expect(grade.parts).toEqual({ e0: true, e3: true });
  });

  /*
    Pins the grading rule, so changing it is a deliberate act rather than a
    side effect.

    This answer has every RELATION right and is simply rotated — a reader who
    produced it understands the sequence and misplaced one event. Position-by-
    position scoring gives it zero, which sends the card to the lapse interval.
    Scoring the longest correctly-ordered run instead would give it 0.75. The
    trade was chosen knowingly; this test is where to change it.
  */
  it('scores an answer shifted by one at zero, because only exact slots count', () => {
    const grade = gradeAnswer(tl, timelineAnswer(['e3', 'e0', 'e1', 'e2']));
    if (!isGraded(grade)) throw new Error('expected a graded result');

    expect(grade.score).toBe(0);
    expect(grade.outcome).toBe('incorrect');
    expect(grade.parts).toEqual({});
  });

  it('treats a completely backwards answer as incorrect', () => {
    const grade = gradeAnswer(tl, timelineAnswer(['e3', 'e2', 'e1', 'e0']));
    if (!isGraded(grade)) throw new Error('expected a graded result');
    expect(grade.outcome).toBe('incorrect');
  });

  it('ignores an event id it no longer recognises, from an answer stored before an edit', () => {
    // Event ids are positional, so revising a question mid-session can leave an
    // in-flight answer pointing at events that no longer line up.
    const grade = gradeAnswer(tl, timelineAnswer(['e0', 'gone', 'e2', 'e3']));
    if (!isGraded(grade)) throw new Error('expected a graded result');
    expect(grade.parts).toEqual({ e0: true, e2: true, e3: true });
  });

  it('will not count the same event twice', () => {
    const grade = gradeAnswer(tl, timelineAnswer(['e0', 'e0', 'e0', 'e0']));
    if (!isGraded(grade)) throw new Error('expected a graded result');
    expect(grade.parts).toEqual({ e0: true });
    expect(grade.score).toBe(0.25);
  });

  it('is not complete until every event has been placed', () => {
    expect(isAnswerComplete(tl, null)).toBe(false);
    expect(isAnswerComplete(tl, timelineAnswer(['e0', 'e1']))).toBe(false);
    expect(isAnswerComplete(tl, timelineAnswer(correctOrder))).toBe(true);
  });

  describe('validation', () => {
    it('accepts a well-formed timeline', () => {
      expect(isValidQuestion(tl)).toBe(true);
    });

    it('rejects two events, which is a true/false in disguise', () => {
      expect(isValidQuestion({ ...tl, events: tl.events.slice(0, 2) })).toBe(false);
    });

    it('rejects more events than anyone wants to drag around', () => {
      const many = Array.from({ length: 7 }, (_, index) => ({
        id: `e${index}`,
        label: `Event ${index}`,
        date: String(1860 + index),
      }));
      expect(isValidQuestion({ ...tl, events: many })).toBe(false);
    });

    it('rejects duplicate event ids, which make grading ambiguous', () => {
      const events = [...tl.events.slice(0, 3), { ...tl.events[3], id: 'e0' }];
      expect(isValidQuestion({ ...tl, events })).toBe(false);
    });

    /*
      One of the two slots would be unwinnable however the reader answered,
      because nothing on screen distinguishes the events.
    */
    it('rejects two events that read the same, which nobody could order', () => {
      const events = [...tl.events.slice(0, 3), { ...tl.events[3], label: 'Bull Run.' }];
      expect(isValidQuestion({ ...tl, events })).toBe(false);
    });

    it('rejects an event with no date, since the reveal exists to show them', () => {
      const events = [...tl.events.slice(0, 3), { ...tl.events[3], date: '  ' }];
      expect(isValidQuestion({ ...tl, events })).toBe(false);
    });

    it('accepts two events in the same year, told apart by their month', () => {
      // "April 1861" and "July 1861" are two distinct slots on the rail, which
      // is a perfectly good question.
      expect(isValidQuestion(tl)).toBe(true);
    });

    /*
      The dates are the fixed slots the reader drags onto, so a repeated date
      draws two identical rows — and one of them cannot be got right however
      they answer.
    */
    it('rejects two events sharing a date, which would draw an unwinnable slot', () => {
      const events = [...tl.events.slice(0, 3), { ...tl.events[3], date: '1863' }];
      expect(isValidQuestion({ ...tl, events })).toBe(false);
    });
  });
});
