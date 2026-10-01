import { createStore } from '../../lib/createStore';
import { AppError, toAppError, userMessage } from '../../lib/errors';
import { forEachInPool } from '../../lib/pool';
import { resolveCredentials, resolveTarget, type LlmCredentials } from '../../features/llm/credentials';
import { generateForPlan } from '../../features/llm/generateForPlan';
import { reviseQuestion } from '../../features/llm/reviseQuestion';
import { getConcurrency, getGuidance } from '../../features/llm/settings';
import { parseNote } from '../../notes/parse';
import { noteStem } from '../../notes/paths';
import { getSourceType } from '../../sources/registry';
import { getSourceById } from '../../sources/store';
import { chunkNote } from '../generation/chunkNote';
import { coverageKey } from '../generation/coverage';
import type { RunNote } from '../generation/runStore';
import type { NoteCandidate } from '../generation/selectNotes';
import { fixInstruction } from './feedback';
import { refreshCatalog } from './notesCatalog';
import { specGuidance } from './planSpec';
import { resolveScope } from './scope';
import { freshNotes, notesForSize, orderForBatch, pickSampleNotes } from './selection';
import {
  acceptBatch,
  addDrafts,
  appendBatchNotes,
  askedForNote,
  beginBatch,
  getBatch,
  getPlan,
  patchBatch,
  patchBatchNote,
  recordNoteFailure,
  recordNoteRead,
  replaceDraft,
  setDraftReview,
} from './store';
import { clampBatchSize, openBatch, SAMPLE_SIZE, type BatchKind } from './types';

/**
 * The work a plan does: writing a batch, and rewriting the drafts the reader
 * flagged.
 *
 * ONE job at a time across every plan — a third lock beside the note run and
 * the vocabulary batch, for the reason `vocab/runStore.ts` gives for having a
 * second: sharing either of those would make one kind of run silently return
 * the other's promise. One at a time is also the honest budget: a plan writing
 * on autopilot and another fixing drafts would double the request rate behind
 * the reader's back.
 *
 * The store holds only WHICH job is running. Its progress — rows, drafts,
 * tokens — is written to the batch itself as it happens, so every screen
 * renders from the plan, and an interrupted job leaves behind exactly what it
 * finished (see `normalizeBatch`).
 */

export type PlanJob = { kind: 'generate' | 'fix'; planId: string; batchId: string };

export type PlanRunState = { job: PlanJob | null };

export const planRunStore = createStore<PlanRunState>({ job: null });

/*
  Outside the store: neither is state a screen should render, and a live
  controller in an immutable snapshot invites someone to copy it.
*/
let controller: AbortController | null = null;
let starting = false;

/** Sample notes: enough to show the plan's range without paying for a batch. */
const SAMPLE_NOTES = 3;

/** New notes handled per run. The rest wait for the next check or a manual run. */
export const MAX_NEW_NOTES_PER_RUN = 5;

export function isPlanJobRunning(): boolean {
  return starting || planRunStore.get().job !== null;
}

export function cancelPlanJob(): void {
  controller?.abort();
}

/** Account-level failures: every remaining note would fail the same way. */
function isFatal(error: AppError): boolean {
  return (
    error.code === 'llm_unauthorized' ||
    error.code === 'llm_quota_exceeded' ||
    error.code === 'llm_not_configured'
  );
}

/**
 * The model plans run on. Mock is refused outright rather than quietly
 * falling back: there is no offline way to follow a plan, and a mock run would
 * fill a review with questions that ignore everything the reader agreed.
 */
export async function planCredentials(): Promise<LlmCredentials> {
  const target = resolveTarget('generate');
  if (!target) {
    throw new AppError('llm_not_configured', {
      message: 'Quiz plans need a real model. Pick a provider and add its key in Settings.',
    });
  }
  return resolveCredentials(target.providerId);
}

/** 5 across 3 notes -> [2, 2, 1]. */
export function distribute(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(total / parts);
  const extra = total % parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0)).filter((count) => count > 0);
}

function row(note: NoteCandidate): RunNote {
  return { key: coverageKey(note.sourceId, note.path), title: noteStem(note.path), status: 'pending', questionCount: 0 };
}

export type StartOutcome =
  | { ok: true; batchId: string; done: Promise<void> }
  | { ok: false; error: unknown };

