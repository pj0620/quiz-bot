import { addDays } from '../../lib/day';
import { toAppError } from '../../lib/errors';
import { forEachInPool } from '../../lib/pool';
import { hashString, seededInt, seededPick, seededShuffle } from '../../lib/random';
import {
  claimsOf,
  isQuizzable,
  parseNote,
  sectionText,
  type NoteSection,
  type ParsedNote,
} from '../../notes/parse';
import { isNotePath, noteFilename, noteStem } from '../../notes/paths';
import { topicsForNote } from './noteTopics';
import { folderOf } from './selectNotes';
import type {
  Difficulty,
  FillBlankQuestion,
  ListRecallQuestion,
  MultipleChoiceQuestion,
  Question,
  QuestionBase,
  QuestionFormat,
  ShortAnswerQuestion,
  TimelineQuestion,
  TrueFalseQuestion,
} from '../types';
import { MAX_EVENTS, MIN_EVENTS } from '../questionTypes/timeline';
import type { GenerationInput, GenerationResult, PlannedNote, QuestionGenerator } from './contract';

/**
 * Stand-in for LLM generation, over markdown study notes.
 *
 * Every question is built from text that is actually in the note: a real list
 * of advantages, a real sentence about Kentucky, a real term and its real
 * definition. Only the framing around it is fabricated. That's what makes it
 * useful as a design stand-in — the screens get laid out against the lengths,
 * topics and phrasing a real generator will produce, so nothing collapses when
 * one is swapped in.
 *
 * Two rules keep it honest:
 *
 *  - A builder RETURNS NULL when the material doesn't suit it. A section of
 *    flowing prose has no list to recall, and inventing one would be worse than
 *    producing fewer questions.
 *  - Sections whose content was only a screenshot are skipped entirely. The
 *    parser counts those embeds precisely so this can happen.
 */

/** Spread generated questions across this window so date rules are demonstrable. */
const BACKDATE_WINDOW_DAYS = 21;

/**
 * Ages are dealt out ACROSS the window by position rather than drawn
 * independently per note.
 *
 * Drawing independently means a vault with only a handful of notes can put
 * every one of them outside the "last 7 days" band by chance — roughly a one in
 * eleven run with six notes. When that happens the Daily quiz, which is the hero
 * card on the home screen, offers nothing and the app looks broken. Dealing by
 * position guarantees the recent band is always populated.
 */
function backdateDays(index: number, total: number): number {
  if (total <= 1) return 0;
  return Math.floor((index * BACKDATE_WINDOW_DAYS) / total);
}

const DIFFICULTIES: Difficulty[] = ['intro', 'core', 'deep'];

/** How many entries a recall question asks for, when the list is long enough. */
const RECALL_TARGET = 3;

// ---------------------------------------------------------------------------
// Builder context
// ---------------------------------------------------------------------------

type SectionContext = {
  sourceId: string;
  path: string;
  note: ParsedNote;
  section: NoteSection;
  /** The section heading, falling back to the note's title. */
  label: string;
  /** Sentences from OTHER notes — plausible distractors, reliably wrong here. */
  foreign: readonly string[];
  seed: number;
  base: QuestionBase;
};

type Builder = (context: SectionContext) => Question | null;

function deterministicId(context: SectionContext, format: string, discriminator: string): string {
  return `q-${hashString(`${context.sourceId}|${context.path}|${context.label}|${format}|${discriminator}`).toString(36)}`;
}

/** All definition entries in a section, flattened across blocks. */
function definitionsOf(section: NoteSection) {
  return section.blocks.flatMap((block) => (block.kind === 'definitions' ? block.entries : []));
}

/** Every namable item in a section: list bullets and definition terms alike. */
function listItemsOf(section: NoteSection): string[] {
  const items: string[] = [];
  for (const block of section.blocks) {
    if (block.kind === 'list') items.push(...block.items);
    else if (block.kind === 'definitions') items.push(...block.entries.map((entry) => entry.term));
  }
  // Short, distinct phrases only — a bullet holding a whole paragraph is not a
  // thing anyone can be asked to name.
  return items.filter((item, index) => item.length <= 60 && items.indexOf(item) === index);
}


