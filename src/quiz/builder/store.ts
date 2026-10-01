import { createStore } from '../../lib/createStore';
import { hashString } from '../../lib/random';
import { coverageKey } from '../generation/coverage';
import type { RunNote } from '../generation/runStore';
import type { NoteCandidate } from '../generation/selectNotes';
import {
  addQuestions,
  deleteQuestions,
  detachQuestionsFromPlan,
  getQuestions,
  getQuizById,
  removeQuiz,
  upsertQuiz,
} from '../store';
import type { Question } from '../types';
import { draftsToKeep } from './feedback';
import { applyHandEdit } from './planSpec';
import { loadPlansAsync, loadPlansSync, plansSaver } from './storage';
import {
  batchLabel,
  clampBatchSize,
  clampDepth,
  defaultSettings,
  emptyUsage,
  MAX_MESSAGE_CHARS,
  MAX_REQUEST_CHARS,
  MAX_STORED_BATCHES,
  MAX_STORED_MESSAGES,
  planTitle,
  type BatchKind,
  type DraftReview,
  type PlanBatch,
  type PlanMessage,
  type PlanSettings,
  type PlanSpec,
  type QuizPlan,
} from './types';

/**
 * The quiz plans, following the convention in `src/quiz/store.ts`:
 * module-level creation with CHECKED synchronous hydration, a private
 * fire-and-forget persist, exported free functions as the only mutation API,
 * and non-hook getters for imperative callers.
 *
 * Every mutation below runs synchronously between awaits, which is what lets a
 * batch run, a planner turn and the reader's own taps all write to the same
 * plan at once without locking — the same guarantee the generation loop leans
 * on.
 */

type PlansState = { plans: QuizPlan[] };

const hydrated = loadPlansSync();

export const plansStore = createStore<PlansState>({ plans: hydrated.items });

/*
  What recovery may overwrite: an untouched store is restored wholesale, a
  touched one is merged with the in-memory copy winning. See `store.ts`.
*/
let touched = false;
let pendingRecovery = hydrated.failed;

function commit(plans: QuizPlan[]): void {
  touched = true;
  plansStore.set({ plans });
  plansSaver.schedule(plans);
}

/**
 * Applies `change` to one plan and stamps it updated. Returning the plan
 * unchanged writes nothing — which most guards below rely on, so a stale tap
 * on a batch that has since moved on is a no-op rather than a corruption.
 */
function updatePlan(
  planId: string,
  change: (plan: QuizPlan) => QuizPlan,
  now = Date.now(),
): QuizPlan | undefined {
  const { plans } = plansStore.get();
  const index = plans.findIndex((plan) => plan.id === planId);
  if (index === -1) return undefined;
  const changed = change(plans[index]);
  if (changed === plans[index]) return changed;
  const next = [...plans];
  next[index] = { ...changed, updatedAt: now };
  commit(next);
  return next[index];
}

/** A whole review's digest; far above what `feedbackDigest` writes. */
const MAX_FEEDBACK_CHARS = 12_000;

let sequence = 0;

function messageId(now: number): string {
  sequence += 1;
  return `msg-${now.toString(36)}-${sequence.toString(36)}`;
}

function withMessage(plan: QuizPlan, message: PlanMessage): QuizPlan {
  return { ...plan, messages: [...plan.messages, message].slice(-MAX_STORED_MESSAGES) };
}

function event(text: string, now: number): PlanMessage {
  return { id: messageId(now), role: 'event', text, at: now };
}

