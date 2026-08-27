import { getLlmProvider } from './registry';
import { buildRevisePrompt, reviseQuestion, toModelRow } from './reviseQuestion';
import type { LlmProviderDefinition } from './contract';
import type { CompletionInput, CompletionResult } from './types';
import type { Question } from '../../quiz/types';

function base(id = 'q-1') {
  return {
    id,
    prompt: 'What held the coalition together?',
    explanation: 'Because of patronage.',
    topics: ['history-of-america'],
    difficulty: 'core' as const,
    sourceId: 'src-1',
    provenance: {
      sourceId: 'src-1',
      path: 'History/Note.md',
      noteTitle: 'A Nation Announcing Itself',
      revision: 'commit-abc',
      excerpt: 'the excerpt',
      quote: 'the quoted line',
    },
    addedAt: 1_700_000_000_000,
    contentAt: 1_600_000_000_000,
  };
}

const MULTIPLE_CHOICE: Question = {
  ...base(),
  format: 'multiple-choice',
  choices: [
    { id: 'c0', text: 'Wrong one' },
    { id: 'c1', text: 'The right one' },
  ],
  correctChoiceId: 'c1',
};

const FILL_BLANK: Question = {
  ...base(),
  format: 'fill-blank',
  template: 'Jackson was elected in {{a}} after a bitter campaign.',
  blanks: [{ id: 'a', accepted: ['1828'] }],
};

function reply(row: Record<string, unknown>): string {
  return JSON.stringify({ questions: [row] });
}

/** Captures what the provider was asked, without touching the network. */
function fakeProvider(text: string, stopReason: CompletionResult['stopReason'] = 'stop') {
  const calls: CompletionInput[] = [];
  const provider: LlmProviderDefinition = {
    ...getLlmProvider('anthropic'),
    async complete(input) {
      calls.push(input);
      return { text, stopReason, usage: { inputTokens: 10, outputTokens: 20 } };
    },
  };
  return { provider, calls };
}

function revise(question: Question, text: string, instruction = 'Say which decade.') {
  const { provider, calls } = fakeProvider(text);
  return {
    calls,
    promise: reviseQuestion({
      question,
      instruction,
      provider,
      apiKey: 'sk-test',
      model: 'test-model',
    }),
  };
}

describe('showing the model its own row shape', () => {
  it('sends multiple-choice as texts and an index, not as stored ids', () => {
    /*
      The stored shape and the shape the prompt documents are different, and
      round-tripping through the wrong one is how a revision comes back
      unparseable. `correctChoiceId` means nothing to the model; the parser
      wants `correctIndex`.
    */
    expect(toModelRow(MULTIPLE_CHOICE)).toMatchObject({
      choices: ['Wrong one', 'The right one'],
      correctIndex: 1,
    });
    expect(toModelRow(MULTIPLE_CHOICE)).not.toHaveProperty('correctChoiceId');
  });

  it('un-splices a fill-blank template back into a sentence and an answer', () => {
    // `parseQuestions` re-derives the `{{a}}` template itself, and rejects a row
    // whose answer isn't found inside its sentence.
    expect(toModelRow(FILL_BLANK)).toMatchObject({
      sentence: 'Jackson was elected in 1828 after a bitter campaign.',
      answer: '1828',
    });
  });

  it('passes the anchoring quote through as "source"', () => {
    expect(toModelRow(MULTIPLE_CHOICE)).toMatchObject({ source: 'the quoted line' });
  });

  it('puts the question and the instruction in the prompt', () => {
    const prompt = buildRevisePrompt(MULTIPLE_CHOICE, 'Make it shorter');
    expect(prompt).toContain('What held the coalition together?');
    expect(prompt).toContain('Make it shorter');
    expect(prompt).toMatch(/EXACTLY ONE question/);
  });

  it('tells the model this is an edit, not a fresh question', () => {
    // Without it, "shorten the wording" comes back with a new answer too.
    expect(buildRevisePrompt(MULTIPLE_CHOICE, 'x')).toMatch(/change NOTHING ELSE/);
  });
});

