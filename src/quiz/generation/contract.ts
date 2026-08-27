import type { AppError } from '../../lib/errors';
import type { SourceContentProvider } from '../../sources/contract';
import type { InfoSource } from '../../sources/types';
import type { Question } from '../types';

/**
 * The seam a question generator implements.
 *
 * Everything upstream (stores, screens, scheduling) talks only to this, so
 * swapping one generator for another is a one-module change. Note it takes a
 * `SourceContentProvider` rather than reaching for GitHub directly — that's
 * what will let a future "books" source produce questions with no new plumbing.
 *
 * The unit throughout is a NOTE, not a file. A source that isn't a pile of
 * markdown has nothing to say to this interface.
 */

/**
 * A note a run intends to read, named before any of it is read.
 *
 * The whole list is handed over up front so progress can be shown as the work
 * itself — every note by name, each with its own state — rather than as a
 * count of things that have already happened. "3 of 10 notes" tells you nothing
 * about what is being worked on or what is left.
 */
export type PlannedNote = {
  sourceId: string;
  path: string;
  /** The vault filename, verbatim and unshortened. */
  noteTitle: string;
};

/**
 * Emitted after each note, before the run has finished.
 *
 * Exists because generation now costs money per note. Returning everything at
 * the end would mean a cancelled run throws away work already paid for, and
 * would leave the user staring at a spinner with no idea how far along it is.
 * The generator only reports — saving and progress belong to the caller, which
 * keeps generators free of stores and testable with a fake provider.
 */
export type NoteGenerationEvent = {
  path: string;
  noteTitle: string;
  /** Provider content marker, recorded so the note isn't re-read unchanged. */
  contentHash?: string;
  questions: Question[];
  usage?: { inputTokens: number; outputTokens: number };
  /**
   * Requests this note actually cost. Usually 1.
   *
   * A long note is split across several, so "notes read" stopped being a proxy
   * for "requests paid for" — this is what keeps the cost of that visible.
   */
  modelCalls?: number;
  /** Set when this note failed. The run continues regardless. */
  error?: AppError;
};

export type GenerationInput = {
  source: InfoSource;
  provider: SourceContentProvider;
  /**
   * Stop once this many questions have been produced. Absent means no limit.
   *
   * Demoted from the primary budget to an optional guard. It only made sense
   * while every note yielded a fixed five — now that a note yields as many
   * questions as its material is worth, a question total says nothing useful
   * about how much work or money a run represents. `maxNotes` does.
   */
  targetQuestions?: number;
  /**
   * How many notes to read. The budget, and the cost guard.
   *
   * Notes are the unit that costs money: each is at least one model request,
   * and a long one is several. Everything else about a run follows from this.
   */
  maxNotes: number;
  /** Restrict to these top-level folders. Empty/absent = the whole vault. */
  folders?: string[];
  /**
   * Notes to work on at once. Defaults to 1.
   *
   * The default is deliberately sequential. Every caller that wants parallelism
   * asks for it, which keeps a generator's behaviour under test identical to
   * what it was — ordering, event counts and how far a fatal error gets are all
   * things concurrency changes.
   */
  concurrency?: number;
  /** Ids already in the bank, so a generator can skip re-deriving them. */
  existingIds?: ReadonlySet<string>;
  /**
   * The notes this run selected, emitted once before any of them is read.
   *
   * Selection happens inside the generator — it consults the coverage ledger,
   * applies the folder filter and the cap — so this is the only way a caller can
   * name the work in advance rather than discovering it one note at a time.
   */
  onPlan?: (notes: PlannedNote[]) => void;
  /** A note has been claimed and is being worked on. */
  onNoteStart?: (note: PlannedNote) => void;
  onNote?: (event: NoteGenerationEvent) => void;
  signal?: AbortSignal;
  now?: number;
};

export type GenerationResult = {
  questions: Question[];
  /** Notes actually read — surfaced in the UI so the run feels concrete. */
  notesScanned: number;
  /**
   * Notes the source holds in total, before any filtering or per-run cap.
   *
   * Distinct from `notesScanned` so the UI can tell "your repository has no
   * markdown in it" apart from "there was nothing new in the notes I read" —
   * the first is a user error worth naming, the second is a normal outcome.
   */
  notesAvailable: number;
  /** Notes skipped because they were already covered at this exact version. */
  notesCovered?: number;
  usage?: { inputTokens: number; outputTokens: number };
  /** Provider revision at generation time (a commit SHA for Git). */
  revision?: string;
};

export type QuestionGenerator = {
  name: string;
  /**
   * Whether this generator's runs should be recorded in the coverage ledger.
   *
   * Must match whether it CONSULTS coverage. The mock does neither: it re-reads
   * everything every time and its deterministic ids make that harmless — but if
   * its runs were recorded, the LLM generator would then skip notes it has
   * never seen, and the material would be silently lost.
   */
  tracksCoverage?: boolean;
  generate(input: GenerationInput): Promise<GenerationResult>;
};