// ---------------------------------------------------------------------------
// Cloze selection
// ---------------------------------------------------------------------------

const NUMBER_TOKEN = /\b\d[\d:,.\/%x-]*\b/;
const PROPER_NOUN = /\b[A-Z][a-zA-Z]{3,}\b/;
const LONG_WORD = /\b[\w-]{8,}\b/g;

type Cloze = { template: string; answer: string };

function blankAt(sentence: string, target: string, at: number): Cloze {
  return {
    template: `${sentence.slice(0, at)}{{a}}${sentence.slice(at + target.length)}`,
    answer: target,
  };
}

/**
 * Chooses what to blank out of a sentence.
 *
 * Ordered by how much recalling it actually proves: a figure ("5:2", "1861") is
 * the hardest and most specific thing to remember, a proper noun next, and a
 * long content word last. Anything shorter than that makes a blank you can
 * guess from grammar alone, so it gives up instead.
 */
export function chooseCloze(sentence: string): Cloze | null {
  if (sentence.includes('{{')) return null;

  // A figure may sit anywhere, including at the start.
  const number = NUMBER_TOKEN.exec(sentence);
  if (number) return blankAt(sentence, number[0], number.index);

  /*
    Word choices skip the first word entirely.

    A capitalised sentence opener is not evidence of a proper noun, and blanking
    the leading word leaves a stub nobody can read — "{{a}} overall stayed with
    the north" gives away nothing about what is being asked.
  */
  const firstSpace = sentence.indexOf(' ');
  if (firstSpace <= 0) return null;
  const from = firstSpace + 1;
  const rest = sentence.slice(from);

  const proper = PROPER_NOUN.exec(rest);
  if (proper) return blankAt(sentence, proper[0], from + proper.index);

  let longest: { word: string; index: number } | null = null;
  // Fresh regex per call: LONG_WORD is global, so a shared lastIndex would make
  // consecutive calls disagree.
  const pattern = new RegExp(LONG_WORD.source, 'g');
  let match = pattern.exec(rest);
  while (match !== null) {
    if (!longest || match[0].length > longest.word.length) {
      longest = { word: match[0], index: match.index };
    }
    match = pattern.exec(rest);
  }
  if (longest) return blankAt(sentence, longest.word, from + longest.index);

  return null;
}

// ---------------------------------------------------------------------------
// Builders — one per format
// ---------------------------------------------------------------------------

/**
 * "1861 — Fort Sumter is shelled", and the handful of shapes people write it in.
 *
 * Anchored at the head of the bullet on purpose, and deliberately NOT
 * `NUMBER_TOKEN`, which is unanchored and would read "5:2" or "12%" as a year.
 * A leading year followed by a separator is the one chronology a regex can take
 * out of a note without inventing it.
 */
const DATED_ITEM = /^\(?(c\.\s*)?(\d{3,4})\s*(BCE?|AD)?\)?\s*[—–\-:.)]\s+(.+)$/i;

const buildTimeline: Builder = (context): TimelineQuestion | null => {
  const dated = listItemsOf(context.section).flatMap((item) => {
    const match = DATED_ITEM.exec(item);
    if (!match) return [];
    const year = Number(match[2]) * (/^BC/i.test(match[3] ?? '') ? -1 : 1);
    const dateText = `${match[1] ?? ''}${match[2]}${match[3] ? ` ${match[3]}` : ''}`.trim();
    return [{ year, dateText, label: match[4].trim() }];
  });

  if (dated.length < MIN_EVENTS) return null;

  /*
    Two bullets sharing a year cannot be ordered FROM THE NOTE, and choosing
    which goes first would be exactly the invention this generator exists not to
    do. Refusing the whole section is right: a timeline missing its ambiguous
    pair is a different question from the one the note supports.
  */
  const years = dated.map((entry) => entry.year);
  if (new Set(years).size !== years.length) return null;

  const ordered = [...dated].sort((a, b) => a.year - b.year).slice(0, MAX_EVENTS);

  return {
    ...context.base,
    id: deterministicId(context, 'timeline', ordered.map((entry) => entry.label).join('|')),
    format: 'timeline',
    prompt: `Put these ${ordered.length} events from your notes on “${context.label}” in the order they happened.`,
    explanation: ordered.map((entry) => `${entry.dateText} — ${entry.label}`).join('\n'),
    events: ordered.map((entry, index) => ({
      id: `e${index}`,
      label: entry.label,
      date: entry.dateText,
    })),
  };
};

