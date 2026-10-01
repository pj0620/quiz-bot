import { isKnownFormat, isValidQuestion } from '../questionTypes/registry';
import type { NoteStatus, RunNote } from '../generation/runStore';
import type { Question, QuestionFormat } from '../types';

/**
 * Quiz plans: a quiz designed in conversation with the model, then written in
 * batches the reader reviews.
 *
 * A plan is a RECIPE, not a container. It says which notes to draw on and what
 * the questions should go after; the questions it writes are ordinary bank
 * questions carrying a `planId` tag, and the quiz it produces is an ordinary
 * rule (`QuizRule.planIds`). So the player, the SRS, the bank browser and the
 * stats all handle plan questions with no new machinery — the same decision
 * vocabulary and prompt questions were built on.
 *
 * Three things here are load-bearing and easy to lose in a later edit:
 *
 *  - The WORKING plan and the ACCEPTED plan are kept apart. The model proposes
 *    a new version on every chat turn, and the reader agreeing to one is the
 *    whole point of the flow — so generation only ever follows `accepted`, and
 *    a proposal sitting in `spec` changes nothing until it is accepted.
 *
 *  - A batch's questions are DRAFTS until the reader keeps them. They live on
 *    the batch, not in the bank, so nothing half-reviewed is quizzable, counted
 *    by the Library, or scheduled by the SRS. Keeping a batch moves its drafts
 *    into the bank and leaves only their ids behind.
 *
 *  - `seen` is what makes "a new note appeared" answerable. Every note in
 *    scope when a plan is accepted is backlog, not news; only a note that turns
 *    up (or changes) AFTER that baseline is fresh material worth writing
 *    questions for unprompted.
 */

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * The formats a plan may ask for: everything the note writer can produce.
 * `map-locate` is absent because its answer is a region id from a generated
 * table, which no note-reading model can name — see `toModelRow`.
 */
export const PLAN_FORMATS: readonly QuestionFormat[] = [
  'multiple-choice',
  'true-false',
  'short-answer',
  'list-recall',
  'fill-blank',
  'timeline',
];

export const MIN_QUESTIONS_PER_NOTE = 1;
export const MAX_QUESTIONS_PER_NOTE = 12;
export const DEFAULT_QUESTIONS_PER_NOTE = 5;

/** What a review round holds. The reader can raise it once they trust the plan. */
export const BATCH_SIZE_CHOICES = [5, 10, 20, 50, 100] as const;
export const DEFAULT_BATCH_SIZE = 10;
/** Upper bound on any one batch — "all remaining" is clamped to this too. */
export const MAX_BATCH_SIZE = 200;

/** A sample is a taste of the plan, not a batch: small, and spread across notes. */
export const SAMPLE_SIZE = 5;

/** How many times each note may be read under one plan. */
export const DEPTH_CHOICES = [1, 2, 3] as const;

/** Text bounds. Everything here rides in a prompt, so everything is capped. */
export const MAX_TITLE_CHARS = 80;
export const MAX_SUMMARY_CHARS = 400;
export const MAX_BULLET_CHARS = 160;
export const MAX_BULLETS = 8;
export const MAX_STYLE_CHARS = 400;
export const MAX_TERMS = 8;
export const MAX_TERM_CHARS = 60;
export const MAX_REQUEST_CHARS = 1_000;
export const MAX_MESSAGE_CHARS = 2_000;
export const MAX_FEEDBACK_NOTE_CHARS = 500;

/** Bounds on what a plan keeps, so one long-lived plan cannot bloat storage. */
export const MAX_STORED_MESSAGES = 120;
export const MAX_STORED_BATCHES = 60;

// ---------------------------------------------------------------------------
// The plan itself
// ---------------------------------------------------------------------------

/**
 * Which notes a plan reads. A RULE, evaluated against the live listing, rather
 * than a list of paths — which is what lets a note written next week join the
 * plan without anyone editing it. See `scope.ts`.
 */
