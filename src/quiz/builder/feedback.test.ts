import type { MultipleChoiceQuestion } from '../types';
import { draftsToKeep, feedbackDigest, fixInstruction, hasFeedback, tallyReviews } from './feedback';
import type { DraftReview, PlanBatch } from './types';

function question(id: string, prompt = `Question ${id}?`): MultipleChoiceQuestion {
  return {
    id,
    prompt,
    explanation: 'Because.',
    topics: ['thinking-fast-and-slow'],
    difficulty: 'core',
    sourceId: 'github-repo:1',
    provenance: { sourceId: 'github-repo:1', path: 'a.md' },
    addedAt: 1,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
  };
}

function review(overrides: Partial<DraftReview>): DraftReview {
  return { tags: [], note: '', ...overrides };
}

function batch(reviews: Record<string, DraftReview>, count = 5): Pick<PlanBatch, 'drafts' | 'reviews'> & PlanBatch {
  return {
    id: 'b1',
    number: 1,
    kind: 'batch',
    status: 'review',
    requested: count,
    specVersion: 1,
    createdAt: 1,
    drafts: Array.from({ length: count }, (_, index) => question(`q${index}`)),
    reviews,
    acceptedIds: [],
    discarded: 0,
    notes: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

describe('fixInstruction', () => {
  it('turns tags into instructions and quotes the reader last', () => {
    const text = fixInstruction(review({ tags: ['trivia', 'unclear'], note: 'Ask about anchoring itself' }));
    expect(text).toContain('not worth remembering');
    expect(text).toContain('unambiguous');
    expect(text.trim().endsWith('"Ask about anchoring itself"')).toBe(true);
  });

  it('still says something when the reader gave no reason', () => {
    expect(fixInstruction(review({}))).toMatch(/better question/);
  });
});

describe('tallyReviews and draftsToKeep', () => {
  const reviewed = batch({
    q0: review({ verdict: 'keep' }),
    q1: review({ verdict: 'fix', tags: ['too-easy'] }),
    q2: review({ verdict: 'drop' }),
  });

  it('counts each verdict, and the drafts nobody looked at', () => {
    expect(tallyReviews(reviewed)).toEqual({ total: 5, keep: 1, fix: 1, drop: 1, unreviewed: 2 });
  });

  /*
    Unreviewed counts as kept — a reader who flags one bad question in ten must
    not have to tick the other nine — but "fix" does not: they said it was not
    good enough as written.
  */
  it('keeps the unreviewed and the kept, never the dropped or the unfixed', () => {
    expect(draftsToKeep(reviewed).map((draft) => draft.id)).toEqual(['q0', 'q3', 'q4']);
  });
});

describe('feedbackDigest', () => {
  it('leads with what needed work and quotes the reader', () => {
    const digest = feedbackDigest(
      batch({
        q0: review({ verdict: 'keep' }),
        q1: review({ verdict: 'fix', tags: ['trivia'], note: 'stop asking about sample sizes' }),
        q2: review({ verdict: 'drop', tags: ['too-easy'] }),
      }),
      'Batch 2',
    );
    expect(digest).toMatch(/^My feedback on batch 2 \(5 questions\):/);
    expect(digest.indexOf('Needed work:')).toBeLessThan(digest.indexOf('Liked:'));
    expect(digest).toContain('“Question q1?” — Not worth knowing; "stop asking about sample sizes"');
    expect(digest).toContain('“Question q2?” — Too easy');
    expect(digest).toContain('2 more were fine as they were.');
  });

  it('caps long lists rather than pasting a whole batch into the conversation', () => {
    const reviews = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`q${index}`, review({ verdict: 'drop' })]),
    );
    expect(feedbackDigest(batch(reviews, 30), 'Batch 1')).toContain('…and 20 more');
  });
});

describe('hasFeedback', () => {
  it('is false for a batch nobody commented on, true once anyone did', () => {
    expect(hasFeedback(batch({}))).toBe(false);
    expect(hasFeedback(batch({ q0: review({ verdict: 'keep' }) }))).toBe(false);
    expect(hasFeedback(batch({ q0: review({ verdict: 'keep', note: 'great' }) }))).toBe(true);
    expect(hasFeedback(batch({ q0: review({ verdict: 'drop' }) }))).toBe(true);
  });
});
