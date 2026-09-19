import type { ShortAnswerQuestion } from '../types';
import { judgeShortAnswerLocally, shortAnswerAnswer, shortAnswerLogic } from './shortAnswer';

function question(extra: Partial<ShortAnswerQuestion> = {}): ShortAnswerQuestion {
  return {
    id: 'q1',
    prompt: 'What animal is on the flag?',
    explanation: 'Because.',
    topics: [],
  difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1', path: 'a.md' },
    addedAt: 0,
    format: 'short-answer',
    modelAnswer: 'Bull',
    ...extra,
  } as ShortAnswerQuestion;
}

describe('judgeShortAnswerLocally', () => {
  it('marks a case-insensitive hit on the model answer correct, with a reason', () => {
    expect(judgeShortAnswerLocally(question(), 'bull')).toEqual({
      outcome: 'correct',
      reason: 'That matches the answer.',
    });
  });

  it('forgives a spelling slip and says so', () => {
    expect(judgeShortAnswerLocally(question({ modelAnswer: 'Kentucky' }), 'Kentuky')).toEqual({
      outcome: 'correct',
      reason: 'That matches the answer, spelling aside.',
    });
  });

  it('forgives reordered words and says so', () => {
    const verdict = judgeShortAnswerLocally(question({ modelAnswer: 'fast automatic system' }), 'automatic fast system');
    expect(verdict).toEqual({ outcome: 'correct', reason: 'That matches the answer, wording aside.' });
  });

  it('checks the acceptable variants as well as the model answer', () => {
    const q = question({ modelAnswer: 'System 1, the fast automatic system.', acceptable: ['System 1', 'S1'] });
    expect(judgeShortAnswerLocally(q, 'system 1')?.outcome).toBe('correct');
    expect(judgeShortAnswerLocally(q, 's1')?.outcome).toBe('correct');
  });

  it('declines rather than marking anything incorrect', () => {
    // A wrong answer and a paraphrase look the same from here. Null hands the
    // answer on to the model, or to the reader — it is never a verdict.
    expect(judgeShortAnswerLocally(question(), 'cow')).toBeNull();
    expect(judgeShortAnswerLocally(question(), 'not a bull')).toBeNull();
    expect(judgeShortAnswerLocally(question({ modelAnswer: 'System 1' }), 'System 2')).toBeNull();
    expect(judgeShortAnswerLocally(question({ modelAnswer: 'the USSR' }), 'Soviet Union')).toBeNull();
    expect(judgeShortAnswerLocally(question(), '')).toBeNull();
  });

  it('produces a verdict the grader treats like the model’s', () => {
    const judged = judgeShortAnswerLocally(question(), 'BULL!');
    const grade = shortAnswerLogic.grade(question(), { ...shortAnswerAnswer('BULL!'), judged: judged ?? undefined });
    expect(grade).toEqual({ status: 'graded', outcome: 'correct', score: 1 });
  });

  it('is outranked by the reader’s own verdict', () => {
    const judged = judgeShortAnswerLocally(question(), 'bull');
    const grade = shortAnswerLogic.grade(question(), {
      ...shortAnswerAnswer('bull', 'missed'),
      judged: judged ?? undefined,
    });
    expect(grade).toEqual({ status: 'graded', outcome: 'incorrect', score: 0 });
  });
});