export type PlanScope = {
  /** Connected sources to read from. Empty = every source. */
  sourceIds: string[];
  /**
   * Phrases matched against each note's path, ANY of them. Empty = every note.
   * "Thinking Fast and Slow" picks out a whole series of vault filenames.
   */
  terms: string[];
  /** Phrases that rule a note out even when a term matched it. */
  excludeTerms: string[];
  /** Top-level folders to restrict to. Empty = everywhere. */
  folders: string[];
  /** Note keys (`sourceId:path`) the reader ticked in by hand. Always in scope. */
  include: string[];
  /** Note keys the reader ticked out by hand. Never in scope. */
  exclude: string[];
};

export type PlanDifficulty = 'gentle' | 'mixed' | 'challenging';

export const PLAN_DIFFICULTIES: readonly PlanDifficulty[] = ['gentle', 'mixed', 'challenging'];

/** One version of a plan: everything the writer is told, and nothing else. */
export type PlanSpec = {
  /** Increases on every change, whoever made it. */
  version: number;
  title: string;
  /** A sentence or two, in plain words, of what this quiz is for. */
  summary: string;
  scope: PlanScope;
  /** What the questions should go after. */
  focus: string[];
  /** What the questions should leave alone. */
  avoid: string[];
  /** Formats to use. Empty = whatever suits the material. */
  formats: QuestionFormat[];
  difficulty: PlanDifficulty;
  /** How many questions one note is worth, per pass — the plan's density. */
  questionsPerNote: number;
  /** Anything else about tone or style, in the reader's words. */
  style: string;
  /** Who made this version — shown so a hand edit is never mistaken for the model's. */
  author: 'ai' | 'user';
  updatedAt: number;
};

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

/**
 * `event` is the app talking: "You accepted plan v2", "Batch 1: kept 9". Kept in
 * the conversation rather than a separate log because the PLANNER reads it —
 * knowing a batch was just kept with no complaints is context for its next
 * suggestion, exactly as it would be for a person.
 */
export type PlanMessageRole = 'user' | 'assistant' | 'event';

export type PlanMessage = {
  id: string;
  role: PlanMessageRole;
  text: string;
  at: number;
  /** On an assistant message that changed the plan: the version it produced. */
  planVersion?: number;
  /** A review's feedback, sent to the planner — rendered as a digest, not a bubble. */
  kind?: 'feedback';
};

// ---------------------------------------------------------------------------
// Batches and review
// ---------------------------------------------------------------------------

/**
 * Quick reasons, so most feedback is a tap rather than typing on a phone.
 * Each carries the instruction it turns into — see `feedback.ts`.
 */
export type FeedbackTag =
  | 'too-easy'
  | 'too-hard'
  | 'trivia'
  | 'unclear'
  | 'wrong'
  | 'repeat'
  | 'format';

export const FEEDBACK_TAG_IDS: readonly FeedbackTag[] = [
  'too-easy',
  'too-hard',
  'trivia',
  'unclear',
  'wrong',
  'repeat',
  'format',
];

/**
 * What the reader decided about one draft. Absent means not looked at yet,
 * which counts as KEEP: a reader who skims nine fine questions and flags one
 * should not have to tick the nine.
 */
export type DraftVerdict = 'keep' | 'fix' | 'drop';

export type DraftReview = {
  verdict?: DraftVerdict;
  tags: FeedbackTag[];
  note: string;
  /** Set once a fix has been applied: the prompt it replaced. */
  revisedFrom?: string;
  /** The last attempt to fix this one failed, and why. */
  error?: string;
};

/**
 * `sample` is the taste shown before batches start. `new-notes` is written for
 * notes that turned up after the plan was accepted. Both are reviewed exactly
 * like a batch — the kind changes labels and note selection, never the rules.
 */
export type BatchKind = 'sample' | 'batch' | 'new-notes';

/**
 * `fixing` is a review in progress whose flagged drafts are being rewritten.
 * `accepted` and `discarded` are final; `failed` produced nothing usable.
 */
export type BatchStatus = 'generating' | 'review' | 'fixing' | 'accepted' | 'discarded' | 'failed';