const buildListRecall: Builder = (context): ListRecallQuestion | null => {
  const items = listItemsOf(context.section);
  if (items.length < 2) return null;

  const required = Math.min(RECALL_TARGET, items.length);
  const prompt =
    required === items.length
      ? `Your notes list ${items.length} things under “${context.label}”. Name them.`
      : `Name ${required} of the ${items.length} things your notes list under “${context.label}”.`;

  return {
    ...context.base,
    id: deterministicId(context, 'list-recall', items.join('|')),
    format: 'list-recall',
    prompt,
    explanation: `Your notes list: ${items.join(', ')}.`,
    required,
    items,
  };
};

const buildDefinitionRecall: Builder = (context): ShortAnswerQuestion | null => {
  const entries = definitionsOf(context.section).filter((entry) => entry.definition.length >= 20);
  if (entries.length === 0) return null;

  const entry = seededPick(entries, context.seed);
  if (!entry) return null;

  const prompt = `Under “${context.label}”, what do your notes say about ${entry.term}?`;
  return {
    ...context.base,
    id: deterministicId(context, 'short-answer', entry.term),
    format: 'short-answer',
    prompt,
    explanation: `${entry.term} — ${entry.definition}`,
    modelAnswer: entry.definition,
  };
};

const buildCloze: Builder = (context): FillBlankQuestion | null => {
  // A definition is the best cloze material in a note: short, self-contained,
  // and with exactly one thing in it worth remembering.
  const definitions = definitionsOf(context.section).filter((entry) => entry.definition.length >= 20);
  const candidates = [
    ...definitions.map((entry) => `${entry.term} — ${entry.definition}`),
    ...claimsOf(context.section),
  ];

  for (const candidate of seededShuffle(candidates, context.seed)) {
    const cloze = chooseCloze(candidate);
    if (!cloze) continue;

    return {
      ...context.base,
      id: deterministicId(context, 'fill-blank', candidate),
      format: 'fill-blank',
      prompt: `Fill in the gap from your notes on “${context.label}”.`,
      explanation: candidate,
      template: cloze.template,
      blanks: [{ id: 'a', accepted: [cloze.answer] }],
    };
  }

  return null;
};

const buildMultipleChoice: Builder = (context): MultipleChoiceQuestion | null => {
  const claims = claimsOf(context.section);
  if (claims.length === 0 || context.foreign.length < 3) return null;

  const correct = seededPick(claims, context.seed);
  if (!correct) return null;

  // Distractors come from OTHER notes in the same vault. They read like the
  // user's own writing on the user's own subjects, which makes them far harder
  // to eliminate on style alone than invented filler would be.
  const distractors = seededShuffle(
    context.foreign.filter((sentence) => !claims.includes(sentence)),
    context.seed,
  ).slice(0, 3);
  if (distractors.length < 3) return null;

  const choices = seededShuffle([correct, ...distractors], context.seed + 1).map((text, index) => ({
    id: `c${index}`,
    text,
  }));

  return {
    ...context.base,
    id: deterministicId(context, 'multiple-choice', correct),
    format: 'multiple-choice',
    prompt: `Which of these is from your notes on “${context.label}”?`,
    explanation: `“${correct}” appears under ${context.label}. The others are from different notes.`,
    choices,
    correctChoiceId: choices.find((choice) => choice.text === correct)?.id ?? choices[0].id,
  };
};

const buildTrueFalse: Builder = (context): TrueFalseQuestion | null => {
  const claims = claimsOf(context.section);
  if (claims.length === 0) return null;

  // Half the time quote this section, half the time quote a different note.
  // Both are verbatim, so the answer is always defensible — which a naively
  // negated sentence ("Kentucky did NOT stay with the north") would not be.
  const useForeign = seededInt(context.seed, 0, 1) === 1 && context.foreign.length > 0;
  const quote = useForeign
    ? seededPick(context.foreign.filter((sentence) => !claims.includes(sentence)), context.seed)
    : seededPick(claims, context.seed);
  if (!quote) return null;

  return {
    ...context.base,
    id: deterministicId(context, 'true-false', quote),
    format: 'true-false',
    prompt: `True or false: your notes on “${context.label}” say “${quote}”`,
    explanation: useForeign
      ? `That line is from a different note, not from ${context.label}.`
      : `That is what your notes say under ${context.label}.`,
    correct: !useForeign,
  };
};