export type StartBatchOptions = {
  kind: BatchKind;
  /** Questions to aim for. Ignored by samples (fixed) and new notes (per note). */
  size?: number;
};

/**
 * Starts writing a batch for a plan.
 *
 * Resolves once the batch EXISTS — after the key, the listing and the note
 * choice, all of which can fail before anything is spent — so a caller can
 * show the failure where the button was, or navigate to the batch. The writing
 * itself carries on in the background; `done` settles when it ends, and never
 * rejects.
 */
export async function startPlanBatch(planId: string, options: StartBatchOptions): Promise<StartOutcome> {
  if (isPlanJobRunning()) {
    return { ok: false, error: new AppError('unknown', { message: 'A plan is already writing — let it finish first.' }) };
  }
  starting = true;

  try {
    const plan = getPlan(planId);
    const spec = plan?.accepted;
    if (!plan || !spec) {
      return { ok: false, error: new AppError('unknown', { message: 'Accept a plan before writing questions.', retryable: false }) };
    }
    if (openBatch(plan)) {
      return { ok: false, error: new AppError('unknown', { message: 'Finish reviewing the open batch first.', retryable: false }) };
    }

    const credentials = await planCredentials();

    const catalog = await refreshCatalog();
    if (catalog.notes.length === 0) {
      return {
        ok: false,
        error: catalog.error ?? new AppError('unknown', { message: 'No notes could be listed from your sources.' }),
      };
    }

    const matched = resolveScope(catalog.notes, spec.scope);
    if (matched.length === 0) {
      return {
        ok: false,
        error: new AppError('unknown', {
          message: 'None of your notes match this plan. Change which notes it reads, then try again.',
          retryable: false,
        }),
      };
    }

    const perNote = spec.questionsPerNote;
    let candidates: NoteCandidate[];
    let counts: number[] | null = null;
    let target = Number.POSITIVE_INFINITY;
    let initialRows: number;

    if (options.kind === 'sample') {
      candidates = pickSampleNotes(matched, Math.min(SAMPLE_NOTES, SAMPLE_SIZE));
      counts = distribute(SAMPLE_SIZE, candidates.length);
      candidates = candidates.slice(0, counts.length);
      initialRows = candidates.length;
    } else if (options.kind === 'new-notes') {
      candidates = freshNotes(matched, plan.seen, plan.coverage).slice(0, MAX_NEW_NOTES_PER_RUN);
      initialRows = candidates.length;
    } else {
      candidates = orderForBatch({
        matched,
        coverage: plan.coverage,
        seen: plan.seen,
        depth: plan.settings.depth,
      });
      target = clampBatchSize(options.size ?? plan.settings.batchSize);
      initialRows = Math.min(candidates.length, notesForSize(target, perNote));
    }

    if (candidates.length === 0) {
      return {
        ok: false,
        error: new AppError('unknown', {
          message:
            options.kind === 'new-notes'
              ? 'There are no new notes for this plan.'
              : 'Every note in this plan has been read as often as it allows. Go deeper, or widen the plan.',
          retryable: false,
        }),
      };
    }

    const requested =
      options.kind === 'sample'
        ? SAMPLE_SIZE
        : options.kind === 'new-notes'
          ? candidates.length * perNote
          : target;

    const batch = beginBatch(planId, {
      kind: options.kind,
      requested,
      specVersion: spec.version,
      notes: candidates.slice(0, initialRows).map(row),
    });
    if (!batch) return { ok: false, error: new AppError('unknown', { message: 'The plan is gone.' }) };

    controller = new AbortController();
    planRunStore.set({ job: { kind: 'generate', planId, batchId: batch.id } });

    const done = writeBatch({
      planId,
      batchId: batch.id,
      kind: options.kind,
      candidates,
      counts,
      perNote,
      target,
      revisions: catalog.revisions,
      credentials,
      signal: controller.signal,
    });
    return { ok: true, batchId: batch.id, done };
  } catch (error) {
    return { ok: false, error };
  } finally {
    starting = false;
  }
}