export type PlanBatch = {
  id: string;
  /** Sequential across a plan's batches of every kind. */
  number: number;
  kind: BatchKind;
  status: BatchStatus;
  /** Questions asked for. The real count follows what the notes held. */
  requested: number;
  /** The accepted plan version this batch was written under. */
  specVersion: number;
  createdAt: number;
  settledAt?: number;
  /** Questions awaiting review. Emptied when the batch is kept or discarded. */
  drafts: Question[];
  reviews: Record<string, DraftReview>;
  /** Ids that went into the bank when the batch was kept. */
  acceptedIds: string[];
  /** Drafts left out when the batch was kept. */
  discarded: number;
  /** Per-note progress, rendered by `RunNoteRow` unchanged. */
  notes: RunNote[];
  usage: { inputTokens: number; outputTokens: number };
  /** Why the batch failed or stopped early, in words for the reader. */
  error?: string;
  /** Kept automatically because the plan runs on autopilot. */
  autoAccepted?: boolean;
};

// ---------------------------------------------------------------------------
// Coverage — what this plan has already read
// ---------------------------------------------------------------------------

/**
 * Per plan, per note. Deliberately separate from the Library's coverage ledger:
 * a note the Library has covered is still unread as far as a plan is concerned,
 * because the plan asks different questions of it.
 */
export type PlanNoteCoverage = {
  /** Content marker when last read — a Git blob SHA. */
  contentHash?: string;
  /** Times this note has been read under the plan. Compared against `depth`. */
  passes: number;
  /** Questions written from it, across passes. */
  questionCount: number;
  lastAt: number;
  /** Consecutive failures. A note failing this often is left alone. */
  failures?: number;
};

/** A note failing this many times running under one plan is skipped. */
export const MAX_NOTE_FAILURES = 3;

// ---------------------------------------------------------------------------
// The plan record
// ---------------------------------------------------------------------------

/**
 * `review` holds every batch for the reader; `autopilot` keeps batches straight
 * into the bank — "let it go free", once the reader trusts the plan. Samples
 * are reviewed either way: they are the gate, not a batch.
 */
export type PlanMode = 'review' | 'autopilot';

export type PlanSettings = {
  batchSize: number;
  mode: PlanMode;
  /** Write questions for new notes as soon as they are noticed. */
  autoNewNotes: boolean;
  /** How many times each note may be read. 1 covers everything once. */
  depth: number;
};

export type QuizPlan = {
  id: string;
  createdAt: number;
  updatedAt: number;
  /** The reader's opening message, verbatim — what this plan was for. */
  request: string;
  /** The working plan: the model's latest proposal, or the reader's edit. */
  spec: PlanSpec | null;
  /** What generation follows. Null until the reader first agrees a plan. */
  accepted: PlanSpec | null;
  messages: PlanMessage[];
  batches: PlanBatch[];
  /** Keyed by `coverageKey(sourceId, path)`. */
  coverage: Record<string, PlanNoteCoverage>;
  /**
   * Notes acknowledged as part of the plan, keyed like `coverage`, valued by
   * the content hash at the time ('' when the source gave none). See the note
   * at the top of this file.
   */
  seen: Record<string, string>;
  /** When `seen` was first filled in. Absent means nothing has been baselined. */
  baselinedAt?: number;
  settings: PlanSettings;
  /** The quiz this plan feeds, once it has questions. */
  quizId?: string;
  /** Tokens spent by the planner itself — batches carry their own. */
  plannerUsage: { inputTokens: number; outputTokens: number };
};

// ---------------------------------------------------------------------------
// Constructors and guards
// ---------------------------------------------------------------------------

export function emptyScope(): PlanScope {
  return { sourceIds: [], terms: [], excludeTerms: [], folders: [], include: [], exclude: [] };
}

export function defaultSettings(): PlanSettings {
  return { batchSize: DEFAULT_BATCH_SIZE, mode: 'review', autoNewNotes: true, depth: 1 };
}

export function emptyUsage(): { inputTokens: number; outputTokens: number } {
  return { inputTokens: 0, outputTokens: 0 };
}

export function clampQuestionsPerNote(value: unknown): number {
  const parsed = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_QUESTIONS_PER_NOTE;
  return Math.min(MAX_QUESTIONS_PER_NOTE, Math.max(MIN_QUESTIONS_PER_NOTE, parsed));
}

export function clampBatchSize(value: unknown): number {
  const parsed = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.max(1, parsed));
}

