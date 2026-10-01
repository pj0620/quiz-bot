import { applyHandEdit, diffSpecs, sameContent, sanitizeSpec, specGuidance } from './planSpec';
import { emptyScope, MAX_BULLETS, MAX_QUESTIONS_PER_NOTE, type PlanSpec } from './types';

const NOW = 1_760_000_000_000;

function spec(overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    version: 1,
    title: 'Thinking Fast and Slow — the big ideas',
    summary: 'The two systems and the biases they cause.',
    scope: { ...emptyScope(), terms: ['Thinking Fast and Slow'] },
    focus: ['How System 1 and System 2 differ'],
    avoid: ['Study sample sizes'],
    formats: [],
    difficulty: 'mixed',
    questionsPerNote: 5,
    style: '',
    author: 'ai',
    updatedAt: NOW - 1,
    ...overrides,
  };
}

describe('sanitizeSpec', () => {
  it('builds a first version from a complete proposal', () => {
    const result = sanitizeSpec(
      {
        title: '  TFAS  ',
        summary: 'Big ideas',
        scope: { terms: ['Thinking Fast and Slow'] },
        focus: ['Biases'],
        avoid: [],
        formats: ['multiple-choice', 'short-answer'],
        difficulty: 'challenging',
        questionsPerNote: 4,
        style: 'Plain words',
      },
      null,
      NOW,
    );
    expect(result).toMatchObject({
      version: 1,
      title: 'TFAS',
      formats: ['multiple-choice', 'short-answer'],
      difficulty: 'challenging',
      questionsPerNote: 4,
      author: 'ai',
      updatedAt: NOW,
    });
    expect(result?.scope.terms).toEqual(['Thinking Fast and Slow']);
  });

  it('returns null for something that is not a plan at all', () => {
    expect(sanitizeSpec(null, null, NOW)).toBeNull();
    expect(sanitizeSpec('a plan', null, NOW)).toBeNull();
    expect(sanitizeSpec([], null, NOW)).toBeNull();
    expect(sanitizeSpec({ summary: 'no title, no scope' }, null, NOW)).toBeNull();
  });

  /*
    A field left out keeps its value; a field sent empty clears it. Without the
    distinction, a reply that simply forgot to repeat the focus list would wipe
    the reader's plan.
  */
  it('keeps what a proposal left out and replaces what it sent', () => {
    const previous = spec();
    const result = sanitizeSpec({ title: previous.title, avoid: [] }, previous, NOW)!;
    expect(result.focus).toEqual(previous.focus);
    expect(result.avoid).toEqual([]);
    expect(result.version).toBe(2);
  });

  it('returns the previous version untouched when nothing changed', () => {
    const previous = spec();
    const result = sanitizeSpec(
      { title: previous.title, focus: [...previous.focus], scope: { terms: ['Thinking Fast and Slow'] } },
      previous,
      NOW,
    );
    expect(result).toBe(previous);
  });

  it('clamps the density and maps difficulty synonyms', () => {
    const result = sanitizeSpec({ title: 'x', questionsPerNote: 99, difficulty: 'Hard' }, null, NOW)!;
    expect(result.questionsPerNote).toBe(MAX_QUESTIONS_PER_NOTE);
    expect(result.difficulty).toBe('challenging');
    expect(sanitizeSpec({ title: 'x', questionsPerNote: '3' }, null, NOW)!.questionsPerNote).toBe(3);
  });

  it('drops unknown formats, and reads "all of them" as any', () => {
    expect(sanitizeSpec({ title: 'x', formats: ['multiple-choice', 'map-locate', 'essay'] }, null, NOW)!.formats).toEqual([
      'multiple-choice',
    ]);
    const all = ['multiple-choice', 'true-false', 'short-answer', 'list-recall', 'fill-blank', 'timeline'];
    expect(sanitizeSpec({ title: 'x', formats: all }, null, NOW)!.formats).toEqual([]);
  });

  it('cleans bullet lists: trimmed, de-duplicated, capped', () => {
    const focus = ['  Biases ', 'biases', '', 42, ...Array.from({ length: 20 }, (_, index) => `Idea ${index}`)];
    const result = sanitizeSpec({ title: 'x', focus }, null, NOW)!;
    expect(result.focus[0]).toBe('Biases');
    expect(result.focus).toHaveLength(MAX_BULLETS);
  });

  it('drops scope phrases that normalize to nothing, since they could match nothing', () => {
    const result = sanitizeSpec({ title: 'x', scope: { terms: ['!!!', 'Sapiens'] } }, null, NOW)!;
    expect(result.scope.terms).toEqual(['Sapiens']);
  });

  /*
    The planner never sees which notes the reader ticked by hand, so it must
    never be able to undo them — whatever it sends.
  */
  it('never lets the model touch hand-picked notes or sources', () => {
    const previous = spec({
      scope: { ...emptyScope(), terms: ['a'], include: ['s:x.md'], exclude: ['s:y.md'], sourceIds: ['s'] },
    });
    const result = sanitizeSpec(
      { title: 'x', scope: { terms: ['b'], include: [], exclude: ['s:z.md'], sourceIds: [] } },
      previous,
      NOW,
    )!;
    expect(result.scope).toMatchObject({ terms: ['b'], include: ['s:x.md'], exclude: ['s:y.md'], sourceIds: ['s'] });
  });
});

