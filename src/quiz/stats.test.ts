import { addDays } from '../lib/day';
import { computeStats, letterGrade, overallMastery } from './stats';
import type { MultipleChoiceQuestion, Question, ReviewState, Session, SessionItem } from './types';

const NOW = new Date('2026-08-02T12:00:00').getTime();

function question(id: string, extra: Partial<Question> = {}): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['history-of-america'],
    difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1', path: 'a.md' },
    addedAt: NOW,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
    ...extra,
  } as MultipleChoiceQuestion;
}

function review(questionId: string, extra: Partial<ReviewState> = {}): ReviewState {
  return {
    questionId,
    ease: 2.5,
    intervalDays: 1,
    dueAt: NOW,
    streak: 1,
    lapses: 0,
    reps: 1,
    lastReviewedAt: NOW,
    lastOutcome: 'correct',
    ...extra,
  };
}

function item(questionId: string, outcome: SessionItem['outcome'], answeredAt?: number): SessionItem {
  return { questionId, outcome, answeredAt, wasNew: false };
}

function session(id: string, items: SessionItem[], extra: Partial<Session> = {}): Session {
  return {
    id,
    quizName: 'Daily quiz',
    status: 'completed',
    startedAt: NOW,
    completedAt: NOW,
    seed: 1,
    items,
    currentIndex: items.length,
    ...extra,
  };
}

function stats(input: {
  questions?: Question[];
  reviewStates?: Record<string, ReviewState>;
  sessions?: Session[];
  now?: number;
}) {
  return computeStats({
    questions: input.questions ?? [],
    reviewStates: input.reviewStates ?? {},
    sessions: input.sessions ?? [],
    now: input.now ?? NOW,
  });
}

describe('accuracy', () => {
  it('counts only answered items', () => {
    /*
      An abandoned session leaves items with no outcome. Counting those as
      wrong would punish someone for stopping, and counting them at all would
      make accuracy drift down every time a quiz is left half-finished.
    */
    const result = stats({
      sessions: [
        session('s1', [
          item('q1', 'correct', NOW),
          item('q2', 'incorrect', NOW),
          item('q3', undefined),
        ]),
      ],
    });

    expect(result.answered).toBe(2);
    expect(result.correct).toBe(1);
    expect(result.accuracy).toBe(0.5);
  });

  it('treats a partial answer as not correct', () => {
    const result = stats({ sessions: [session('s1', [item('q1', 'partial', NOW)])] });
    expect(result.accuracy).toBe(0);
  });

  it('reports null accuracy rather than zero when nothing was answered', () => {
    // 0% and "no data" mean very different things to someone opening the app.
    expect(stats({}).accuracy).toBeNull();
  });
});

describe('day streak', () => {
  function withDays(offsets: number[]) {
    return stats({
      sessions: [
        session(
          's1',
          offsets.map((offset, i) => item(`q${i}`, 'correct', addDays(NOW, offset))),
        ),
      ],
    });
  }

  it('counts consecutive days ending today', () => {
    expect(withDays([0, -1, -2]).dayStreak).toBe(3);
  });

  it('survives a day that has not been studied yet', () => {
    /*
      Ending the streak at midnight would drop it to zero every morning before
      the first review of the day — technically true and useless.
    */
    expect(withDays([-1, -2, -3]).dayStreak).toBe(3);
  });

  it('breaks once a whole day has been missed', () => {
    expect(withDays([-2, -3]).dayStreak).toBe(0);
  });

  it('counts a day once however many questions were answered', () => {
    expect(withDays([0, 0, 0, -1]).dayStreak).toBe(2);
  });

  it('is zero with no history', () => {
    expect(stats({}).dayStreak).toBe(0);
  });
});

