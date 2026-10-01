import { createStore } from '../../lib/createStore';
import { runPlannerTurn } from '../../features/llm/planTurn';
import { noteStem } from '../../notes/paths';
import { describeCatalog } from './catalog';
import { refreshCatalog } from './notesCatalog';
import { specForPlanner } from './planSpec';
import { planCredentials } from './runStore';
import { resolveScope } from './scope';
import { addPlannerUsage, appendMessage, applyPlannerReply, getPlan } from './store';

/**
 * The conversation with the planner: one turn in flight per plan.
 *
 * Separate from the run lock on purpose. A turn is a short request about the
 * plan, not work done with it, so chatting about plan B while plan A writes a
 * batch — or about the next version of plan A itself, since a batch follows
 * the ACCEPTED version — is exactly what should be possible.
 */

export type PlannerTurnState = { thinking: boolean; error?: unknown };

export const plannerStore = createStore<{ turns: Record<string, PlannerTurnState> }>({ turns: {} });

const controllers = new Map<string, AbortController>();

/** Plans whose turn in flight was superseded, and must be answered again when it settles. */
const rerun = new Set<string>();

/** How many matched note names the planner sees, to check its scope picks the right ones. */
const MATCH_SAMPLE = 12;

function setTurn(planId: string, state: PlannerTurnState | null): void {
  plannerStore.set((current) => {
    const turns = { ...current.turns };
    if (state) turns[planId] = state;
    else delete turns[planId];
    return { turns };
  });
}

export function getPlannerTurn(planId: string): PlannerTurnState | undefined {
  return plannerStore.get().turns[planId];
}

/**
 * Runs the planner over the conversation as it stands. Never rejects: a
 * failure lands in `plannerStore` beside the conversation, with the reader's
 * message already saved, so retrying is one tap and nothing is retyped.
 *
 * `supersede` is for a message added while a turn is already thinking — a
 * review's feedback, sent from another screen. The turn in flight was built
 * from a transcript without it, so its answer would ignore the feedback; it
 * is stopped, and a fresh turn answers the conversation as it now stands.
 */
export async function runPlannerFor(planId: string, options: { supersede?: boolean } = {}): Promise<void> {
  if (plannerStore.get().turns[planId]?.thinking) {
    if (options.supersede) {
      rerun.add(planId);
      controllers.get(planId)?.abort();
    }
    return;
  }
  const controller = new AbortController();
  controllers.set(planId, controller);
  setTurn(planId, { thinking: true });

  let billed: { inputTokens: number; outputTokens: number } | null = null;

  try {
    const credentials = await planCredentials();
    const catalog = await refreshCatalog();

    const plan = getPlan(planId);
    if (!plan) {
      // Deleted while the listing loaded — nothing left to answer.
      setTurn(planId, null);
      return;
    }
    const working = plan.spec;
    const notes = catalog.notes;
    const haveNotes = notes.length > 0;

    const matched = working && haveNotes ? resolveScope(notes, working.scope) : [];

    const result = await runPlannerTurn({
      request: plan.request,
      catalog: haveNotes ? describeCatalog(notes) : null,
      plan: working ? specForPlanner(working) : null,
      match:
        working && haveNotes
          ? {
              count: matched.length,
              total: notes.length,
              sample: matched.slice(0, MATCH_SAMPLE).map((note) => noteStem(note.path)),
            }
          : null,
      transcript: plan.messages.map((message) => ({
        role: message.role,
        text: message.text,
        ...(message.kind === 'feedback' ? { feedback: true } : {}),
      })),
      previous: working,
      provider: credentials.provider,
      apiKey: credentials.apiKey,
      model: credentials.model,
      onUsage: (usage) => {
        billed = usage;
      },
      signal: controller.signal,
    });

    /*
      The reply was written against the plan as it stood when the turn began.
      If the reader edited the plan by hand while the model was thinking, that
      edit is newer than anything in the reply — so the words are shown, and
      the proposal is not allowed to overwrite what the reader just did.
    */
    const current = getPlan(planId)?.spec ?? null;
    const unchangedMeanwhile = current?.version === working?.version;
    applyPlannerReply(planId, {
      text: result.reply,
      spec: unchangedMeanwhile ? result.spec : current,
      usage: result.usage,
    });
    setTurn(planId, null);
  } catch (error) {
    if (billed) addPlannerUsage(planId, billed);
    setTurn(planId, controller.signal.aborted ? null : { thinking: false, error });
  } finally {
    controllers.delete(planId);
    if (rerun.delete(planId) && getPlan(planId)) void runPlannerFor(planId);
  }
}

/** The reader's message, saved first and then answered. */
export async function sendPlannerMessage(planId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  if (plannerStore.get().turns[planId]?.thinking) return;
  appendMessage(planId, { role: 'user', text: trimmed });
  await runPlannerFor(planId);
}

export function cancelPlannerTurn(planId: string): void {
  rerun.delete(planId);
  controllers.get(planId)?.abort();
}

export function dismissPlannerError(planId: string): void {
  if (plannerStore.get().turns[planId]?.error) setTurn(planId, null);
}
