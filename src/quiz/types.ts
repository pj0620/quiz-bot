import type { MapId } from './geography/types';

/**
 * The quiz domain model.
 *
 * Three concepts are kept deliberately separate, because conflating them is
 * what makes the naive "one quiz containing everything" design fail:
 *
 *   Question bank — the ever-growing pool, never surfaced as "a quiz"
 *   Quiz          — a saved RULE over the bank, not a fixed list of questions
 *   Session       — one bounded attempt, producing a score
 */

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type Difficulty = 'intro' | 'core' | 'deep';

export const DIFFICULTY_ORDER: Record<Difficulty, number> = { intro: 0, core: 1, deep: 2 };

/**
 * Where in a source a question came from.
 *
 * Everything except `sourceId` is optional because a non-file source (a book)
 * has chapters, not paths. `path` is kept for identity and permalinks, but the
 * UI shows `noteTitle` and `section`: someone revising their own notes is
 * looking for "First Year of Fighting › Border States", and a repository path
 * makes them translate before they can recognise it.
 */
export type Provenance = {
  sourceId: string;
  path?: string;
  /** Provider revision marker at generation time — a commit SHA for Git. */
  revision?: string;
  /** Display title of the note, from frontmatter or its filename. */
  noteTitle?: string;
  /** Heading within the note that this question came from. */
  section?: string;
  /** Verbatim excerpt shown under "where this came from". Capped at write time. */
  excerpt?: string;
  /**
   * The passage the model says this question came from, copied from the note.
   *
   * Used to highlight the relevant lines inside the note rather than showing an
   * arbitrary opening slice of it. Matched leniently at render time — a model's
   * "verbatim" re-wraps and re-punctuates — so a quote that no longer matches
   * degrades to no highlight rather than to a wrong one.
   */
  quote?: string;
};

/**
 * An illustration shown above the prompt.
 *
 * On the BASE rather than on a format, which is the whole reason "which state
 * is this outline?" needed no new question type. A shape question is an
 * ordinary multiple-choice or short-answer question that happens to carry a
 * picture, so grading, review scheduling, the bank browser and the editors all
 * handle it without knowing geography exists. Only the player, which draws it,
 * knows.
 *
 * A discriminated union from the start: it will not stay one member forever,
 * and a bare `{ regionId }` would have to be widened later at every use.
 */
export type QuestionFigure = {
  kind: 'region-shape';
  mapId: MapId;
  regionId: string;
};

export type FlagReason = 'wrong' | 'unclear' | 'duplicate' | 'not-useful' | 'other';

export type FlagRecord = {
  reason: FlagReason;
  note?: string;
  at: number;
};

export type QuestionBase = {
  /**
   * Deterministic: hash of sourceId + path + format + prompt. Re-generating
   * unchanged material yields the same id, so ingest dedupes instead of
   * accumulating near-duplicates that SRS would then schedule separately.
   */
  id: string;
  prompt: string;
  /** Required — a question you can't explain isn't worth keeping in the bank. */
  explanation: string;
  /** Normalized lowercase-kebab, max 3. Drives rules and mastery grouping. */
  topics: string[];
  difficulty: Difficulty;
  /** Ownership FK: removing a source removes its questions. */
  sourceId: string;
  provenance: Provenance;
  /** When this entered the LOCAL bank. Drives "what's new" and addedWithinDays. */
  addedAt: number;
  /**
   * Timestamp of the underlying material (commit date). Deliberately distinct
   * from addedAt: connecting an old repo today adds new rows describing old
   * material, and conflating the two makes "recently added" meaningless.
   */
  contentAt?: number;
  /** Set by "report a bad question". Excluded from selection while present. */
  flagged?: FlagRecord;
  /**
   * A picture the prompt refers to. Absent on everything derived from a note —
   * only geography sets it. See `QuestionFigure`.
   */
  figure?: QuestionFigure;
};

export type Choice = { id: string; text: string };

export type MultipleChoiceQuestion = QuestionBase & {
  format: 'multiple-choice';
  /** 2..6 choices. */
  choices: Choice[];
  /** Must be a member of `choices` — validated on load, graded by id not index. */
  correctChoiceId: string;
};

export type TrueFalseQuestion = QuestionBase & {
  format: 'true-false';
  correct: boolean;
};

export type ShortAnswerQuestion = QuestionBase & {
  format: 'short-answer';
  modelAnswer: string;
  /**
   * When present, auto-grade against these first and only fall back to
   * self-grading on a miss. Absent means always self-graded.
   */
  acceptable?: string[];
  /** Bullet points the user checks their own answer against. */
  rubric?: string[];
};

/**
 * "Name three of the Northern advantages."
 *
 * Notes are full of lists — the densest, most quizzable structure in them — and
 * asking for a whole list at once tests recall in a way that recognising one
 * multiple-choice option does not. Auto-graded, because list entries are short
 * noun phrases rather than free prose.
 */
