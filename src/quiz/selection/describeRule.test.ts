import type { QuizRule } from '../types';
import { describeDraw, describeMix, describeRule } from './describeRule';

const rule = (overrides: Partial<QuizRule> = {}): QuizRule => ({ size: 10, mix: 'balanced', ...overrides });

describe('describeRule', () => {
  it('describes an unfiltered rule as the whole bank', () => {
    expect(describeRule(rule())).toBe('Everything in your bank');
  });

  it('renders topics for display, not as slugs', () => {
    expect(describeRule(rule({ topics: ['react-hooks'] }))).toBe('React Hooks');
    expect(describeRule(rule({ topics: ['auth', 'tokens'] }))).toBe('Auth or Tokens');
  });

  it('collapses long topic lists rather than running off the row', () => {
    expect(describeRule(rule({ topics: ['a', 'b', 'c'] }))).toBe('3 topics');
  });

  it('describes a date window', () => {
    expect(describeRule(rule({ addedWithinDays: 7 }))).toBe('Added in the last 7 days');
    expect(describeRule(rule({ addedWithinDays: 1 }))).toBe('Added today');
  });

  it('resolves source names when supplied and degrades gracefully when not', () => {
    expect(describeRule(rule({ sourceIds: ['s1'] }), { s1: 'octocat/hello' })).toBe('octocat/hello');
    expect(describeRule(rule({ sourceIds: ['s1'] }))).toBe('A source');
  });

  it('combines filters in a stable order', () => {
    const description = describeRule(rule({ addedWithinDays: 7, topics: ['auth'] }));
    expect(description).toBe('Added in the last 7 days · Auth');
  });

  it('mentions a non-default mix', () => {
    expect(describeRule(rule({ mix: 'new-only' }))).toBe('New only');
    expect(describeRule(rule({ mix: 'review-only' }))).toBe('Reviews only');
  });

  it('describes the weak-spots rule', () => {
    expect(describeRule(rule({ maxMastery: 'shaky' }))).toBe('Shaky or weaker');
  });
});

describe('describeMix', () => {
  it('labels each mix', () => {
    expect(describeMix(rule({ mix: 'balanced' }))).toBe('New and review');
    expect(describeMix(rule({ mix: 'new-only' }))).toBe('New material only');
    expect(describeMix(rule({ mix: 'review-only' }))).toBe('Reviews only');
  });
});

describe('describeDraw', () => {
  /**
   * This string is the entire defence against the live-rule model surprising
   * the user, so its exact wording is pinned.
   */
  it('states the pool and the draw when the pool is larger', () => {
    expect(describeDraw(rule({ size: 10 }), 142)).toBe(
      '142 questions match right now — each attempt draws 10',
    );
  });

  it('omits the draw when every matching question will be used', () => {
    expect(describeDraw(rule({ size: 10 }), 4)).toBe('4 questions match right now');
  });

  it('agrees noun and verb in the singular', () => {
    expect(describeDraw(rule({ size: 10 }), 1)).toBe('1 question matches right now');
  });

  it('is explicit when nothing matches', () => {
    expect(describeDraw(rule(), 0)).toBe('No questions match this quiz yet');
  });
});