describe('activity', () => {
  it('returns one entry per day including empty ones', () => {
    // A chart that silently drops empty days would misrepresent consistency.
    const result = stats({
      sessions: [session('s1', [item('q1', 'correct', addDays(NOW, -3))])],
    });

    expect(result.activity).toHaveLength(14);
    expect(result.activity[result.activity.length - 1].dayOffset).toBe(0);
    expect(result.activity.find((day) => day.dayOffset === -3)?.reviewed).toBe(1);
    expect(result.activity.find((day) => day.dayOffset === -2)?.reviewed).toBe(0);
  });

  it('ignores answers older than the window', () => {
    const result = stats({
      sessions: [session('s1', [item('q1', 'correct', addDays(NOW, -40))])],
    });
    expect(result.activity.every((day) => day.reviewed === 0)).toBe(true);
    // Still counted in the all-time totals, just not plotted.
    expect(result.answered).toBe(1);
  });

  it('reports what was reviewed today', () => {
    const result = stats({
      sessions: [session('s1', [item('q1', 'correct', NOW), item('q2', 'incorrect', NOW)])],
    });
    expect(result.reviewedToday).toBe(2);
  });
});

describe('letter grade', () => {
  it('places each band on its boundary', () => {
    expect(letterGrade(1)).toBe('A');
    expect(letterGrade(0.9)).toBe('A');
    expect(letterGrade(0.89)).toBe('B');
    expect(letterGrade(0.8)).toBe('B');
    expect(letterGrade(0.79)).toBe('C');
    expect(letterGrade(0.7)).toBe('C');
    expect(letterGrade(0.69)).toBe('D');
    expect(letterGrade(0.6)).toBe('D');
    expect(letterGrade(0.59)).toBe('F');
    expect(letterGrade(0)).toBe('F');
  });
});

describe('week scores', () => {
  it('returns one entry per day, oldest first, ending today', () => {
    const result = stats({});

    expect(result.week).toHaveLength(7);
    expect(result.week[0].dayOffset).toBe(-6);
    expect(result.week[6].dayOffset).toBe(0);
  });

  it('scores a day by its share of correct answers', () => {
    const result = stats({
      sessions: [
        session('s1', [
          item('q1', 'correct', NOW),
          item('q2', 'correct', NOW),
          item('q3', 'incorrect', NOW),
          item('q4', 'correct', NOW),
        ]),
      ],
    });

    const today = result.week[6];
    expect(today.answered).toBe(4);
    expect(today.correct).toBe(3);
    expect(today.score).toBeCloseTo(0.75);
    expect(today.grade).toBe('C');
  });

  it('reports a skipped day as null rather than zero', () => {
    // Zero would colour as "got everything wrong", which is a different claim.
    const result = stats({
      sessions: [session('s1', [item('q1', 'correct', NOW)])],
    });

    expect(result.week[6].score).toBe(1);
    expect(result.week[5].score).toBeNull();
    expect(result.week[5].grade).toBeNull();
    expect(result.week[5].answered).toBe(0);
  });

  it('keeps days separate rather than pooling the week', () => {
    const result = stats({
      sessions: [
        session('s1', [item('q1', 'correct', NOW)]),
        session('s2', [item('q2', 'incorrect', addDays(NOW, -2))]),
      ],
    });

    expect(result.week[6].grade).toBe('A');
    expect(result.week[4].grade).toBe('F');
    expect(result.week[5].grade).toBeNull();
  });

  it('ignores answers older than the week', () => {
    const result = stats({
      sessions: [session('s1', [item('q1', 'correct', addDays(NOW, -9))])],
    });

    expect(result.week.every((day) => day.score === null)).toBe(true);
    // Still inside the 14-day activity window, so it is not lost entirely.
    expect(result.activity.some((day) => day.reviewed > 0)).toBe(true);
  });
});

describe('topic scores', () => {
  it('grades a topic on the answers actually given', () => {
    const result = stats({
      questions: [question('q1'), question('q2')],
      sessions: [session('s1', [item('q1', 'correct', NOW), item('q2', 'incorrect', NOW)])],
    });

    const topic = result.topicScores['history-of-america'];
    expect(topic.answered).toBe(2);
    expect(topic.correct).toBe(1);
    expect(topic.grade).toBe('F');
  });

  it('counts an answer towards every topic its question carries', () => {
    const result = stats({
      questions: [question('q1', { topics: ['priming', 'thinking-fast-and-slow'] })],
      sessions: [session('s1', [item('q1', 'correct', NOW)])],
    });

    expect(result.topicScores['priming'].grade).toBe('A');
    expect(result.topicScores['thinking-fast-and-slow'].grade).toBe('A');
  });

  it('has no entry for a topic that has never been answered', () => {
    // Absent, not F. An unseen topic has not been failed.
    const result = stats({ questions: [question('q1')], sessions: [] });
    expect(result.topicScores['history-of-america']).toBeUndefined();
  });
});