export function clampDepth(value: unknown): number {
  const parsed = typeof value === 'number' ? Math.round(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(DEPTH_CHOICES[DEPTH_CHOICES.length - 1], Math.max(1, parsed));
}

export function isPlanFormat(value: unknown): value is QuestionFormat {
  return isKnownFormat(value) && PLAN_FORMATS.includes(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isUsage(value: unknown): value is { inputTokens: number; outputTokens: number } {
  if (!value || typeof value !== 'object') return false;
  const usage = value as { inputTokens?: unknown; outputTokens?: unknown };
  return typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number';
}

export function isValidScope(value: unknown): value is PlanScope {
  if (!value || typeof value !== 'object') return false;
  const scope = value as Partial<PlanScope>;
  return (
    isStringArray(scope.sourceIds) &&
    isStringArray(scope.terms) &&
    isStringArray(scope.excludeTerms) &&
    isStringArray(scope.folders) &&
    isStringArray(scope.include) &&
    isStringArray(scope.exclude)
  );
}

export function isValidSpec(value: unknown): value is PlanSpec {
  if (!value || typeof value !== 'object') return false;
  const spec = value as Partial<PlanSpec>;
  return (
    typeof spec.version === 'number' &&
    typeof spec.title === 'string' &&
    typeof spec.summary === 'string' &&
    isValidScope(spec.scope) &&
    isStringArray(spec.focus) &&
    isStringArray(spec.avoid) &&
    Array.isArray(spec.formats) &&
    spec.formats.every(isPlanFormat) &&
    PLAN_DIFFICULTIES.includes(spec.difficulty as PlanDifficulty) &&
    typeof spec.questionsPerNote === 'number' &&
    typeof spec.style === 'string' &&
    (spec.author === 'ai' || spec.author === 'user') &&
    typeof spec.updatedAt === 'number'
  );
}

/**
 * A plan row survives loading if its identity and the parts every screen reads
 * are sound. Everything finer-grained — a malformed message, a draft that no
 * longer validates — is repaired by `normalizePlan` rather than costing the
 * reader the whole plan and its conversation.
 */
export function isValidPlan(value: unknown): value is QuizPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<QuizPlan>;
  return (
    typeof plan.id === 'string' &&
    plan.id.length > 0 &&
    typeof plan.createdAt === 'number' &&
    typeof plan.updatedAt === 'number' &&
    typeof plan.request === 'string' &&
    (plan.spec === null || isValidSpec(plan.spec)) &&
    (plan.accepted === null || isValidSpec(plan.accepted)) &&
    Array.isArray(plan.messages) &&
    Array.isArray(plan.batches) &&
    !!plan.coverage &&
    typeof plan.coverage === 'object' &&
    !!plan.settings &&
    typeof plan.settings === 'object'
  );
}

const NOTE_STATUSES: readonly NoteStatus[] = ['pending', 'running', 'done', 'failed', 'skipped'];
const BATCH_STATUSES: readonly BatchStatus[] = [
  'generating',
  'review',
  'fixing',
  'accepted',
  'discarded',
  'failed',
];
const BATCH_KINDS: readonly BatchKind[] = ['sample', 'batch', 'new-notes'];
const VERDICTS: readonly DraftVerdict[] = ['keep', 'fix', 'drop'];

function normalizeMessage(value: unknown): PlanMessage | null {
  if (!value || typeof value !== 'object') return null;
  const message = value as Partial<PlanMessage>;
  if (typeof message.id !== 'string' || typeof message.text !== 'string') return null;
  if (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'event') return null;
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    at: typeof message.at === 'number' ? message.at : 0,
    ...(typeof message.planVersion === 'number' ? { planVersion: message.planVersion } : {}),
    ...(message.kind === 'feedback' ? { kind: 'feedback' as const } : {}),
  };
}

function normalizeReview(value: unknown): DraftReview {
  const review = (value && typeof value === 'object' ? value : {}) as Partial<DraftReview>;
  return {
    ...(VERDICTS.includes(review.verdict as DraftVerdict) ? { verdict: review.verdict } : {}),
    tags: Array.isArray(review.tags)
      ? review.tags.filter((tag): tag is FeedbackTag => FEEDBACK_TAG_IDS.includes(tag as FeedbackTag))
      : [],
    note: typeof review.note === 'string' ? review.note : '',
    ...(typeof review.revisedFrom === 'string' ? { revisedFrom: review.revisedFrom } : {}),
    ...(typeof review.error === 'string' ? { error: review.error } : {}),
  };
}

function normalizeRunNote(value: unknown): RunNote | null {
  if (!value || typeof value !== 'object') return null;
  const note = value as Partial<RunNote>;
  if (typeof note.key !== 'string' || typeof note.title !== 'string') return null;
  return {
    key: note.key,
    title: note.title,
    status: NOTE_STATUSES.includes(note.status as NoteStatus) ? (note.status as NoteStatus) : 'skipped',
    questionCount: typeof note.questionCount === 'number' ? note.questionCount : 0,
    ...(typeof note.error === 'string' ? { error: note.error } : {}),
  };
}

/**
 * Brings a batch back to a state the app can act on after a cold launch.
 *
 * `generating` and `fixing` describe work in flight, and nothing is in flight
 * after a launch — the app was killed or updated mid-run. Left alone, the
 * screen would show a spinner that never resolves and lock the plan against
 * every other action. Drafts written before the interruption were saved note
 * by note, so they are kept and offered for review; only a batch with nothing
 * to show for itself is marked failed.
 */
function normalizeBatch(value: unknown): PlanBatch | null {
  if (!value || typeof value !== 'object') return null;
  const batch = value as Partial<PlanBatch>;
  if (typeof batch.id !== 'string' || !BATCH_KINDS.includes(batch.kind as BatchKind)) return null;

  const drafts = Array.isArray(batch.drafts) ? batch.drafts.filter(isValidQuestion) : [];
  const reviews: Record<string, DraftReview> = {};
  if (batch.reviews && typeof batch.reviews === 'object') {
    for (const [id, review] of Object.entries(batch.reviews)) reviews[id] = normalizeReview(review);
  }

  let status: BatchStatus = BATCH_STATUSES.includes(batch.status as BatchStatus)
    ? (batch.status as BatchStatus)
    : 'failed';
  let error = typeof batch.error === 'string' ? batch.error : undefined;
  const interrupted = status === 'generating' || status === 'fixing';
  if (interrupted) {
    status = drafts.length > 0 ? 'review' : 'failed';
    error = error ?? 'Interrupted — the app closed before this batch finished.';
  }

  const notes = (Array.isArray(batch.notes) ? batch.notes : [])
    .map(normalizeRunNote)
    .filter((note): note is RunNote => note !== null)
    // A row still "working" after a launch is a row that will never finish.
    .map((note) =>
      interrupted && (note.status === 'pending' || note.status === 'running')
        ? { ...note, status: 'skipped' as const }
        : note,
    );

  return {
    id: batch.id,
    number: typeof batch.number === 'number' ? batch.number : 0,
    kind: batch.kind as BatchKind,
    status,
    requested: typeof batch.requested === 'number' ? batch.requested : drafts.length,
    specVersion: typeof batch.specVersion === 'number' ? batch.specVersion : 0,
    createdAt: typeof batch.createdAt === 'number' ? batch.createdAt : 0,
    ...(typeof batch.settledAt === 'number' ? { settledAt: batch.settledAt } : {}),
    drafts,
    reviews,
    acceptedIds: isStringArray(batch.acceptedIds) ? batch.acceptedIds : [],
    discarded: typeof batch.discarded === 'number' ? batch.discarded : 0,
    notes,
    usage: isUsage(batch.usage) ? batch.usage : emptyUsage(),
    ...(error ? { error } : {}),
    ...(batch.autoAccepted ? { autoAccepted: true } : {}),
  };
}

function normalizeCoverage(value: unknown): Record<string, PlanNoteCoverage> {
  const result: Record<string, PlanNoteCoverage> = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<PlanNoteCoverage>;
    if (typeof entry.passes !== 'number') continue;
    result[key] = {
      ...(typeof entry.contentHash === 'string' ? { contentHash: entry.contentHash } : {}),
      passes: entry.passes,
      questionCount: typeof entry.questionCount === 'number' ? entry.questionCount : 0,
      lastAt: typeof entry.lastAt === 'number' ? entry.lastAt : 0,
      ...(typeof entry.failures === 'number' && entry.failures > 0 ? { failures: entry.failures } : {}),
    };
  }
  return result;
}