function addUsage(
  a: { inputTokens: number; outputTokens: number },
  b: { inputTokens: number; outputTokens: number } | undefined,
): { inputTokens: number; outputTokens: number } {
  if (!b) return a;
  return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getPlans(): QuizPlan[] {
  return plansStore.get().plans;
}

export function getPlan(planId: string): QuizPlan | undefined {
  return plansStore.get().plans.find((plan) => plan.id === planId);
}

export function getBatch(planId: string, batchId: string): PlanBatch | undefined {
  return getPlan(planId)?.batches.find((batch) => batch.id === batchId);
}

/** The bank is the authority on a plan's questions — see `VocabWord` for why. */
export function questionsForPlan(planId: string): Question[] {
  return getQuestions().filter((question) => question.planId === planId);
}

/**
 * Prompts this plan already has for one note — kept and still in review —
 * so a later pass asks something new rather than rewording what is there.
 */
export function askedForNote(plan: QuizPlan, sourceId: string, path: string): string[] {
  const fromNote = (question: Question) =>
    question.sourceId === sourceId && question.provenance.path === path;
  const kept = getQuestions().filter((question) => question.planId === plan.id && fromNote(question));
  const drafts = plan.batches.flatMap((batch) => batch.drafts).filter(fromNote);
  return [...kept, ...drafts].map((question) => question.prompt);
}

// ---------------------------------------------------------------------------
// Plans and the conversation
// ---------------------------------------------------------------------------

export function createPlan(request: string, now = Date.now()): QuizPlan {
  const text = request.trim().slice(0, MAX_REQUEST_CHARS);
  const plan: QuizPlan = {
    id: `plan-${now.toString(36)}-${hashString(`${text}|${now}`).toString(36)}`,
    createdAt: now,
    updatedAt: now,
    request: text,
    spec: null,
    accepted: null,
    messages: [{ id: messageId(now), role: 'user', text, at: now }],
    batches: [],
    coverage: {},
    seen: {},
    settings: defaultSettings(),
    plannerUsage: emptyUsage(),
  };
  commit([plan, ...plansStore.get().plans]);
  return plan;
}

export function appendMessage(
  planId: string,
  message: { role: PlanMessage['role']; text: string; kind?: PlanMessage['kind'] },
  now = Date.now(),
): PlanMessage | undefined {
  const created: PlanMessage = {
    id: messageId(now),
    role: message.role,
    // A digest is bounded by `feedbackDigest` itself, and cutting it here would
    // lose its closing instruction — the one line the planner most needs.
    text: message.text.trim().slice(0, message.kind === 'feedback' ? MAX_FEEDBACK_CHARS : MAX_MESSAGE_CHARS),
    at: now,
    ...(message.kind ? { kind: message.kind } : {}),
  };
  const updated = updatePlan(planId, (plan) => withMessage(plan, created), now);
  return updated ? created : undefined;
}

/**
 * The planner's turn landed. `spec` is already sanitized against the plan's
 * current spec — it is that same object when the reply changed nothing, and
 * then no version is recorded against the message.
 */
export function applyPlannerReply(
  planId: string,
  reply: { text: string; spec: PlanSpec | null; usage?: { inputTokens: number; outputTokens: number } },
  now = Date.now(),
): void {
  updatePlan(
    planId,
    (plan) => {
      const changed = !!reply.spec && reply.spec !== plan.spec;
      const message: PlanMessage = {
        id: messageId(now),
        role: 'assistant',
        text: reply.text.trim().slice(0, MAX_MESSAGE_CHARS),
        at: now,
        ...(changed && reply.spec ? { planVersion: reply.spec.version } : {}),
      };
      return {
        ...withMessage(plan, message),
        spec: changed ? reply.spec : plan.spec,
        plannerUsage: addUsage(plan.plannerUsage, reply.usage),
      };
    },
    now,
  );
}

/** Tokens the planner spent on a turn whose reply could not be used. Billed all the same. */
export function addPlannerUsage(planId: string, usage: { inputTokens: number; outputTokens: number }): void {
  updatePlan(planId, (plan) => ({ ...plan, plannerUsage: addUsage(plan.plannerUsage, usage) }));
}

/** The reader agreed to the working plan. Generation follows it from now on. */
export function acceptSpec(planId: string, now = Date.now()): PlanSpec | null {
  const updated = updatePlan(
    planId,
    (plan) => {
      if (!plan.spec) return plan;
      if (plan.accepted?.version === plan.spec.version) return plan;
      return withMessage({ ...plan, accepted: plan.spec }, event(`You accepted plan v${plan.spec.version}.`, now));
    },
    now,
  );
  return updated?.accepted ?? null;
}

/** The version a hand edit starts from: the plan in force, if there is one. */
export function editBase(plan: QuizPlan): PlanSpec | null {
  return plan.accepted ?? plan.spec;
}

/**
 * A hand edit. On a plan already in use it is accepted at once — the person
 * who made the change has agreed to it — while a plan still being drafted
 * keeps waiting for the reader to accept it with everything else.
 *
 * On a plan in use the edit starts from the ACCEPTED version (see
 * `editBase`), never from a proposal still waiting on the reader. Starting
 * from the proposal and then accepting the result would slip every change
 * the planner proposed past the reader inside an edit to the title. The
 * proposal is replaced instead — said in the conversation, so it is not lost
 * without a word.
 */
export function saveHandEdit(planId: string, edited: PlanSpec, now = Date.now()): PlanSpec | null {
  let saved: PlanSpec | null = null;
  updatePlan(
    planId,
    (plan) => {
      const base = editBase(plan);
      const cleaned = applyHandEdit(edited, base, now);
      if (cleaned === base) {
        saved = base;
        return plan;
      }
      // Versions only ever go up: a replaced proposal's number is not reused.
      const next = {
        ...cleaned,
        version: Math.max(plan.spec?.version ?? 0, plan.accepted?.version ?? 0) + 1,
      };
      saved = next;
      const replaced = plan.accepted && plan.spec && plan.spec.version !== plan.accepted.version ? plan.spec : null;
      return withMessage(
        { ...plan, spec: next, accepted: plan.accepted ? next : plan.accepted },
        event(
          replaced
            ? `You edited the plan by hand (v${next.version}), replacing the planner’s unaccepted v${replaced.version}.`
            : `You edited the plan by hand (v${next.version}).`,
          now,
        ),
      );
    },
    now,
  );
  return saved;
}

export function updatePlanSettings(planId: string, patch: Partial<PlanSettings>): void {
  updatePlan(planId, (plan) => {
    const settings: PlanSettings = {
      ...plan.settings,
      ...patch,
      batchSize: clampBatchSize(patch.batchSize ?? plan.settings.batchSize),
      depth: clampDepth(patch.depth ?? plan.settings.depth),
    };
    return JSON.stringify(settings) === JSON.stringify(plan.settings) ? plan : { ...plan, settings };
  });
}

// ---------------------------------------------------------------------------
// What the plan has read
// ---------------------------------------------------------------------------

/**
 * Acknowledges every note currently in scope as part of the plan, so only
 * notes that turn up LATER count as new. Adds keys and never rewrites one: a
 * note that changed since it was first seen must stay detectable as changed.
 */
export function baselinePlan(planId: string, notes: readonly NoteCandidate[], now = Date.now()): void {
  updatePlan(
    planId,
    (plan) => {
      const seen = { ...plan.seen };
      let added = false;
      for (const note of notes) {
        const key = coverageKey(note.sourceId, note.path);
        if (seen[key] !== undefined) continue;
        seen[key] = note.contentHash ?? '';
        added = true;
      }
      if (!added && plan.baselinedAt !== undefined) return plan;
      return { ...plan, seen, baselinedAt: plan.baselinedAt ?? now };
    },
    now,
  );
}

/** "Not now" on new notes: acknowledged at their current version, still in scope. */
export function markNotesSeen(planId: string, notes: readonly NoteCandidate[]): void {
  updatePlan(planId, (plan) => {
    const seen = { ...plan.seen };
    for (const note of notes) seen[coverageKey(note.sourceId, note.path)] = note.contentHash ?? '';
    return { ...plan, seen };
  });
}

/** A note was read and produced questions (or honestly produced none). */
export function recordNoteRead(
  planId: string,
  note: { sourceId: string; path: string; contentHash?: string },
  questionCount: number,
  now = Date.now(),
): void {
  const key = coverageKey(note.sourceId, note.path);
  updatePlan(
    planId,
    (plan) => {
      const previous = plan.coverage[key];
      return {
        ...plan,
        coverage: {
          ...plan.coverage,
          [key]: {
            ...(note.contentHash ? { contentHash: note.contentHash } : {}),
            passes: (previous?.passes ?? 0) + 1,
            questionCount: (previous?.questionCount ?? 0) + questionCount,
            lastAt: now,
          },
        },
        seen: { ...plan.seen, [key]: note.contentHash ?? '' },
      };
    },
    now,
  );
}

/**
 * Forgets what every plan has read — the plan-side twin of
 * `clearAllCoverage`, for a bank that was just cleared.
 *
 * Without it, every plan would still believe its notes were read, find
 * nothing left to do, and offer only "go deeper" for a bank that is empty.
 * `seen` is deliberately kept: those notes are backlog to be read again, not
 * news to be written up unprompted.
 */
export function resetAllPlanCoverage(): void {
  const { plans } = plansStore.get();
  if (!plans.some((plan) => Object.keys(plan.coverage).length > 0)) return;
  commit(plans.map((plan) => (Object.keys(plan.coverage).length > 0 ? { ...plan, coverage: {} } : plan)));
}

/** A failed read. Counts towards giving up on the note; costs it no pass. */
export function recordNoteFailure(
  planId: string,
  note: { sourceId: string; path: string },
  now = Date.now(),
): void {
  const key = coverageKey(note.sourceId, note.path);
  updatePlan(
    planId,
    (plan) => {
      const previous = plan.coverage[key];
      return {
        ...plan,
        coverage: {
          ...plan.coverage,
          [key]: {
            ...(previous ?? { passes: 0, questionCount: 0 }),
            lastAt: now,
            failures: (previous?.failures ?? 0) + 1,
          },
        },
      };
    },
    now,
  );
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/** Settled batches past the cap are dropped oldest first. An open one never is. */
function trimBatches(batches: PlanBatch[]): PlanBatch[] {
  let excess = batches.length - MAX_STORED_BATCHES;
  if (excess <= 0) return batches;
  return batches.filter((batch) => {
    if (excess <= 0) return true;
    const settled = batch.status === 'accepted' || batch.status === 'discarded' || batch.status === 'failed';
    if (!settled) return true;
    excess -= 1;
    return false;
  });
}

export function beginBatch(
  planId: string,
  init: { kind: BatchKind; requested: number; specVersion: number; notes: RunNote[] },
  now = Date.now(),
): PlanBatch | undefined {
  let created: PlanBatch | undefined;
  updatePlan(
    planId,
    (plan) => {
      const number = plan.batches.reduce((max, batch) => Math.max(max, batch.number), 0) + 1;
      created = {
        id: `batch-${now.toString(36)}-${number}`,
        number,
        kind: init.kind,
        status: 'generating',
        requested: init.requested,
        specVersion: init.specVersion,
        createdAt: now,
        drafts: [],
        reviews: {},
        acceptedIds: [],
        discarded: 0,
        notes: init.notes,
        usage: emptyUsage(),
      };
      return { ...plan, batches: trimBatches([...plan.batches, created]) };
    },
    now,
  );
  return created;
}

export function patchBatch(planId: string, batchId: string, change: (batch: PlanBatch) => PlanBatch): void {
  updatePlan(planId, (plan) => {
    const index = plan.batches.findIndex((batch) => batch.id === batchId);
    if (index === -1) return plan;
    const next = change(plan.batches[index]);
    if (next === plan.batches[index]) return plan;
    const batches = [...plan.batches];
    batches[index] = next;
    return { ...plan, batches };
  });
}

export function patchBatchNote(planId: string, batchId: string, key: string, patch: Partial<RunNote>): void {
  patchBatch(planId, batchId, (batch) => {
    const index = batch.notes.findIndex((note) => note.key === key);
    if (index === -1) return batch;
    const notes = [...batch.notes];
    notes[index] = { ...notes[index], ...patch };
    return { ...batch, notes };
  });
}

/** Adds rows to a batch's progress list — the top-up's extra notes. */
export function appendBatchNotes(planId: string, batchId: string, rows: RunNote[]): void {
  patchBatch(planId, batchId, (batch) => {
    const known = new Set(batch.notes.map((note) => note.key));
    const fresh = rows.filter((row) => !known.has(row.key));
    return fresh.length === 0 ? batch : { ...batch, notes: [...batch.notes, ...fresh] };
  });
}

/**
 * Saves drafts as they arrive, note by note, so a cancelled or interrupted
 * batch keeps everything already paid for. Returns the drafts actually added.
 *
 * Duplicates are dropped here rather than at acceptance: a draft whose id is
 * already in the bank, or already waiting in this plan, is a question the
 * reader has — reviewing it a second time is a chore with no outcome.
 */
export function addDrafts(planId: string, batchId: string, incoming: readonly Question[]): Question[] {
  const bankIds = new Set(getQuestions().map((question) => question.id));
  let added: Question[] = [];
  updatePlan(planId, (plan) => {
    const index = plan.batches.findIndex((batch) => batch.id === batchId);
    if (index === -1) return plan;
    const waiting = new Set(plan.batches.flatMap((batch) => batch.drafts.map((draft) => draft.id)));
    added = incoming.filter((question) => {
      if (bankIds.has(question.id) || waiting.has(question.id)) return false;
      waiting.add(question.id);
      return true;
    });
    if (added.length === 0) return plan;
    const batches = [...plan.batches];
    batches[index] = { ...batches[index], drafts: [...batches[index].drafts, ...added] };
    return { ...plan, batches };
  });
  return added;
}

export function setDraftReview(planId: string, batchId: string, questionId: string, review: DraftReview): void {
  patchBatch(planId, batchId, (batch) =>
    batch.drafts.some((draft) => draft.id === questionId)
      ? { ...batch, reviews: { ...batch.reviews, [questionId]: review } }
      : batch,
  );
}

/** A fix landed: the draft is replaced in place, its review reset to unreviewed. */
export function replaceDraft(planId: string, batchId: string, next: Question, review: DraftReview): void {
  patchBatch(planId, batchId, (batch) => {
    if (!batch.drafts.some((draft) => draft.id === next.id)) return batch;
    return {
      ...batch,
      drafts: batch.drafts.map((draft) => (draft.id === next.id ? next : draft)),
      reviews: { ...batch.reviews, [next.id]: review },
    };
  });
}

/**
 * A hand edit to a draft, from whichever open batch holds it.
 *
 * Fixing a draft by hand answers its "needs work": the flag is cleared, as a
 * model rewrite clears it. Left set, keeping the batch would discard the very
 * question the reader just corrected — `draftsToKeep` leaves out anything
 * still marked "fix".
 */
export function updateDraft(planId: string, next: Question): boolean {
  const plan = getPlan(planId);
  const batch = plan?.batches.find((entry) => entry.drafts.some((draft) => draft.id === next.id));
  if (!plan || !batch) return false;
  patchBatch(planId, batch.id, (current) => {
    const previous = current.drafts.find((draft) => draft.id === next.id);
    const review = current.reviews[next.id];
    const revisedFrom =
      review?.revisedFrom ?? (previous && previous.prompt !== next.prompt ? previous.prompt : undefined);
    return {
      ...current,
      drafts: current.drafts.map((draft) => (draft.id === next.id ? { ...next, planId } : draft)),
      reviews:
        review?.verdict === 'fix'
          ? { ...current.reviews, [next.id]: { tags: [], note: '', ...(revisedFrom ? { revisedFrom } : {}) } }
          : current.reviews,
    };
  });
  return true;
}

export type AcceptOutcome = { kept: number; added: number; discarded: number };

/**
 * Keeps a batch: its surviving drafts go into the bank, and the batch keeps
 * only their ids. See `draftsToKeep` for which survive.
 *
 * The first batch a plan keeps also creates its quiz, so the questions are
 * quizzable the moment they exist. Only the first: a reader who deleted that
 * quiz meant it, and keeping another batch must not quietly bring it back.
 */
export function acceptBatch(
  planId: string,
  batchId: string,
  options: { auto?: boolean; now?: number } = {},
): AcceptOutcome {
  const now = options.now ?? Date.now();
  const plan = getPlan(planId);
  const batch = plan?.batches.find((entry) => entry.id === batchId);
  if (!plan || !batch) return { kept: 0, added: 0, discarded: 0 };
  // Only a batch actually waiting on the reader can be kept — a stale tap on
  // one that was already kept or discarded must not add anything twice.
  if (batch.status !== 'review' && !(options.auto && batch.status === 'generating')) {
    return { kept: 0, added: 0, discarded: 0 };
  }

  const kept = draftsToKeep(batch).map((draft) => ({ ...draft, planId }));
  const { added } = addQuestions(kept);
  const discarded = batch.drafts.length - kept.length;

  updatePlan(
    planId,
    (current) => {
      const label = batchLabel(current, batch);
      const batches = current.batches.map((entry) =>
        entry.id === batchId
          ? {
              ...entry,
              status: 'accepted' as const,
              drafts: [],
              reviews: {},
              acceptedIds: kept.map((draft) => draft.id),
              discarded,
              settledAt: now,
              ...(options.auto ? { autoAccepted: true } : {}),
            }
          : entry,
      );
      const text = options.auto
        ? `${label}: ${kept.length} added straight to your bank.`
        : `${label}: you kept ${kept.length}${discarded > 0 ? ` and discarded ${discarded}` : ''}.`;
      return withMessage({ ...current, batches }, event(text, now));
    },
    now,
  );

  if (kept.length > 0 && !plan.quizId) createPlanQuiz(planId, now);
  return { kept: kept.length, added, discarded };
}

/** Throws a batch away whole. Nothing reaches the bank. */
export function discardBatch(planId: string, batchId: string, now = Date.now()): void {
  updatePlan(
    planId,
    (plan) => {
      const batch = plan.batches.find((entry) => entry.id === batchId);
      if (!batch || batch.status === 'accepted' || batch.status === 'discarded') return plan;
      const batches = plan.batches.map((entry) =>
        entry.id === batchId
          ? { ...entry, status: 'discarded' as const, drafts: [], reviews: {}, discarded: entry.drafts.length, settledAt: now }
          : entry,
      );
      return withMessage({ ...plan, batches }, event(`${batchLabel(plan, batch)}: discarded.`, now));
    },
    now,
  );
}

// ---------------------------------------------------------------------------
// The plan's quiz, and deleting
// ---------------------------------------------------------------------------

/** The quiz a plan feeds: an ordinary rule over the bank, filtered to the plan. */
export function createPlanQuiz(planId: string, now = Date.now()): string | undefined {
  const plan = getPlan(planId);
  if (!plan) return undefined;
  const id = `plan-quiz-${planId}`;
  if (!getQuizById(id)) {
    upsertQuiz({
      id,
      name: planTitle(plan),
      icon: 'construct-outline',
      createdAt: now,
      rule: { planIds: [planId], size: 10, mix: 'balanced' },
    });
  }
  updatePlan(planId, (current) => (current.quizId === id ? current : { ...current, quizId: id }), now);
  return id;
}

/**
 * Removes a plan and its quiz. Its questions either go with it or stay in the
 * bank untagged — they are the reader's either way, so the reader chooses.
 */
export function deletePlan(planId: string, options: { withQuestions: boolean }): void {
  const plan = getPlan(planId);
  if (!plan) return;

  if (options.withQuestions) deleteQuestions(questionsForPlan(planId).map((question) => question.id));
  else detachQuestionsFromPlan(planId);

  if (plan.quizId) removeQuiz(plan.quizId);
  commit(plansStore.get().plans.filter((entry) => entry.id !== planId));
}

// ---------------------------------------------------------------------------
// Hydration recovery
// ---------------------------------------------------------------------------

function applyRecovered(recovered: QuizPlan[]): void {
  if (!touched) {
    // NOT persisted: this is what storage already holds.
    plansStore.set({ plans: recovered });
    return;
  }
  const current = plansStore.get().plans;
  const seen = new Set(current.map((plan) => plan.id));
  commit([...current, ...recovered.filter((plan) => !seen.has(plan.id))]);
}

/**
 * Puts stored plans back after a hydration read that FAILED, on the same
 * backoff the quiz stores use. See `recoverQuizStoresFromStorage`.
 */
export async function recoverPlansFromStorage(
  delays: readonly number[] = [500, 2_000, 8_000],
): Promise<boolean> {
  for (let attempt = 0; ; attempt += 1) {
    if (!pendingRecovery) return false;
    const plans = await loadPlansAsync();
    if (plans !== null) {
      pendingRecovery = false;
      applyRecovered(plans);
      return true;
    }
    if (attempt >= delays.length) return false;
    await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
  }
}

if (pendingRecovery) {
  void recoverPlansFromStorage().catch(() => undefined);
}
