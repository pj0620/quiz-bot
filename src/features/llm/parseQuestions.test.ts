import { isValidQuestion } from '../../quiz/questionTypes/registry';
import { extractJson, parseQuestions, type ParseContext } from './parseQuestions';

const context: ParseContext = {
  sourceId: 'github-repo:1',
  path: 'History/History of America 40 First Year of Fighting.md',
  noteTitle: 'First Year of Fighting',
  topics: ['history-of-america'],
  revision: 'a1b2c3d',
  excerpt: 'At first glance the north has overwhelming advantages.',
  addedAt: 1_760_000_000_000,
};

function reply(questions: unknown[]): string {
  return JSON.stringify({ questions });
}

const mcq = {
  format: 'multiple-choice',
  prompt: 'Which border state was created during the war?',
  explanation: 'West Virginia was admitted as a free state in 1861.',
  difficulty: 'core',
  choices: ['Kentucky', 'West Virginia', 'Missouri', 'Delaware'],
  correctIndex: 1,
};

describe('extractJson', () => {
  it('parses a bare object', () => {
    expect(extractJson('{"questions":[]}')).toEqual({ questions: [] });
  });

  it('parses JSON wrapped in a markdown fence', () => {
    // Anthropic has no native JSON mode, so a fenced reply is routine rather
    // than exceptional — failing on it would be a self-inflicted error rate.
    expect(extractJson('```json\n{"questions":[]}\n```')).toEqual({ questions: [] });
    expect(extractJson('```\n{"questions":[]}\n```')).toEqual({ questions: [] });
  });

  it('survives a preamble before the JSON', () => {
    expect(extractJson('Here you go:\n\n{"questions":[]}')).toEqual({ questions: [] });
  });

  it('returns undefined when there is no JSON at all', () => {
    expect(extractJson('I cannot help with that.')).toBeUndefined();
    expect(extractJson('')).toBeUndefined();
  });
});