function normalizeSeen(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, hash] of Object.entries(value as Record<string, unknown>)) {
    if (typeof hash === 'string') result[key] = hash;
  }
  return result;
}

function normalizeSettings(value: unknown): PlanSettings {
  const fallback = defaultSettings();
  if (!value || typeof value !== 'object') return fallback;
  const settings = value as Partial<PlanSettings>;
  return {
    batchSize: clampBatchSize(settings.batchSize ?? fallback.batchSize),
    mode: settings.mode === 'autopilot' ? 'autopilot' : 'review',
    autoNewNotes: typeof settings.autoNewNotes === 'boolean' ? settings.autoNewNotes : fallback.autoNewNotes,
    depth: clampDepth(settings.depth ?? fallback.depth),
  };
}

/**
 * Repairs a stored plan field by field. Run on every row after `isValidPlan`,
 * so an older build's record — or one written mid-crash — loads as something
 * every screen can render, rather than being dropped with its conversation.
 */
export function normalizePlan(plan: QuizPlan): QuizPlan {
  return {
    id: plan.id,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    request: plan.request,
    spec: plan.spec,
    accepted: plan.accepted,
    messages: plan.messages
      .map(normalizeMessage)
      .filter((message): message is PlanMessage => message !== null),
    batches: plan.batches.map(normalizeBatch).filter((batch): batch is PlanBatch => batch !== null),
    coverage: normalizeCoverage(plan.coverage),
    seen: normalizeSeen(plan.seen),
    ...(typeof plan.baselinedAt === 'number' ? { baselinedAt: plan.baselinedAt } : {}),
    settings: normalizeSettings(plan.settings),
    ...(typeof plan.quizId === 'string' && plan.quizId ? { quizId: plan.quizId } : {}),
    plannerUsage: isUsage(plan.plannerUsage) ? plan.plannerUsage : emptyUsage(),
  };
}

