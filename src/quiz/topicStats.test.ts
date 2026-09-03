import { addDays } from '../lib/day';
import {
  applyTopicFilter,
  computeTopicStats,
  emptyTopicFilter,
  summarizeTopics,
  type TopicFilter,
  type TopicSummary,
} from './topicStats';
import type { MultipleChoiceQuestion, Question, ReviewState, Session, SessionItem } from './types';

const NOW = new Date('2026-08-02T12:00:00').getTime();

function question(id: string, topics: string[], extra: Partial<Question> = {}): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics,
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

/** A first correct answer — 'learning', and due unless `dueAt` says otherwise. */
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

/** A long streak on a long interval — 'solid'. */
function solid(questionId: string, extra: Partial<ReviewState> = {}): ReviewState {
  return review(questionId, { intervalDays: 30, streak: 4, reps: 6, dueAt: addDays(NOW, 20), ...extra });
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

type Input = {
  questions?: Question[];
  reviewStates?: Record<string, ReviewState>;
  sessions?: Session[];
  now?: number;
};

function summarize(input: Input): TopicSummary[] {
  return summarizeTopics({
    questions: input.questions ?? [],
    reviewStates: input.reviewStates ?? {},
    sessions: input.sessions ?? [],
    now: input.now ?? NOW,
  });
}

function find(topics: readonly TopicSummary[], topic: string): TopicSummary {
  const found = topics.find((entry) => entry.topic === topic);
  if (!found) throw new Error(`No summary for ${topic}`);
  return found;
}

describe('summarizeTopics', () => {
  it('lists every topic present, weakest first', () => {
    const result = summarize({
      questions: [question('q1', ['history']), question('q2', ['maths'])],
      reviewStates: { q2: review('q2') },
    });

    expect(result.map((entry) => entry.topic)).toEqual(['history', 'maths']);
    expect(find(result, 'history')).toMatchObject({ mastery: 0, level: 'new', newCount: 1 });
    expect(find(result, 'maths').mastery).toBeGreaterThan(0);
  });

  it('counts a question towards every topic it carries', () => {
    // Topics overlap by design; splitting credit would understate both.
    const result = summarize({ questions: [question('q1', ['priming', 'thinking-fast-and-slow'])] });
    expect(find(result, 'priming').total).toBe(1);
    expect(find(result, 'thinking-fast-and-slow').total).toBe(1);
  });

  it('grades a topic on the answers actually given', () => {
    const result = summarize({
      questions: [question('q1', ['history']), question('q2', ['history'])],
      sessions: [session('s1', [item('q1', 'correct', NOW), item('q2', 'incorrect', NOW)])],
    });

    expect(find(result, 'history')).toMatchObject({
      answered: 2,
      correct: 1,
      score: 0.5,
      grade: 'F',
      lastAnsweredAt: NOW,
    });
  });

  it('leaves an unanswered topic ungraded rather than failing it', () => {
    const result = summarize({ questions: [question('q1', ['history'])] });
    expect(find(result, 'history')).toMatchObject({
      answered: 0,
      score: null,
      grade: null,
      lastAnsweredAt: null,
    });
  });

  it('ignores items that were never answered', () => {
    // An abandoned session must not drag a topic's accuracy down.
    const result = summarize({
      questions: [question('q1', ['history']), question('q2', ['history'])],
      sessions: [session('s1', [item('q1', 'correct', NOW), item('q2', undefined)])],
    });
    expect(find(result, 'history')).toMatchObject({ answered: 1, correct: 1, grade: 'A' });
  });

  it('remembers the most recent answer, whatever order the sessions come in', () => {
    const result = summarize({
      questions: [question('q1', ['history'])],
      sessions: [
        session('s1', [item('q1', 'correct', addDays(NOW, -1))]),
        session('s2', [item('q1', 'correct', addDays(NOW, -3))]),
      ],
    });
    expect(find(result, 'history').lastAnsweredAt).toBe(addDays(NOW, -1));
  });

  it('counts what is due now, leaving out leeches and reported questions', () => {
    const result = summarize({
      questions: [
        question('q1', ['history']),
        question('q2', ['history']),
        question('q3', ['history'], { flagged: { reason: 'wrong', at: NOW } }),
        question('q4', ['history']),
        question('q5', ['history']),
      ],
      reviewStates: {
        q1: review('q1', { dueAt: addDays(NOW, -2) }),
        q2: review('q2', { leech: true }),
        q3: review('q3'),
        q4: review('q4', { dueAt: addDays(NOW, 3) }),
        // q5 has never been answered, so nothing is scheduled for it.
      },
    });
    expect(find(result, 'history').dueNow).toBe(1);
  });

  it('names the topic for display', () => {
    const result = summarize({ questions: [question('q1', ['history-of-america'])] });
    expect(find(result, 'history-of-america').name).toBe('History Of America');
  });

  it('is empty with no questions', () => {
    expect(summarize({})).toEqual([]);
  });
});

describe('applyTopicFilter', () => {
  /*
    Three topics that differ on every axis the screen can sort or filter by:

      algebra    3 questions, none started
      biology    1 question, learning, due now
      chemistry  2 questions, one solid and one new — the strongest overall
  */
  const topics = summarize({
    questions: [
      question('q1', ['algebra']),
      question('q2', ['algebra']),
      question('q3', ['algebra']),
      question('q4', ['biology']),
      question('q5', ['chemistry']),
      question('q6', ['chemistry']),
    ],
    reviewStates: {
      q4: review('q4', { dueAt: addDays(NOW, -1) }),
      q5: solid('q5'),
    },
  });

  function names(filter: Partial<TopicFilter>): string[] {
    return applyTopicFilter(topics, { ...emptyTopicFilter(), ...filter }).map((entry) => entry.topic);
  }

  it('sorts weakest first by default', () => {
    expect(names({})).toEqual(['algebra', 'biology', 'chemistry']);
  });

  it('sorts strongest first', () => {
    expect(names({ sort: 'strongest' })).toEqual(['chemistry', 'biology', 'algebra']);
  });

  it('sorts by size', () => {
    expect(names({ sort: 'most-questions' })).toEqual(['algebra', 'chemistry', 'biology']);
  });

  it('sorts alphabetically', () => {
    expect(names({ sort: 'a-z' })).toEqual(['algebra', 'biology', 'chemistry']);
  });

  it('puts the bigger topic first among equally weak ones', () => {
    // Forty untouched questions are more worth acting on than two.
    const equal = summarize({
      questions: [question('q1', ['small']), question('q2', ['large']), question('q3', ['large'])],
    });
    expect(applyTopicFilter(equal, emptyTopicFilter()).map((entry) => entry.topic)).toEqual([
      'large',
      'small',
    ]);
  });

  it('shows only topics that have been started', () => {
    expect(names({ show: 'studied' })).toEqual(['biology', 'chemistry']);
  });

  it('shows only topics with reviews waiting', () => {
    expect(names({ show: 'due' })).toEqual(['biology']);
  });

  it('searches the display name without caring about case', () => {
    expect(names({ search: 'CHEM' })).toEqual(['chemistry']);
    expect(names({ search: '  bio ' })).toEqual(['biology']);
  });

  it('searches the slug as well as the name', () => {
    const hyphenated = summarize({ questions: [question('q1', ['history-of-america'])] });
    const filter = { ...emptyTopicFilter(), search: 'history-of' };
    expect(applyTopicFilter(hyphenated, filter)).toHaveLength(1);
  });

  it('combines the search with the other filters', () => {
    expect(names({ search: 'i' })).toEqual(['biology', 'chemistry']);
    expect(names({ search: 'i', show: 'due' })).toEqual(['biology']);
  });

  it('does not reorder the caller’s array', () => {
    const before = topics.map((entry) => entry.topic);
    applyTopicFilter(topics, { ...emptyTopicFilter(), sort: 'strongest' });
    expect(topics.map((entry) => entry.topic)).toEqual(before);
  });
});

describe('computeTopicStats', () => {
  function forTopic(topic: string, input: Input) {
    return computeTopicStats({
      questions: input.questions ?? [],
      reviewStates: input.reviewStates ?? {},
      sessions: input.sessions ?? [],
      now: input.now ?? NOW,
      topic,
    });
  }

  it('counts only the topic’s questions and the answers given to them', () => {
    const input: Input = {
      questions: [question('q1', ['history']), question('q2', ['maths'])],
      reviewStates: { q1: review('q1'), q2: review('q2') },
      sessions: [session('s1', [item('q1', 'correct', NOW), item('q2', 'incorrect', NOW)])],
    };

    const history = forTopic('history', input);
    expect(history.bankTotal).toBe(1);
    expect(history.answered).toBe(1);
    expect(history.accuracy).toBe(1);
    expect(history.dueNow).toBe(1);
    expect(history.mastery.reduce((sum, slice) => sum + slice.count, 0)).toBe(1);
    expect(history.reviewedToday).toBe(1);

    const maths = forTopic('maths', input);
    expect(maths.answered).toBe(1);
    expect(maths.accuracy).toBe(0);
  });

  it('keeps a two-topic question in both', () => {
    const input: Input = {
      questions: [question('q1', ['history', 'maths'])],
      sessions: [session('s1', [item('q1', 'correct', NOW)])],
    };
    expect(forTopic('history', input).answered).toBe(1);
    expect(forTopic('maths', input).answered).toBe(1);
  });

  it('scopes the hardest list to the topic', () => {
    const input: Input = {
      questions: [question('q1', ['history']), question('q2', ['maths'])],
      reviewStates: {
        q1: review('q1', { lapses: 1 }),
        q2: review('q2', { lapses: 4 }),
      },
    };
    expect(forTopic('history', input).hardest.map((entry) => entry.questionId)).toEqual(['q1']);
  });

  it('drops sessions that never touched the topic', () => {
    const input: Input = {
      questions: [question('q1', ['history']), question('q2', ['maths'])],
      sessions: [
        session('maths-only', [item('q2', 'correct', NOW)]),
        session('both', [item('q1', 'incorrect', NOW), item('q2', 'correct', NOW)]),
      ],
    };

    const history = forTopic('history', input);
    expect(history.recentSessions.map((entry) => entry.id)).toEqual(['both']);
    // Scored on the topic's own questions: one asked, none right.
    expect(history.recentSessions[0]).toMatchObject({ correct: 0, total: 1 });
  });

  it('is empty for a topic nothing carries', () => {
    const result = forTopic('nothing', {
      questions: [question('q1', ['history'])],
      sessions: [session('s1', [item('q1', 'correct', NOW)])],
    });
    expect(result.bankTotal).toBe(0);
    expect(result.answered).toBe(0);
    expect(result.accuracy).toBeNull();
    expect(result.hardest).toEqual([]);
    expect(result.activity.every((day) => day.reviewed === 0)).toBe(true);
  });
});