describe('applyHandEdit', () => {
  it('stores the reader’s hand picks and marks the version as theirs', () => {
    const previous = spec();
    const edited = { ...previous, scope: { ...previous.scope, exclude: ['s:y.md'] } };
    const result = applyHandEdit(edited, previous, NOW);
    expect(result.scope.exclude).toEqual(['s:y.md']);
    expect(result.author).toBe('user');
    expect(result.version).toBe(2);
  });

  it('does not bump the version for a save with no changes', () => {
    const previous = spec();
    expect(applyHandEdit({ ...previous }, previous, NOW)).toBe(previous);
  });
});

describe('sameContent', () => {
  it('ignores version, author and timestamp', () => {
    expect(sameContent(spec(), spec({ version: 9, author: 'user', updatedAt: 0 }))).toBe(true);
    expect(sameContent(spec(), spec({ difficulty: 'gentle' }))).toBe(false);
  });
});

describe('specGuidance', () => {
  it('writes the plan as instructions, bullets included', () => {
    const text = specGuidance(spec({ formats: ['multiple-choice'], style: 'Plain words.' }));
    expect(text).toContain('Quiz: Thinking Fast and Slow — the big ideas');
    expect(text).toContain('- How System 1 and System 2 differ');
    expect(text).toContain('- Study sample sizes');
    expect(text).toContain('use ONLY multiple-choice');
    expect(text).toContain('Style: Plain words.');
  });

  it('puts the reader’s general preferences after the plan, as the weaker of the two', () => {
    const text = specGuidance(spec(), 'I like short answers.');
    expect(text.indexOf('THIS QUIZ HAS A PLAN')).toBeLessThan(text.indexOf('I like short answers.'));
    expect(text).toContain('wherever the plan above does not say otherwise');
  });

  it('says nothing about formats when the plan allows any', () => {
    expect(specGuidance(spec())).not.toContain('Formats:');
  });
});

describe('diffSpecs', () => {
  it('lists each change a reader would care about', () => {
    const before = spec();
    const after = spec({
      version: 2,
      focus: ['How System 1 and System 2 differ', 'Why the halo effect happens'],
      avoid: [],
      difficulty: 'challenging',
      questionsPerNote: 6,
      scope: { ...emptyScope(), terms: ['Thinking Fast and Slow', 'Kahneman'] },
    });
    expect(diffSpecs(before, after)).toEqual([
      'Notes: Notes matching “Thinking Fast and Slow” or “Kahneman”',
      '+ Ask about: Why the halo effect happens',
      '− Leave alone: Study sample sizes',
      'Difficulty: Mixed → Challenging',
      'Questions per note: 5 → 6',
    ]);
  });

  it('is empty with no previous version, or no change', () => {
    expect(diffSpecs(null, spec())).toEqual([]);
    expect(diffSpecs(spec(), spec({ version: 2 }))).toEqual([]);
  });
});