describe('parseQuestions — what the model is not trusted with', () => {
  it('assigns id, topics and provenance itself, ignoring the model', () => {
    const { questions } = parseQuestions(
      reply([
        {
          ...mcq,
          // A model may volunteer all of these. None may be honoured: ids must
          // be deterministic for dedupe, and topics must come from the note or
          // the vocabulary re-fragments.
          id: 'model-invented-id',
          topics: ['American History', 'civil war', 'us-history'],
          provenance: { sourceId: 'nonsense', path: 'made/up.md' },
          sourceId: 'nonsense',
          addedAt: 1,
        },
      ]),
      context,
    );

    expect(questions).toHaveLength(1);
    const question = questions[0];
    expect(question.id).not.toBe('model-invented-id');
    expect(question.topics).toEqual(['history-of-america']);
    expect(question.sourceId).toBe('github-repo:1');
    expect(question.provenance.path).toBe(context.path);
    expect(question.provenance.noteTitle).toBe('First Year of Fighting');
    expect(question.addedAt).toBe(context.addedAt);
  });

  it('derives the same id for the same question across runs', () => {
    const first = parseQuestions(reply([mcq]), context).questions[0];
    const second = parseQuestions(reply([mcq]), context).questions[0];
    expect(second.id).toBe(first.id);
  });

  it('gives different notes different ids for the same prompt', () => {
    const other = parseQuestions(reply([mcq]), { ...context, path: 'History/Other.md' }).questions[0];
    const base = parseQuestions(reply([mcq]), context).questions[0];
    expect(other.id).not.toBe(base.id);
  });

  it('assigns choice ids rather than asking the model for them', () => {
    const question = parseQuestions(reply([mcq]), context).questions[0];
    if (question.format !== 'multiple-choice') throw new Error('wrong format');
    expect(question.choices.map((choice) => choice.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(question.correctChoiceId).toBe('c1');
    expect(question.choices.find((c) => c.id === question.correctChoiceId)?.text).toBe('West Virginia');
  });
});

describe('parseQuestions — formats', () => {
  it('builds true-false', () => {
    const { questions } = parseQuestions(
      reply([
        {
          format: 'true-false',
          prompt: 'Slavery was still allowed in some states that stayed in the Union.',
          explanation: 'Lincoln did not want to push the border states south.',
          correct: true,
        },
      ]),
      context,
    );
    expect(questions[0].format === 'true-false' && questions[0].correct).toBe(true);
  });

  it('builds short-answer with acceptable alternatives', () => {
    const { questions } = parseQuestions(
      reply([
        {
          format: 'short-answer',
          prompt: 'Which side had the stronger economy?',
          explanation: 'The north had more factories and railroads.',
          modelAnswer: 'The Union',
          acceptable: ['Union', 'the north'],
        },
      ]),
      context,
    );
    const question = questions[0];
    expect(question.format === 'short-answer' && question.acceptable).toEqual(['Union', 'the north']);
  });

  it('computes list-recall required rather than trusting the model', () => {
    const { questions } = parseQuestions(
      reply([
        {
          format: 'list-recall',
          prompt: 'Name the Northern advantages.',
          explanation: 'Four are listed.',
          items: ['Population', 'Economic Strength', 'Professional Military', 'Leadership'],
          // "Name 9 of 4" is unanswerable; the model's value is discarded.
          required: 9,
        },
      ]),
      context,
    );
    expect(questions[0].format === 'list-recall' && questions[0].required).toBe(3);
  });

  it('clamps list-recall required to the number of items', () => {
    const { questions } = parseQuestions(
      reply([
        {
          format: 'list-recall',
          prompt: 'Name them.',
          explanation: 'Two are listed.',
          items: ['Adjustment', 'Priming'],
        },
      ]),
      context,
    );
    expect(questions[0].format === 'list-recall' && questions[0].required).toBe(2);
  });

  it('splices the fill-blank placeholder itself', () => {
    const { questions } = parseQuestions(
      reply([
        {
          format: 'fill-blank',
          prompt: 'Fill in the population ratio.',
          explanation: 'The north outnumbered the south.',
          sentence: 'Population was a 5:2 ratio of north to south',
          answer: '5:2',
        },
      ]),
      context,
    );
    const question = questions[0];
    if (question.format !== 'fill-blank') throw new Error('wrong format');
    expect(question.template).toBe('Population was a {{a}} ratio of north to south');
    expect(question.blanks).toEqual([{ id: 'a', accepted: ['5:2'] }]);
  });
});

describe('parseQuestions — rejection', () => {
  function reasonsFor(row: unknown): string[] {
    return parseQuestions(reply([row]), context).rejected.map((entry) => entry.reason);
  }

  it('drops a format it does not know', () => {
    expect(reasonsFor({ ...mcq, format: 'essay' })).toEqual(['unknown format "essay"']);
  });

  it('drops a question with no explanation', () => {
    expect(reasonsFor({ ...mcq, explanation: '' })).toEqual(['missing explanation']);
  });

  it('drops a correctIndex outside the choices', () => {
    expect(reasonsFor({ ...mcq, correctIndex: 7 })).toEqual(['correctIndex out of range']);
    expect(reasonsFor({ ...mcq, correctIndex: -1 })).toEqual(['correctIndex out of range']);
  });

  it('drops fill-blank when the answer is not in the sentence', () => {
    // Otherwise the renderer draws a blank nothing can grade.
    expect(
      reasonsFor({
        format: 'fill-blank',
        prompt: 'p',
        explanation: 'e',
        sentence: 'Population was a 5:2 ratio',
        answer: 'seven',
      }),
    ).toEqual(['answer not found in sentence']);
  });

  it('drops one bad row without losing the good ones', () => {
    const outcome = parseQuestions(reply([mcq, { format: 'essay' }, { ...mcq, prompt: 'Another?' }]), context);
    expect(outcome.questions).toHaveLength(2);
    expect(outcome.rejected).toHaveLength(1);
  });

  it('drops duplicates within one reply', () => {
    const outcome = parseQuestions(reply([mcq, mcq]), context);
    expect(outcome.questions).toHaveLength(1);
    expect(outcome.rejected.map((entry) => entry.reason)).toEqual(['duplicate']);
  });

  it('reports a non-JSON reply rather than throwing', () => {
    const outcome = parseQuestions('I cannot help with that.', context);
    expect(outcome.questions).toHaveLength(0);
    expect(outcome.rejected[0].reason).toBe('reply was not JSON');
  });

  it('reports valid JSON with no questions array', () => {
    expect(parseQuestions('{"result":"ok"}', context).rejected[0].reason).toBe('no "questions" array');
  });

  it('tolerates a bare array instead of the wrapper object', () => {
    expect(parseQuestions(JSON.stringify([mcq]), context).questions).toHaveLength(1);
  });
});

describe('parseQuestions — storage safety', () => {
  it('emits only questions that pass the bank validator', () => {
    // Anything failing this would be silently dropped on the next launch, so it
    // must never reach the bank in the first place.
    const { questions } = parseQuestions(
      reply([
        mcq,
        { format: 'true-false', prompt: 'p', explanation: 'e', correct: false },
        {
          format: 'fill-blank',
          prompt: 'p',
          explanation: 'e',
          sentence: 'Admitted in 1861 as a free state',
          answer: '1861',
        },
      ]),
      context,
    );

    expect(questions).toHaveLength(3);
    for (const question of questions) {
      expect(isValidQuestion(question)).toBe(true);
    }
  });

  it('falls back to a valid difficulty when the model invents one', () => {
    const { questions } = parseQuestions(reply([{ ...mcq, difficulty: 'impossible' }]), context);
    expect(questions[0].difficulty).toBe('core');
  });
});