describe('what a revision may and may not change', () => {
  it('keeps the id, so review history survives the edit', () => {
    /*
      `parseQuestions` hashes a NEW id out of the new prompt — correct for
      generation, catastrophic here. A changed id orphans every review the user
      has done on this card and hands them a fresh one at interval zero.
    */
    const { promise } = revise(
      MULTIPLE_CHOICE,
      reply({
        format: 'multiple-choice',
        prompt: 'A completely different wording',
        explanation: 'Still because of patronage.',
        choices: ['a', 'b'],
        correctIndex: 0,
      }),
    );

    return promise.then((result) => {
      expect(result.question.id).toBe('q-1');
      expect(result.question.prompt).toBe('A completely different wording');
    });
  });

  it('keeps provenance and the original dates', async () => {
    // A rewording doesn't change where the question came from, and bumping the
    // dates would make an edited question look newly generated to the Daily quiz.
    const { promise } = revise(
      MULTIPLE_CHOICE,
      reply({
        format: 'multiple-choice',
        prompt: 'New wording',
        explanation: 'Why.',
        choices: ['a', 'b'],
        correctIndex: 0,
      }),
    );
    const { question } = await promise;

    expect(question.provenance.path).toBe('History/Note.md');
    expect(question.provenance.noteTitle).toBe('A Nation Announcing Itself');
    expect(question.addedAt).toBe(1_700_000_000_000);
    expect(question.contentAt).toBe(1_600_000_000_000);
    expect(question.topics).toEqual(['history-of-america']);
  });

  it('allows a format change, which is a reasonable thing to ask for', async () => {
    const { promise } = revise(
      MULTIPLE_CHOICE,
      reply({
        format: 'true-false',
        prompt: 'Patronage held the coalition together.',
        explanation: 'It did.',
        correct: true,
      }),
      'Make this true or false',
    );
    const { question } = await promise;

    expect(question.format).toBe('true-false');
    expect(question.id).toBe('q-1');
  });

  /*
    Generation rejects a true/false row that arrives as one statement — the
    pair is what stops the answer being "true" nearly every time. Revision
    cannot: a stored question only ever held the half the reader was shown, so
    the shape that goes out is the shape that has to be allowed back in.
  */
  it('accepts the single statement a stored true/false question comes back as', async () => {
    const { promise } = revise(
      MULTIPLE_CHOICE,
      reply({
        format: 'true-false',
        prompt: 'Patronage held the coalition together.',
        explanation: 'It did.',
        correct: false,
      }),
      'Make this true or false',
    );
    const { question } = await promise;

    expect(question.prompt).toBe('Patronage held the coalition together.');
    expect(question.format === 'true-false' && question.correct).toBe(false);
  });

  it('takes a pair back too, and picks the side itself', async () => {
    // The upgrade path for "this one is too obvious": the model answers with
    // both halves, and which one the reader meets stops being its choice.
    const { promise } = revise(
      MULTIPLE_CHOICE,
      reply({
        format: 'true-false',
        claim: 'Patronage held Jackson’s coalition together in the 1830s.',
        distortion: 'A shared tariff policy held Jackson’s coalition together in the 1830s.',
        whyWrong: 'The tariff split the coalition rather than binding it',
        explanation: 'Offices were the glue; the tariff was the fault line.',
      }),
      'Too easy, make it harder',
    );
    const { question } = await promise;

    expect(question.format).toBe('true-false');
    expect(question.prompt).toContain('held Jackson’s coalition together in the 1830s');
    // The id is still the original one: a revision is a correction to a card
    // the user is already learning, not a new card.
    expect(question.id).toBe('q-1');
  });

  it('tells the model when a pair is the better answer to the request', () => {
    const prompt = buildRevisePrompt(MULTIPLE_CHOICE, 'Too easy');
    expect(prompt).toMatch(/"claim"\/"distortion" pair/);
    expect(prompt).toMatch(/too easy, too obvious, guessable/i);
  });

  it('reports usage, so the price of iterating is visible', async () => {
    const { promise } = revise(
      MULTIPLE_CHOICE,
      reply({ format: 'true-false', prompt: 'p', explanation: 'e', correct: true }),
    );
    expect((await promise).usage).toEqual({ inputTokens: 10, outputTokens: 20 });
  });
});