// ---------------------------------------------------------------------------
// Derived reads
// ---------------------------------------------------------------------------

/** The batch waiting on the reader, if any. At most one is ever open. */
export function openBatch(plan: QuizPlan): PlanBatch | undefined {
  return plan.batches.find(
    (batch) => batch.status === 'generating' || batch.status === 'review' || batch.status === 'fixing',
  );
}

/** True once the reader has kept anything — samples included. */
export function hasKeptAnything(plan: QuizPlan): boolean {
  return plan.batches.some((batch) => batch.status === 'accepted' && batch.acceptedIds.length > 0);
}

/**
 * True once a real batch has been kept — samples NOT included. Until then the
 * plan is still being tried out, so a new version of it earns new samples
 * rather than a batch written on the strength of samples from the old one.
 */
export function hasKeptBatch(plan: QuizPlan): boolean {
  return plan.batches.some(
    (batch) => batch.kind !== 'sample' && batch.status === 'accepted' && batch.acceptedIds.length > 0,
  );
}

/** A proposal the reader has not agreed to yet. */
export function hasUnacceptedChanges(plan: QuizPlan): boolean {
  return !!plan.spec && (!plan.accepted || plan.spec.version !== plan.accepted.version);
}

/** What the plan is called, before and after the model has named it. */
export function planTitle(plan: QuizPlan): string {
  const title = plan.accepted?.title || plan.spec?.title;
  if (title) return title;
  const request = plan.request.trim().replace(/\s+/g, ' ');
  return request.length > 48 ? `${request.slice(0, 47)}…` : request || 'Untitled plan';
}

/** "Samples", "Batch 3", "New notes" — batches are numbered among their own kind. */
export function batchLabel(plan: QuizPlan, batch: PlanBatch): string {
  if (batch.kind === 'sample') return 'Samples';
  if (batch.kind === 'new-notes') return 'New notes';
  const index = plan.batches.filter((entry) => entry.kind === 'batch' && entry.number <= batch.number).length;
  return `Batch ${index}`;
}

/** Tokens a plan has cost so far, planner and batches together. */
export function totalUsage(plan: QuizPlan): { inputTokens: number; outputTokens: number } {
  return plan.batches.reduce(
    (total, batch) => ({
      inputTokens: total.inputTokens + batch.usage.inputTokens,
      outputTokens: total.outputTokens + batch.usage.outputTokens,
    }),
    { ...plan.plannerUsage },
  );
}