describe('due count', () => {
  it('counts overdue questions as due now', () => {
    const result = stats({
      questions: [question('q1')],
      reviewStates: { q1: review('q1', { dueAt: addDays(NOW, -5) }) },
    });

    expect(result.dueNow).toBe(1);
  });

  it('excludes leeches, which selection never shows', () => {
    const result = stats({
      questions: [question('q1')],
      reviewStates: { q1: review('q1', { dueAt: NOW, leech: true }) },
    });
    expect(result.dueNow).toBe(0);
  });

  it('excludes flagged questions from mastery and due alike', () => {
    const result = stats({
      questions: [question('q1', { flagged: { reason: 'wrong', at: NOW } })],
      reviewStates: { q1: review('q1', { dueAt: NOW }) },
    });

    expect(result.dueNow).toBe(0);
    expect(result.mastery.reduce((sum, slice) => sum + slice.count, 0)).toBe(0);
  });
});

describe('mastery', () => {
  it('returns every level, including empty ones', () => {
    // The distribution bar needs all five to keep its legend stable.
    const result = stats({ questions: [question('q1')] });
    expect(result.mastery.map((slice) => slice.level)).toEqual([
      'new',
      'learning',
      'shaky',
      'familiar',
      'solid',
    ]);
    expect(result.mastery.find((slice) => slice.level === 'new')?.count).toBe(1);
  });

  it('scores an all-new bank at zero and an all-solid bank at one', () => {
    expect(overallMastery([{ level: 'new', count: 4 }])).toBe(0);
    expect(overallMastery([{ level: 'solid', count: 4 }])).toBe(1);
    expect(overallMastery([])).toBe(0);
  });
});

describe('recent sessions', () => {
  it('lists completed sessions newest first', () => {
    const result = stats({
      sessions: [
        session('old', [item('q1', 'correct', addDays(NOW, -2))], { completedAt: addDays(NOW, -2) }),
        session('new', [item('q2', 'correct', NOW)], { completedAt: NOW }),
      ],
    });
    expect(result.recentSessions.map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('omits sessions still in progress', () => {
    const result = stats({
      sessions: [session('s1', [item('q1', 'correct', NOW)], { status: 'active' })],
    });
    expect(result.recentSessions).toHaveLength(0);
    // Its answers still count towards the totals — they really were answered.
    expect(result.answered).toBe(1);
  });

  it('omits a completed session where nothing was answered', () => {
    const result = stats({ sessions: [session('s1', [item('q1', undefined)])] });
    expect(result.recentSessions).toHaveLength(0);
  });
});

describe('hardest questions', () => {
  it('ranks by lapses and resolves the prompt', () => {
    const result = stats({
      questions: [question('q1'), question('q2')],
      reviewStates: {
        q1: review('q1', { lapses: 1 }),
        q2: review('q2', { lapses: 4, leech: true }),
      },
    });

    expect(result.hardest[0]).toMatchObject({ questionId: 'q2', lapses: 4, leech: true });
    expect(result.hardest[0].prompt).toBe('Prompt q2');
    expect(result.hardest).toHaveLength(2);
  });

  it('ignores questions that have never lapsed', () => {
    const result = stats({
      questions: [question('q1')],
      reviewStates: { q1: review('q1', { lapses: 0 }) },
    });
    expect(result.hardest).toHaveLength(0);
  });

  it('drops review states whose question has been deleted', () => {
    // Clearing the bank leaves nothing behind, but a stale state must not
    // render as a row with an empty prompt.
    const result = stats({
      questions: [],
      reviewStates: { gone: review('gone', { lapses: 3 }) },
    });
    expect(result.hardest).toHaveLength(0);
  });
});