async function writeBatch(input: {
  planId: string;
  batchId: string;
  kind: BatchKind;
  candidates: NoteCandidate[];
  counts: number[] | null;
  perNote: number;
  target: number;
  revisions: Record<string, string | undefined>;
  credentials: LlmCredentials;
  signal: AbortSignal;
}): Promise<void> {
  const { planId, batchId, kind, candidates, counts, perNote, target, revisions, credentials, signal } = input;
  const { provider, apiKey, model } = credentials;

  /*
    Read once, here, for the reason `llmGenerator` gives: a batch that takes
    minutes must not follow two sets of instructions if the reader edits
    Settings — or the plan — while it runs.
  */
  const spec = getPlan(planId)?.accepted;
  const guidance = getGuidance();
  const tracksCoverage = kind !== 'sample';

  let added = 0;
  /** Questions in-flight notes are expected to bring — the top-up's other half. */
  let reserved = 0;
  let firstError: string | undefined;

  const addUsage = (usage: { inputTokens: number; outputTokens: number }) =>
    patchBatch(planId, batchId, (batch) => ({
      ...batch,
      usage: {
        inputTokens: batch.usage.inputTokens + usage.inputTokens,
        outputTokens: batch.usage.outputTokens + usage.outputTokens,
      },
    }));

  try {
    if (!spec) throw new AppError('unknown', { message: 'The plan is gone.' });

    await forEachInPool(
      candidates,
      getConcurrency(),
      async (note, index) => {
        const key = coverageKey(note.sourceId, note.path);
        const count = counts ? counts[index] : perNote;
        reserved += count;
        // A top-up note was not in the first rows; it is added as it is claimed.
        appendBatchNotes(planId, batchId, [row(note)]);
        patchBatchNote(planId, batchId, key, { status: 'running' });

        try {
          const source = getSourceById(note.sourceId);
          if (!source) {
            patchBatchNote(planId, batchId, key, { status: 'skipped', error: 'Its source was disconnected.' });
            return;
          }

          const raw = await getSourceType(source).provider.readFile(source, note.path, {
            ref: revisions[note.sourceId],
            signal,
          });
          const parsed = parseNote(raw, noteStem(note.path));

          // Nothing readable — a page of screenshots. Not worth a request, and
          // not a failure: the note was read and holds nothing to ask.
          if (chunkNote(parsed).length === 0) {
            if (tracksCoverage) recordNoteRead(planId, note, 0);
            patchBatchNote(planId, batchId, key, { status: 'done', questionCount: 0 });
            return;
          }

          const plan = getPlan(planId);
          const result = await generateForPlan({
            note: parsed,
            path: note.path,
            sourceId: note.sourceId,
            revision: revisions[note.sourceId],
            planId,
            spec,
            count,
            alreadyAsked: plan ? askedForNote(plan, note.sourceId, note.path) : [],
            provider,
            apiKey,
            model,
            guidance,
            onUsage: addUsage,
            signal,
          });

          // Saved the moment it lands, so cancelling keeps what was paid for.
          const drafts = addDrafts(planId, batchId, result.questions);
          added += drafts.length;
          if (tracksCoverage) recordNoteRead(planId, note, drafts.length);
          patchBatchNote(planId, batchId, key, { status: 'done', questionCount: drafts.length });
        } catch (error) {
          // Cancelling is the reader's choice, not a failure of the note.
          if (signal.aborted) {
            patchBatchNote(planId, batchId, key, { status: 'skipped' });
            return;
          }
          const appError = toAppError(error);
          firstError ??= userMessage(appError);
          if (tracksCoverage) recordNoteFailure(planId, note);
          patchBatchNote(planId, batchId, key, { status: 'failed', error: userMessage(appError) });
          if (isFatal(appError)) throw appError;
        } finally {
          reserved -= count;
        }
      },
      {
        /*
          A batch is "about N": every note is asked for the plan's full density,
          and notes are claimed only while what is in hand plus what is in
          flight falls short of N. A thin note therefore pulls in another
          rather than leaving the batch short — and a full note is never cut
          off mid-pass to hit an exact number.
        */
        stop: () => signal.aborted || added + reserved >= target,
      },
    );
  } catch (error) {
    firstError ??= userMessage(error);
  } finally {
    finishBatch(planId, batchId, { aborted: signal.aborted, error: firstError });
    controller = null;
    planRunStore.set({ job: null });
  }
}