/**
 * Every builder runs; a section keeps at most one STRUCTURAL question plus a
 * random draw from the rest. See the selection loop for why that beats taking
 * them in priority order.
 */
const BUILDERS: Builder[] = [
  buildTimeline,
  buildListRecall,
  buildCloze,
  buildDefinitionRecall,
  buildMultipleChoice,
  buildTrueFalse,
];

/**
 * Formats that exploit a section's structure rather than its prose, in
 * preference order — at most ONE is taken per section.
 *
 * A dated list satisfies both of these, and "put these in order" is the better
 * question for it. Asking one list to be both named and ordered in the same
 * section is one question too many about one list.
 */
const STRUCTURAL_FORMATS: QuestionFormat[] = ['timeline', 'list-recall'];

/** At most this many questions from one section, so one long note can't dominate. */
const MAX_PER_SECTION = 2;

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

type LoadedNote = { path: string; note: ParsedNote; topics: string[] };

export const noteGenerator: QuestionGenerator = {
  name: 'notes-mock',

  async generate(input: GenerationInput): Promise<GenerationResult> {
    const { source, provider, targetQuestions, maxNotes, folders, existingIds, onNote, signal } = input;
    const now = input.now ?? Date.now();

    const listing = await provider.listFiles(source, signal);
    const allNotes = listing.files.filter((file) => isNotePath(file.path));
    const notePaths = allNotes
      .filter((file) => !folders?.length || folders.includes(folderOf(file.path) ?? ''))
      .map((file) => file.path);

    if (notePaths.length === 0) {
      return { questions: [], notesScanned: 0, notesAvailable: allNotes.length, revision: listing.revision };
    }

    /*
      Deliberately does NOT consult the coverage ledger.

      The mock's prompts are templated, so its ids are genuinely deterministic
      and re-running it is already a no-op — it has no duplicate problem to
      solve. More importantly, letting it record coverage would mark notes as
      done and cause the LLM generator to skip material it has never seen.
    */
    const ordered = seededShuffle(notePaths, hashString(source.id)).slice(0, maxNotes);

    const planned: PlannedNote[] = ordered.map((path) => ({
      sourceId: source.id,
      path,
      noteTitle: noteFilename(path),
    }));
    input.onPlan?.(planned);

    /*
      Two passes.

      Everything is parsed before anything is generated, because the multiple-
      choice and true/false builders need sentences from OTHER notes. Distractors
      drawn from the same vault are the difference between a plausible wrong
      answer and obvious filler.
    */

    /*
      Written by index rather than pushed.

      Reads run several at a time, so arrival order is whatever the network
      decides — but position in this array feeds `backdateDays`, which spreads
      generated questions across a window so the Daily quiz has something to
      show. Appending as replies land would make that spread differ run to run
      for the same vault.
    */
    const slots: (LoadedNote | null)[] = new Array(ordered.length).fill(null);
    const unreadable: { path: string; error: ReturnType<typeof toAppError> }[] = [];

    await forEachInPool(
      ordered,
      input.concurrency ?? 1,
      async (path, index) => {
        input.onNoteStart?.(planned[index]);
        try {
          // Pinned to the revision we listed at, so content and hash agree.
          const content = await provider.readFile(source, path, { ref: listing.revision, signal });
          const note = parseNote(content, noteStem(path));
          slots[index] = { path, note, topics: topicsForNote(note, path) };
        } catch (error) {
          // A single unreadable note shouldn't abort a generation run — but it
          // still has to be reported, or its row waits for a result that is
          // never coming.
          if (!signal?.aborted) unreadable.push({ path, error: toAppError(error) });
        }
      },
      { stop: () => signal?.aborted === true },
    );

    const loaded: LoadedNote[] = slots.filter((entry): entry is LoadedNote => entry !== null);

    for (const failure of unreadable) {
      onNote?.({
        path: failure.path,
        noteTitle: noteFilename(failure.path),
        questions: [],
        error: failure.error,
      });
    }

    const sentencePool = new Map<string, string[]>();
    for (const entry of loaded) {
      sentencePool.set(
        entry.path,
        entry.note.sections.flatMap((section) => claimsOf(section)),
      );
    }
    const allSentences = Array.from(sentencePool.values()).flat();

    const questions: Question[] = [];
    const seen = new Set(existingIds ?? []);

    // Absent means no question limit — the run is bounded by how many notes it
    // was asked to read, which is the thing that actually costs anything.
    const reachedTarget = () => targetQuestions !== undefined && questions.length >= targetQuestions;

    for (const [index, entry] of loaded.entries()) {
      if (reachedTarget()) break;
      // Collected per note so `onNote` can report them, which is what drives
      // the progress list and incremental saving.
      const noteQuestions: Question[] = [];

      const own = new Set(sentencePool.get(entry.path) ?? []);
      const foreign = allSentences.filter((sentence) => !own.has(sentence));

      // Backdate across a window so "added in the last N days" has something to
      // filter on immediately, rather than every question sharing one timestamp.
      // `loaded` is already in a source-seeded shuffle, so position is arbitrary
      // and the same notes aren't always the newest.
      const addedAt = addDays(now, -backdateDays(index, loaded.length));

      for (const section of entry.note.sections) {
        if (reachedTarget()) break;
        // The screenshot case: a real heading, real structure, nothing readable.
        if (!isQuizzable(section)) continue;

        const label = section.heading ?? entry.note.title;
        const seed = hashString(`${entry.path}#${label}`);
        const excerpt = sectionText(section).slice(0, 600);

        const base: QuestionBase = {
          id: '', // replaced by each builder's deterministic id
          prompt: '',
          explanation: '',
          topics: entry.topics,
          difficulty: seededPick(DIFFICULTIES, seed) ?? 'core',
          sourceId: source.id,
          provenance: {
            sourceId: source.id,
            path: entry.path,
            revision: listing.revision,
            noteTitle: entry.note.title,
            section: section.heading ?? undefined,
            excerpt,
          },
          addedAt,
          contentAt: addedAt,
        };

        const context: SectionContext = {
          sourceId: source.id,
          path: entry.path,
          note: entry.note,
          section,
          label,
          foreign,
          seed,
          base,
        };

        /*
          Every builder is offered the section, then the picks are made from
          what actually applied.

          List-recall is privileged: it exploits structure no other format can
          reach, so a section with a real list must always be asked to recall
          it rather than getting a true/false about one of its sentences.

          Everything else is drawn at random from what applied. Taking the
          highest-priority builder every time instead makes cloze — which fits
          almost any prose — win nearly every section, and the bank comes out
          close to half fill-in-the-blank.
        */
        const candidates = BUILDERS.map((build) => build(context)).filter(
          (question): question is Question => question !== null,
        );
        const structural = STRUCTURAL_FORMATS.reduce<Question | undefined>(
          (found, format) => found ?? candidates.find((question) => question.format === format),
          undefined,
        );
        const rest = candidates.filter((question) => question !== structural);

        const chosen: Question[] = structural ? [structural] : [];
        for (const question of seededShuffle(rest, seed)) {
          if (chosen.length >= MAX_PER_SECTION) break;
          chosen.push(question);
        }

        for (const question of chosen) {
          if (reachedTarget()) break;
          // Selection happens before this check, so a note that hasn't changed
          // yields the same picks and re-polling is a genuine no-op rather than
          // a source of fresh near-duplicates.
          if (seen.has(question.id)) continue;
          seen.add(question.id);
          questions.push(question);
          noteQuestions.push(question);
        }
      }

      onNote?.({
        path: entry.path,
        noteTitle: noteFilename(entry.path),
        questions: noteQuestions,
      });
    }

    return {
      questions,
      notesScanned: loaded.length,
      notesAvailable: notePaths.length,
      revision: listing.revision,
    };
  },
};
