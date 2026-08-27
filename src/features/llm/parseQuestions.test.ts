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

/** A true/false row as the prompt now asks for it: both halves, no answer. */
const pair = {
  format: 'true-false',
  claim: 'Kentucky stayed in the Union through the war.',
  distortion: 'Kentucky joined the Confederacy in the first year of the war.',
  whyWrong: 'Kentucky stayed, though it was divided',
  explanation: 'Lincoln kept troops out of it early on so as not to push it south.',
};

/** Distinct pairs, so every one gets its own id and its own coin flip. */
function pairs(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    ...pair,
    claim: `Claim ${i}: the border states were held by persuasion.`,
    distortion: `Claim ${i}: the border states were held by occupation.`,
    whyWrong: `Correction ${i}`,
  }));
}

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

describe('parseQuestions — the source passage', () => {
  it('keeps the quote the model returned', () => {
    const { questions } = parseQuestions(
      reply([{ ...mcq, source: 'West Virginia split off and was admitted as a free state.' }]),
      context,
    );

    expect(questions[0].provenance.quote).toBe(
      'West Virginia split off and was admitted as a free state.',
    );
  });

  /*
    Not verified against the note here on purpose. Matching is lenient and
    happens at render time, where a quote that has drifted costs a highlight
    rather than the question — rejecting it here would discard good questions
    over a changed full stop.
  */
  it('keeps a quote even when it could not have come from the note verbatim', () => {
    const { questions, rejected } = parseQuestions(
      reply([{ ...mcq, source: 'Something the note never said.' }]),
      context,
    );

    expect(rejected).toHaveLength(0);
    expect(questions[0].provenance.quote).toBe('Something the note never said.');
  });

  it('leaves the quote undefined when the model omits or empties it', () => {
    const { questions } = parseQuestions(
      reply([mcq, { ...mcq, prompt: 'Another?', source: '   ' }]),
      context,
    );

    expect(questions[0].provenance.quote).toBeUndefined();
    expect(questions[1].provenance.quote).toBeUndefined();
  });

  it('does not reject a question for having no source', () => {
    const { questions, rejected } = parseQuestions(reply([mcq]), context);
    expect(rejected).toHaveLength(0);
    expect(questions).toHaveLength(1);
  });
});