/** Settles rows, sets the batch's final status, and keeps it on autopilot. */
function finishBatch(planId: string, batchId: string, outcome: { aborted: boolean; error?: string }): void {
  patchBatch(planId, batchId, (batch) => {
    const notes = batch.notes.map((note) =>
      note.status === 'pending' || note.status === 'running' ? { ...note, status: 'skipped' as const } : note,
    );
    const hasDrafts = batch.drafts.length > 0;
    const error = hasDrafts
      ? outcome.aborted
        ? 'Stopped early — these are the questions written before you cancelled.'
        : undefined
      : outcome.aborted
        ? 'Cancelled before anything was written.'
        : (outcome.error ?? 'Nothing new came back from these notes.');
    return {
      ...batch,
      notes,
      status: hasDrafts ? 'review' : 'failed',
      ...(hasDrafts ? {} : { settledAt: Date.now() }),
      ...(error ? { error } : {}),
    };
  });

  const plan = getPlan(planId);
  const batch = plan?.batches.find((entry) => entry.id === batchId);
  if (plan && batch?.status === 'review' && batch.kind !== 'sample' && plan.settings.mode === 'autopilot') {
    acceptBatch(planId, batchId, { auto: true });
  }
}

// ---------------------------------------------------------------------------
// Fixing flagged drafts
// ---------------------------------------------------------------------------

/**
 * Rewrites every draft the reader marked "fix", each with its own feedback,
 * and puts the batch back in review so the rewrites are seen before they are
 * kept. A rewrite that fails leaves the original in place with the reason.
 */
export async function startFixDrafts(planId: string, batchId: string): Promise<StartOutcome> {
  if (isPlanJobRunning()) {
    return { ok: false, error: new AppError('unknown', { message: 'A plan is already writing — let it finish first.' }) };
  }
  starting = true;

  try {
    const plan = getPlan(planId);
    const batch = getBatch(planId, batchId);
    if (!plan?.accepted || !batch || batch.status !== 'review') {
      return { ok: false, error: new AppError('unknown', { message: 'This batch is not waiting for review.', retryable: false }) };
    }
    const targets = batch.drafts.filter((draft) => batch.reviews[draft.id]?.verdict === 'fix');
    if (targets.length === 0) {
      return { ok: false, error: new AppError('unknown', { message: 'Nothing is marked to fix.', retryable: false }) };
    }

    const credentials = await planCredentials();
    const guidance = specGuidance(plan.accepted, getGuidance());

    controller = new AbortController();
    const signal = controller.signal;
    planRunStore.set({ job: { kind: 'fix', planId, batchId } });
    patchBatch(planId, batchId, (current) => ({ ...current, status: 'fixing' }));

    const done = (async () => {
      try {
        await forEachInPool(
          targets,
          getConcurrency(),
          async (draft) => {
            const review = getBatch(planId, batchId)?.reviews[draft.id];
            if (!review) return;
            try {
              const result = await reviseQuestion({
                question: draft,
                instruction: fixInstruction(review),
                provider: credentials.provider,
                apiKey: credentials.apiKey,
                model: credentials.model,
                guidance,
                signal,
              });
              patchBatch(planId, batchId, (current) => ({
                ...current,
                usage: {
                  inputTokens: current.usage.inputTokens + result.usage.inputTokens,
                  outputTokens: current.usage.outputTokens + result.usage.outputTokens,
                },
              }));
              replaceDraft(
                planId,
                batchId,
                { ...result.question, planId },
                { tags: [], note: '', revisedFrom: draft.prompt },
              );
            } catch (error) {
              if (signal.aborted) return;
              const appError = toAppError(error);
              setDraftReview(planId, batchId, draft.id, { ...review, error: userMessage(appError) });
              if (isFatal(appError)) throw appError;
            }
          },
          { stop: () => signal.aborted },
        );
      } catch {
        // Each draft's failure is already recorded against it.
      } finally {
        patchBatch(planId, batchId, (current) =>
          current.status === 'fixing' ? { ...current, status: 'review' } : current,
        );
        controller = null;
        planRunStore.set({ job: null });
      }
    })();

    return { ok: true, batchId, done };
  } catch (error) {
    return { ok: false, error };
  } finally {
    starting = false;
  }
}
