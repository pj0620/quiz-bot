import type {
  FillBlankQuestion,
  ListRecallQuestion,
  MultipleChoiceQuestion,
  QuestionBase,
  ShortAnswerQuestion,
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
  });
});