export type ListRecallQuestion = QuestionBase & {
  format: 'list-recall';
  /** How many entries the user must supply. Always <= items.length. */
  required: number;
  /** The full list from the note. ANY `required` of them scores full marks. */
  items: string[];
};

export type Blank = {
  id: string;
  accepted: string[];
  caseSensitive?: boolean;
};

export type FillBlankQuestion = QuestionBase & {
  format: 'fill-blank';
  /** Text containing {{blankId}} placeholders. */
  template: string;
  blanks: Blank[];
};

export type TimelineEvent = {
  id: string;
  /** What happened. Must NOT contain the date — see `TimelineQuestion`. */
  label: string;
  /**
   * Free text: "1861", "March 1861", "c. 480 BC". Never parsed, never compared,
   * never graded — the correct order is simply the order `events` is stored in.
   * Shown to the reader only after they have answered.
   */
  date: string;
};

/**
 * "Put these in the order they happened."
 *
 * The first format that tests SEQUENCE rather than a fact in isolation. Someone
 * can know that Fort Sumter, Antietam and Appomattox all happened and have no
 * idea which came first, and nothing else in the bank would ever catch that.
 *
 * Events are stored IN THEIR CORRECT ORDER and shuffled at render — the same
 * trick multiple-choice plays with `choices`, and for the same reason: the
 * generator never has to emit an order AND a separate answer key that it could
 * then contradict.
 *
 * The date lives in its own field because a label reading "Fort Sumter is
 * shelled, 1861" is not a timeline question, it is a reading test. Hiding the
 * dates until reveal is the entire format.
 */
export type TimelineQuestion = QuestionBase & {
  format: 'timeline';
  /** 3..6 events, EARLIEST FIRST. */
  events: TimelineEvent[];
};

/**
 * "Tap Tennessee."
 *
 * The one format geography genuinely needed, because nothing existing can
 * express it: every other format answers with text the reader picked or typed,
 * and this one answers with a PLACE. Shape recognition needed no new format —
 * see `QuestionFigure` — but pointing at a map does.
 *
 * Deliberately stores region IDS and nothing else. No paths, no coordinates, no
 * labels: the map data is a static, committed table (`src/quiz/geography/data`)
 * and duplicating any of it onto the question would mean a stored question could
 * disagree with the map it is drawn on. `regionIds` says what to DRAW —
 * always the whole map today, but the field is what would let a question ask
 * about New England alone without inventing a second map.
 */
export type MapLocateQuestion = QuestionBase & {
  format: 'map-locate';
  mapId: MapId;
  /** The region the reader has to find. Must appear in `regionIds`. */
  targetRegionId: string;
  /** Every region drawn, including the target. */
  regionIds: string[];
};

export type Question =
  | MultipleChoiceQuestion
  | TrueFalseQuestion
  | ShortAnswerQuestion
  | ListRecallQuestion
  | FillBlankQuestion
  | TimelineQuestion
  | MapLocateQuestion;

/**
 * DERIVED, never hand-maintained. Adding a member to `Question` above
 * immediately makes the question-type registry's mapped type a compile error,
 * which is the entire mechanism that keeps formats from being half-wired.
 */
export type QuestionFormat = Question['format'];

// ---------------------------------------------------------------------------
// Answers and grading
// ---------------------------------------------------------------------------

export type SelfGrade = 'got-it' | 'close' | 'missed';

export type MultipleChoiceAnswer = { format: 'multiple-choice'; choiceId: string };
export type TrueFalseAnswer = { format: 'true-false'; value: boolean };
/**
 * A verdict reached by the model rather than by the user.
 *
 * Stored on the answer, not computed at grade time, because it is the result of
 * a network call: recomputing it when the results screen re-renders would mean
 * paying again and could return a different answer.
 */
export type JudgedGrade = { outcome: Outcome; reason?: string };

export type ShortAnswerAnswer = {
  format: 'short-answer';
  text: string;
  selfGrade?: SelfGrade;
  judged?: JudgedGrade;
};
export type ListRecallAnswer = { format: 'list-recall'; entries: string[] };
export type FillBlankAnswer = { format: 'fill-blank'; values: Record<string, string> };
/** Event ids in the order the reader currently has them arranged. */
export type TimelineAnswer = { format: 'timeline'; order: string[] };
/** The region tapped. Never a coordinate — see `MapLocateQuestion`. */
export type MapLocateAnswer = { format: 'map-locate'; regionId: string };

export type Answer =
  | MultipleChoiceAnswer
  | TrueFalseAnswer
  | ShortAnswerAnswer
  | ListRecallAnswer
  | FillBlankAnswer
  | TimelineAnswer
  | MapLocateAnswer;

