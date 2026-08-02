process.env.TZ = 'America/New_York';

import type { MultipleChoiceQuestion, Question, ReviewState } from '../types';
import { bankSummary, isAtOrBelowMastery, masteryOf, topicMastery } from './mastery';
import { recordReview } from './schedule';

const NOW = new Date(2026, 4, 10, 12).getTime();

function question(id: string, topics: string[]): MultipleChoiceQuestion {
  return {
    id,
    format: 'multiple-choice',
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics,
    difficulty: 'core',
    sourceId: 'src-1',
    provenance: { sourceId: 'src-1' },
    addedAt: NOW,
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctChoiceId: 'a',
  };
}

/** Builds a state by replaying `outcomes` in order. */
function stateFrom(id: string, outcomes: Parameters<typeof recordReview>[2][]): ReviewState {
  let state: ReviewState | undefined;
  for (const outcome of outcomes) state = recordReview(state, id, outcome, NOW);
  return state as ReviewState;
}

describe('masteryOf', () => {
  it('reports an unanswered question as new', () => {
    expect(masteryOf(undefined)).toBe('new');
  });

  it('reports a first correct answer as learning', () => {
    expect(masteryOf(stateFrom('q1', ['correct']))).toBe('learning');
  });

  it('climbs to familiar then solid with a sustained streak', () => {
    const familiar = stateFrom('q1', ['correct', 'correct', 'correct']);
    expect(['familiar', 'solid']).toContain(masteryOf(familiar));

    const solid = stateFrom('q1', Array(6).fill('correct'));
    expect(masteryOf(solid)).toBe('solid');
  });

  /** Recent failure outranks accumulated progress — the point of 'shaky'. */
  it('drops a long-interval question to shaky the moment it is missed', () => {
    const solid = stateFrom('q1', Array(6).fill('correct'));
    expect(masteryOf(solid)).toBe('solid');

    const missed = recordReview(solid, 'q1', 'incorrect', NOW);
    expect(masteryOf(missed)).toBe('shaky');
  });

  it('keeps a repeatedly-lapsed question shaky even after one correct answer', () => {
    const struggled = stateFrom('q1', ['incorrect', 'incorrect', 'correct']);
    expect(masteryOf(struggled)).toBe('shaky');
  });

  it('reports a leech as shaky', () => {
    const leech = stateFrom('q1', Array(6).fill('incorrect'));
    expect(leech.leech).toBe(true);
    expect(masteryOf(leech)).toBe('shaky');
  });
});

describe('isAtOrBelowMastery', () => {
  it('includes everything at or under the ceiling', () => {
    expect(isAtOrBelowMastery(undefined, 'shaky')).toBe(true); // new
    expect(isAtOrBelowMastery(stateFrom('q1', ['correct']), 'shaky')).toBe(true); // learning
    expect(isAtOrBelowMastery(stateFrom('q1', Array(6).fill('correct')), 'shaky')).toBe(false); // solid
  });

  it('includes everything when the ceiling is solid', () => {
    expect(isAtOrBelowMastery(stateFrom('q1', Array(6).fill('correct')), 'solid')).toBe(true);
  });
});

describe('topicMastery', () => {
  it('counts a multi-topic question toward every one of its topics', () => {
    const questions: Question[] = [question('q1', ['auth', 'tokens', 'security'])];
    const result = topicMastery(questions, {});
    expect(result.map((entry) => entry.topic).sort()).toEqual(['auth', 'security', 'tokens']);
    for (const entry of result) {
      expect(entry.total).toBe(1);
      expect(entry.newCount).toBe(1);
    }
  });

  it('orders weakest first so the UI surfaces what to act on', () => {
    const questions: Question[] = [question('strong', ['solid-topic']), question('weak', ['new-topic'])];
    const states = { strong: stateFrom('strong', Array(6).fill('correct')) };

    const result = topicMastery(questions, states);
    expect(result[0].topic).toBe('new-topic');
    expect(result[0].score).toBe(0);
    expect(result[1].topic).toBe('solid-topic');
    expect(result[1].score).toBe(1);
  });

  it('averages mixed mastery within a topic', () => {
    const questions: Question[] = [question('a', ['mixed']), question('b', ['mixed'])];
    const states = { a: stateFrom('a', Array(6).fill('correct')) };

    const [entry] = topicMastery(questions, states);
    expect(entry.total).toBe(2);
    expect(entry.newCount).toBe(1);
    expect(entry.score).toBeGreaterThan(0);
    expect(entry.score).toBeLessThan(1);
  });

  it('handles an empty bank', () => {
    expect(topicMastery([], {})).toEqual([]);
  });

  it('ignores questions with no topics', () => {
    expect(topicMastery([question('q1', [])], {})).toEqual([]);
  });
});

describe('bankSummary', () => {
  const questions: Question[] = [
    question('new1', ['t']),
    question('new2', ['t']),
    question('due1', ['t']),
    question('later', ['t']),
  ];

  const states: Record<string, ReviewState> = {
    due1: { ...stateFrom('due1', ['correct']), dueAt: NOW - 1000 },
    later: { ...stateFrom('later', ['correct']), dueAt: NOW + 10 * 86_400_000 },
  };

  it('separates new, due, and not-yet-due', () => {
    const summary = bankSummary(questions, states, NOW);
    expect(summary).toEqual({ total: 4, new: 2, due: 1, flagged: 0 });
  });

  /** A flagged question is out of circulation, so it must not inflate "due". */
  it('counts flagged questions separately and never as due', () => {
    const flagged: Question[] = [
      { ...question('due1', ['t']), flagged: { reason: 'wrong', at: NOW } },
    ];
    const summary = bankSummary(flagged, states, NOW);
    expect(summary.flagged).toBe(1);
    expect(summary.due).toBe(0);
    expect(summary.new).toBe(0);
  });

  it('never counts a leech as due', () => {
    const leechState = { ...stateFrom('due1', Array(6).fill('incorrect')), dueAt: NOW - 1000 };
    const summary = bankSummary([question('due1', ['t'])], { due1: leechState }, NOW);
    expect(summary.due).toBe(0);
  });

  it('handles an empty bank', () => {
    expect(bankSummary([], {}, NOW)).toEqual({ total: 0, new: 0, due: 0, flagged: 0 });
  });
});