describe('parseQuestions — formats', () => {
  it('builds true-false from the pair, showing one half of it', () => {
    const { questions } = parseQuestions(reply([pair]), context);
    const question = questions[0];

    expect([pair.claim, pair.distortion]).toContain(question.prompt);
    // The answer is whichever half was shown, never what the model asked for —
    // it is not told which one the reader gets.
    expect(question.format === 'true-false' && question.correct).toBe(question.prompt === pair.claim);
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
        pair,
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

/*
  The format's whole difficulty is that the answer must not be readable off the
  surface of the sentence. Left to write one statement and its answer, the model
  writes down what the note says and nearly every question is true; these pin
  the machinery that takes that choice away from it.
*/
describe('true-false — the pair and the coin flip', () => {
  function trueFalse(rows: Record<string, unknown>[]) {
    const { questions } = parseQuestions(reply(rows), context);
    return questions.map((question) => {
      if (question.format !== 'true-false') throw new Error('expected true-false');
      return question;
    });
  }

  it('shows each side about half the time', () => {
    // The point of the whole exercise: "true" must stop being a free guess.
    const questions = trueFalse(pairs(60));
    const shown = questions.filter((question) => question.correct).length;

    expect(questions).toHaveLength(60);
    expect(shown).toBeGreaterThan(15);
    expect(shown).toBeLessThan(45);
  });

  it('shows the same side every time the same pair is parsed', () => {
    // A note regenerated unchanged must produce the same card, not a coin flip
    // that re-answers a question the reader is already learning.
    expect(trueFalse(pairs(20)).map((question) => question.prompt)).toEqual(
      trueFalse(pairs(20)).map((question) => question.prompt),
    );
  });

  it('hashes the id from the claim, so the two sides are one card', () => {
    // Same fact, two different false twins. Hashing the SHOWN statement would
    // make these two cards on the same fact, scheduled separately for review.
    const { questions, rejected } = parseQuestions(
      reply([pair, { ...pair, distortion: 'Kentucky was occupied by the Confederacy from 1861.' }]),
      context,
    );

    expect(questions).toHaveLength(1);
    expect(rejected[0].reason).toBe('duplicate');
  });

  it('leads the explanation with the correction only where it is the answer', () => {
    for (const question of trueFalse(pairs(20))) {
      // Shown the distortion, the reader needs to be told what was changed;
      // shown the claim, that clause would be explaining an error they never
      // saw. The underlying fact is stated either way.
      expect(/^Correction \d+\. /.test(question.explanation)).toBe(!question.correct);
      expect(question.explanation).toContain(pair.explanation);
    }
  });

  it('keeps a pair whose correction clause is missing', () => {
    // Worth less than a complete one, and still worth far more than nothing.
    const { whyWrong: _whyWrong, ...withoutCorrection } = pair;
    expect(trueFalse([withoutCorrection])[0].explanation).toBe(pair.explanation);
  });

  it('rejects a claim with no distortion, rather than asking it as it stands', () => {
    const { whyWrong: _whyWrong, distortion: _distortion, ...lonely } = pair;
    const { questions, rejected } = parseQuestions(reply([lonely]), context);

    expect(questions).toHaveLength(0);
    expect(rejected[0].reason).toBe('true-false needs a "distortion"');
  });

  it('rejects a distortion identical to its claim', () => {
    // The coin flip would otherwise decide the answer to a question that reads
    // the same either way, which no reader can get right.
    const { rejected } = parseQuestions(reply([{ ...pair, distortion: pair.claim }]), context);
    expect(rejected[0].reason).toBe('distortion repeats the claim');
  });

  it('rejects the single-statement shape a model falls back to', () => {
    // Loudly, in `rejected`, where a run reports it — the alternative is the
    // old skew creeping back in silently.
    const single = { format: 'true-false', prompt: 'Kentucky stayed in the Union.', explanation: 'It did.', correct: true };
    const { questions, rejected } = parseQuestions(reply([single]), context);

    expect(questions).toHaveLength(0);
    expect(rejected[0].reason).toBe('true-false needs "claim" and "distortion"');
  });

  it('accepts that shape only where a caller asks for it', () => {
    // The revise path, which has only the statement the reader was shown.
    const single = { format: 'true-false', prompt: 'Kentucky stayed in the Union.', explanation: 'It did.', correct: false };
    const { questions } = parseQuestions(reply([single]), context, { allowUnpairedTrueFalse: true });

    expect(questions).toHaveLength(1);
    expect(questions[0].prompt).toBe('Kentucky stayed in the Union.');
    expect(questions[0].format === 'true-false' && questions[0].correct).toBe(false);
  });

  it('ignores a "prompt" the model sends alongside a pair', () => {
    // Two statements and a third field naming one of them is one field too
    // many; the pair wins, and the stray prompt does not touch the id.
    const questions = trueFalse([{ ...pair, prompt: 'True or false: Kentucky stayed in the Union.' }]);
    expect([pair.claim, pair.distortion]).toContain(questions[0].prompt);
    expect(questions[0].id).toBe(trueFalse([pair])[0].id);
  });
});

describe('timeline', () => {
  const timeline = {
    format: 'timeline',
    prompt: 'Put these events in the order they happened.',
    explanation: 'The war ran from 1861 to 1865.',
    difficulty: 'core',
    events: ['Fort Sumter is shelled', 'Bull Run', 'Lee surrenders at Appomattox'],
    dates: ['April 1861', 'July 1861', '1865'],
  };

  function eventsOf(row: unknown) {
    const { questions } = parseQuestions(reply([row]), context);
    const question = questions[0];
    if (!question || question.format !== 'timeline') throw new Error('expected a timeline');
    return question.events;
  }

  it('keeps the events in the order the model wrote them', () => {
    // The stored order IS the answer key — the view shuffles at render, so the
    // model never has to state which order is correct.
    expect(eventsOf(timeline).map((event) => event.label)).toEqual([
      'Fort Sumter is shelled',
      'Bull Run',
      'Lee surrenders at Appomattox',
    ]);
  });

  it('assigns event ids by position rather than trusting the model', () => {
    const events = eventsOf({ ...timeline, ids: ['whatever', 'the', 'model', 'liked'] });
    expect(events.map((event) => event.id)).toEqual(['e0', 'e1', 'e2']);
  });

  it('pairs each date with the event in the same position', () => {
    expect(eventsOf(timeline).map((event) => event.date)).toEqual([
      'April 1861',
      'July 1861',
      '1865',
    ]);
  });

  /*
    The failure worth guarding hardest. Compacting either array — which is what
    `asStringArray` would do — re-dates every event after the gap, producing a
    question that looks perfectly fine and is wrong.
  */
  it('refuses a row whose dates do not line up, rather than shifting them', () => {
    const { questions, rejected } = parseQuestions(
      reply([{ ...timeline, dates: ['April 1861', '', '1865'] }]),
      context,
    );
    expect(questions).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/date/);
  });

  it('refuses a row with a blank event label', () => {
    const { questions } = parseQuestions(
      reply([{ ...timeline, events: ['Fort Sumter is shelled', '', 'Lee surrenders'] }]),
      context,
    );
    expect(questions).toHaveLength(0);
  });

  /*
    A label carrying its own date turns the question into a sorting exercise
    that needs no memory at all. Repaired rather than rejected: a dropped row is
    a silent loss, and models leak the date often enough to matter.
  */
  it('takes the date back out of a label that leaked it', () => {
    const events = eventsOf({
      ...timeline,
      events: ['Fort Sumter is shelled (April 1861)', 'Bull Run', 'Lee surrenders'],
    });
    expect(events[0].label).toBe('Fort Sumter is shelled');
    expect(events[0].date).toBe('April 1861');
  });

  it("leaves a year alone when it is not that event's own date", () => {
    // "The 1922 Committee" is a name, not a date, and a blanket year strip
    // would gut it.
    const events = eventsOf({
      ...timeline,
      events: ['The 1922 Committee is founded', 'Bull Run', 'Lee surrenders'],
      dates: ['1923', 'July 1861', '1865'],
    });
    expect(events[0].label).toBe('The 1922 Committee is founded');
  });

  it('leaves a label alone when it was nothing but its date', () => {
    // An odd label beats a row dropped for being empty; the editor flags it.
    const events = eventsOf({
      ...timeline,
      events: ['1861', 'Bull Run', 'Lee surrenders'],
      dates: ['1861', 'July 1861', '1865'],
    });
    expect(events[0].label).toBe('1861');
  });

  it('rejects a timeline with fewer events than anyone could order', () => {
    const { questions } = parseQuestions(
      reply([{ ...timeline, events: ['One', 'Two'], dates: ['1861', '1862'] }]),
      context,
    );
    expect(questions).toHaveLength(0);
  });

  it('produces a row storage will accept', () => {
    const { questions } = parseQuestions(reply([timeline]), context);
    expect(isValidQuestion(questions[0])).toBe(true);
  });
});

it('refuses a timeline where two events share a date', () => {
  // The dates are the slots the reader drags onto, so a repeat draws two
  // identical rows and one of them cannot be got right.
  const { questions, rejected } = parseQuestions(
    reply([
      {
        format: 'timeline',
        prompt: 'Order these.',
        explanation: 'Because.',
        difficulty: 'core',
        events: ['Shiloh', 'New Orleans falls', 'Lee surrenders'],
        dates: ['April 1862', 'April 1862', '1865'],
      },
    ]),
    context,
  );
  expect(questions).toHaveLength(0);
  expect(rejected[0].reason).toMatch(/share a date/);
});
