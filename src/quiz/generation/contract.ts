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
  /** Set when this note failed. The run continues regardless. */
  error?: AppError;
};

export type GenerationInput = {
  source: InfoSource;
  provider: SourceContentProvider;
  /**
   * Stop once this many questions have been produced.
   *
   * The primary budget: someone wants "enough questions", not "N notes read".
   */
  targetQuestions: number;
  /**
   * Hard ceiling on notes read, whatever the target.
   *
   * The cost guard. Each note is one provider request plus one model call, so
   * without this a high target over short notes could run for a long time and
   * spend real money.
   */
  maxNotes: number;
  /** Restrict to these top-level folders. Empty/absent = the whole vault. */
  folders?: string[];
  /** Ids already in the bank, so a generator can skip re-deriving them. */
  existingIds?: ReadonlySet<string>;
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
