import { parseNote } from '../../notes/parse';
import { noteStem } from '../../notes/paths';
import { ANCHORING, CIVIL_WAR, FORT_SUMTER } from '../../notes/__fixtures__/sampleNotes';
import { extractJson } from './parseQuestions';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { getLlmProvider } from './registry';

/*
  A MEASUREMENT, not a unit test. It calls a real model and costs real money, so
  it skips itself unless you hand it a key:

    QUIZBOT_EVAL_KEY=sk-ant-... npx jest questionQuality

  It exists for the two prompt rules no unit test can check, because both are
  about what a model DOES with an instruction rather than whether the
  instruction is present.

  1. Are true/false statements written as a matched pair, and do the two halves
     match? The parser guarantees the answer is true half the time — that is
     arithmetic, covered in `parseQuestions.test.ts`. What it cannot guarantee
     is that the false half arrives the same length, texture and confidence as
     the true one, which is the tell that made the old questions guessable.

  2. Do questions of ANY format point at something they never name? "Once you
     know the two lines are equal" names its book and its author and is still
     unanswerable a year later. This counts the stems that do it.

  The numbers, printed on every run:

    compliance   true/false rows that came back as a pair at all. Below 1.0
                 means questions are being dropped at parse time.
    word gap     mean |claim - distortion| in words. A model that pads its true
                 statements with detail shows up here first.
    compound     claims carrying more than one assertion. These read true
                 whatever they say.
    negations    distortions built by negating the claim — the cheapest
                 distortion to write and the easiest to spot.
    dangling     stems, all formats, pointing at an unnamed "the" something.
                 The offenders are printed so the wording can be tuned against
                 real ones rather than imagined ones.
*/

const apiKey = process.env.QUIZBOT_EVAL_KEY;
const evaluate = apiKey ? describe : describe.skip;

/** Enough notes to see a pattern, few enough to be a cheap run. */
const NOTES = [CIVIL_WAR, ANCHORING, FORT_SUMTER];

type Pair = { claim: string; distortion: string };

const words = (text: string): number => text.trim().split(/\s+/).length;

/** Rough, and deliberately so: a stem with two assertions bolted together. */
const isCompound = (claim: string): boolean =>
  / and | while | as well as |, which |; /.test(claim) && words(claim) > 18;

const NEGATED = /\b(did not|was not|were not|never|no longer|failed to)\b/i;

const isNegation = (claim: string, distortion: string): boolean =>
  NEGATED.test(distortion) && !NEGATED.test(claim);

/*
  A reference the reader can only resolve with the page in front of them.

  Kept to phrases that are damning on their own: "the study" and "the second
  group" identify nothing without the note, whereas "the war" or "the treaty"
  are usually pinned by the rest of the stem. Undercounting is the right way to
  be wrong here — a metric that fires on good questions gets ignored.
*/
const DANGLING =
  /\bthe (study|experiment|two lines|second group|first group|third group|first argument|second argument|author's|passage|example|diagram|figure|chart|table|section)\b/i;

evaluate('questions, as a real model writes them', () => {
  it('name what they ask about, and pair their true/false statements', async () => {
    const provider = getLlmProvider('anthropic');
    const model = process.env.QUIZBOT_EVAL_MODEL ?? provider.defaultModel;

    const rows: Record<string, unknown>[] = [];
    for (const fixture of NOTES) {
      const note = parseNote(fixture.content, noteStem(fixture.path));
      const completion = await provider.complete({
        apiKey: apiKey as string,
        model,
        system: buildSystemPrompt(),
        user: buildUserPrompt(note, 15, noteStem(fixture.path)),
        maxTokens: 16_000,
        json: true,
      });

      const parsed = extractJson(completion.text) as { questions?: unknown[] } | undefined;
      for (const raw of parsed?.questions ?? []) rows.push(raw as Record<string, unknown>);
    }

    /* Every stem a reader could meet, whatever format produced it. */
    const stems = rows.flatMap((row) =>
      [row.prompt, row.claim, row.distortion, row.sentence].filter(
        (value): value is string => typeof value === 'string',
      ),
    );
    const dangling = stems.filter((stem) => DANGLING.test(stem));

    const trueFalse = rows.filter((row) => row.format === 'true-false');
    const paired = trueFalse.filter(
      (row): row is Record<string, unknown> & Pair =>
        typeof row.claim === 'string' && typeof row.distortion === 'string',
    );

    const compliance = trueFalse.length === 0 ? 1 : paired.length / trueFalse.length;
    const gaps = paired.map((row) => Math.abs(words(row.claim) - words(row.distortion)));
    const meanGap = gaps.length === 0 ? 0 : gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const compound = paired.filter((row) => isCompound(row.claim)).length;
    const negations = paired.filter((row) => isNegation(row.claim, row.distortion)).length;

    /* eslint-disable no-console */
    console.log(
      [
        `model       ${model}`,
        `questions   ${rows.length} across ${NOTES.length} notes, ${trueFalse.length} true/false`,
        `compliance  ${compliance.toFixed(2)}`,
        `word gap    ${meanGap.toFixed(1)} (max ${Math.max(0, ...gaps)})`,
        `compound    ${compound}/${paired.length}`,
        `negations   ${negations}/${paired.length}`,
        `dangling    ${dangling.length}/${stems.length}`,
        '',
        ...dangling.map((stem) => `  unnamed     ${stem}`),
        ...paired.slice(0, 3).flatMap((row) => [`  claim       ${row.claim}`, `  distortion  ${row.distortion}`, '']),
      ].join('\n'),
    );
    /* eslint-enable no-console */

    expect(compliance).toBeGreaterThanOrEqual(0.9);
    // Four words of difference is about where a reader starts to notice that
    // one statement carries more detail than the other.
    expect(meanGap).toBeLessThanOrEqual(4);
    expect(compound / Math.max(1, paired.length)).toBeLessThanOrEqual(0.2);
    expect(negations / Math.max(1, paired.length)).toBeLessThanOrEqual(0.2);
    // This one is a hard zero: a stem nobody can resolve is not a weak
    // question, it is an unanswerable one.
    expect(dangling).toEqual([]);
  }, 300_000);
});