describe('refusing a bad revision', () => {
  it('rejects a reply that fails the same gate generation uses', async () => {
    // One choice is not a multiple-choice question. Letting edits through a
    // looser path would put shapes in the bank that generation cannot produce.
    const { promise } = revise(
      MULTIPLE_CHOICE,
      reply({
        format: 'multiple-choice',
        prompt: 'p',
        explanation: 'e',
        choices: ['only one'],
        correctIndex: 0,
      }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'llm_bad_response' });
  });

  it('rejects a fill-blank whose answer is not in its sentence', async () => {
    const { promise } = revise(
      FILL_BLANK,
      reply({
        format: 'fill-blank',
        prompt: 'p',
        explanation: 'e',
        sentence: 'Jackson was elected after a bitter campaign.',
        answer: '1828',
      }),
    );
    await expect(promise).rejects.toMatchObject({ code: 'llm_bad_response' });
  });

  it('names a truncated reply as truncated', async () => {
    const { provider } = fakeProvider('{"questions":[{"format":"true', 'length');
    await expect(
      reviseQuestion({
        question: MULTIPLE_CHOICE,
        instruction: 'x',
        provider,
        apiKey: 'sk-test',
        model: 'test-model',
      }),
    ).rejects.toMatchObject({ code: 'llm_bad_response' });
  });

  it('refuses an empty instruction before spending anything', async () => {
    const { provider, calls } = fakeProvider(reply({}));
    await expect(
      reviseQuestion({
        question: MULTIPLE_CHOICE,
        instruction: '   ',
        provider,
        apiKey: 'sk-test',
        model: 'test-model',
      }),
    ).rejects.toMatchObject({ code: 'llm_bad_response' });
    expect(calls).toHaveLength(0);
  });

  it('refuses with no API key', async () => {
    const { provider } = fakeProvider(reply({}));
    await expect(
      reviseQuestion({
        question: MULTIPLE_CHOICE,
        instruction: 'x',
        provider,
        apiKey: '',
        model: 'test-model',
      }),
    ).rejects.toMatchObject({ code: 'llm_not_configured' });
  });
});

describe('the reader’s own generation notes', () => {
  it('applies to revisions too, so an edit obeys the same taste', async () => {
    const { calls, promise } = (() => {
      const { provider, calls } = fakeProvider(
        reply({ format: 'true-false', prompt: 'p', explanation: 'e', correct: true }),
      );
      return {
        calls,
        promise: reviseQuestion({
          question: MULTIPLE_CHOICE,
          instruction: 'shorter',
          provider,
          apiKey: 'sk-test',
          model: 'test-model',
          guidance: 'Ask more about people than about dates.',
        }),
      };
    })();

    await promise;
    expect(calls[0].system).toContain('Ask more about people than about dates.');
  });
});

describe('toModelRow — timeline', () => {
  const timeline = {
    id: 'q9',
    prompt: 'Put these in order.',
    explanation: 'The war ran 1861 to 1865.',
    topics: ['history-of-america'],
    difficulty: 'core' as const,
    sourceId: 'github-repo:1',
    provenance: { sourceId: 'github-repo:1', path: 'a.md' },
    addedAt: 1_760_000_000_000,
    format: 'timeline' as const,
    events: [
      { id: 'e0', label: 'Fort Sumter is shelled', date: 'April 1861' },
      { id: 'e1', label: 'Bull Run', date: 'July 1861' },
      { id: 'e2', label: 'Lee surrenders', date: '1865' },
    ],
  };

  it('sends the two parallel arrays the parser reads back', () => {
    expect(toModelRow(timeline)).toMatchObject({
      events: ['Fort Sumter is shelled', 'Bull Run', 'Lee surrenders'],
      dates: ['April 1861', 'July 1861', '1865'],
    });
  });

  /*
    The parser pairs the arrays BY POSITION, so a compacted `dates` would
    re-date every event after the gap — the question would come back looking
    fine and being wrong.
  */
  it('keeps an empty slot rather than compacting the dates out of step', () => {
    const gap = { ...timeline, events: [...timeline.events] };
    gap.events[1] = { ...gap.events[1], date: '' };
    const row = toModelRow(gap) as { dates: string[] };
    expect(row.dates).toHaveLength(3);
    expect(row.dates[1]).toBe('');
  });
});