/** The answer type belonging to a given question type. */
export type AnswerFor<Q extends Question> = Extract<Answer, { format: Q['format'] }>;

export type Outcome = 'correct' | 'partial' | 'incorrect';

/**
 * The result of grading. `status: 'needs-self-grade'` is how self-assessed
 * formats (short answer, code explain) coexist with auto-graded ones behind a
 * single interface — it drives the player into a three-button state instead of
 * showing a verdict.
 */
export type Grade =
  | {
      status: 'graded';
      outcome: Outcome;
      /** 0..1. Used by fill-blank and timeline for partial credit; 1 or 0 elsewhere. */
      score: number;
      /** Per-part correctness, for formats with multiple inputs. */
      parts?: Record<string, boolean>;
    }
  | { status: 'needs-self-grade'; modelAnswer: string; rubric?: string[] };

export function isGraded(grade: Grade | null): grade is Extract<Grade, { status: 'graded' }> {
  return grade?.status === 'graded';
}

/** Maps a user's self-assessment onto the same outcome scale as auto-grading. */
export function outcomeFromSelfGrade(selfGrade: SelfGrade): Outcome {
  switch (selfGrade) {
    case 'got-it':
      return 'correct';
    case 'close':
      return 'partial';
    case 'missed':
      return 'incorrect';
  }
}

// ---------------------------------------------------------------------------
// Review state (spaced repetition)
// ---------------------------------------------------------------------------

export type ReviewState = {
  questionId: string;
  /** SM-2 ease factor, clamped. Higher = intervals grow faster. */
  ease: number;
  /** Current interval in days. */
  intervalDays: number;
  dueAt: number;
  /** Consecutive correct answers; resets to 0 on a lapse. */
  streak: number;
  /** Total times answered incorrectly, ever. Drives leech detection. */
  lapses: number;
  reps: number;
  lastReviewedAt: number;
  lastOutcome: Outcome;
  /**
   * Repeatedly failed. Excluded from normal selection so one impossible
   * question can't dominate every session.
   */
  leech?: boolean;
};

/** Display bucket derived from review state. Never feeds back into scheduling. */
export type MasteryLevel = 'new' | 'learning' | 'shaky' | 'familiar' | 'solid';

// ---------------------------------------------------------------------------
// Quizzes — a saved rule, not a fixed list
// ---------------------------------------------------------------------------

/** How a session balances unseen questions against ones that are due. */
export type QuizMix = 'balanced' | 'new-only' | 'review-only';

export type QuizRule = {
  /** Matches a question with ANY of these topics. Empty = no constraint. */
  topics?: string[];
  /** Restrict to specific sources. Empty/absent = all sources. */
  sourceIds?: string[];
  /** Only questions added within this many calendar days. */
  addedWithinDays?: number;
  formats?: QuestionFormat[];
  difficulties?: Difficulty[];
  /** Only questions at or below this mastery — the "weak spots" rule. */
  maxMastery?: MasteryLevel;
  /** How many questions per session. */
  size: number;
  mix: QuizMix;
};

export type Quiz = {
  id: string;
  name: string;
  icon: string;
  rule: QuizRule;
  createdAt: number;
  /**
   * Built-ins (Daily, Weak spots) are seeded on first run and can't be deleted,
   * only edited.
   */
  builtin?: boolean;
  lastSessionAt?: number;
};

// ---------------------------------------------------------------------------
// Sessions — one bounded attempt
// ---------------------------------------------------------------------------

export type SessionItem = {
  questionId: string;
  answer?: Answer;
  grade?: Grade;
  outcome?: Outcome;
  answeredAt?: number;
  /** True when the user flagged this question mid-session. */
  flagged?: boolean;
  /** Whether this was unseen at session start — drives honest result labelling. */
  wasNew: boolean;
};

export type SessionStatus = 'active' | 'completed' | 'abandoned';

export type Session = {
  id: string;
  /** Absent for ad-hoc sessions ("practice this now", "review what I missed"). */
  quizId?: string;
  quizName: string;
  status: SessionStatus;
  startedAt: number;
  completedAt?: number;
  /** Fixed at creation so a resumed session never reshuffles under the user. */
  seed: number;
  items: SessionItem[];
  currentIndex: number;
};

/** Retained instead of a full Session once history is capped. */
export type SessionSummary = {
  id: string;
  quizId?: string;
  quizName: string;
  completedAt: number;
  correct: number;
  total: number;
  newCount: number;
};

export function sessionScore(session: Session): { correct: number; answered: number; total: number } {
  let correct = 0;
  let answered = 0;
  for (const item of session.items) {
    if (item.outcome === undefined) continue;
    answered += 1;
    if (item.outcome === 'correct') correct += 1;
  }
  return { correct, answered, total: session.items.length };
}
