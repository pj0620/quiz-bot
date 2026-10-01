import { AppError } from '../../lib/errors';
import { sanitizeSpec } from '../../quiz/builder/planSpec';
import type { PlanSpec } from '../../quiz/builder/types';
import type { LlmProviderDefinition } from './contract';
import { extractJson } from './parseQuestions';
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  type PlannerUserPromptInput,
} from './planPrompt';

/**
 * One turn of planning: the conversation so far in, a reply and an updated
 * plan out.
 *
 * Stateless, like every request in this app — the whole conversation is sent
 * each turn, which is what lets it run over the same single-message
 * `complete()` both providers already implement, with no per-provider chat
 * plumbing to keep in step.
 */

/**
 * A reply and a plan are a few hundred tokens; the rest is room to think.
 * Generous on purpose: a planner cut off mid-JSON loses the whole turn, and
 * the turn is the cheap part of a quiz plan.
 */
const PLANNER_TOKEN_BUDGET = 8_000;

const MAX_REPLY_CHARS = 2_000;

export type PlannerTurnInput = PlannerUserPromptInput & {
  /** The working plan, so a reply that leaves fields out keeps them. */
  previous: PlanSpec | null;
  provider: LlmProviderDefinition;
  apiKey: string;
  model: string;
  /** Fired before the reply is judged usable — it was billed either way. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void;
  now?: number;
  signal?: AbortSignal;
};

export type PlannerReply = {
  reply: string;
  /** The updated plan — `previous` itself when the turn changed nothing. */
  spec: PlanSpec | null;
  ready: boolean;
};

export type PlannerTurnResult = PlannerReply & {
  usage: { inputTokens: number; outputTokens: number };
};

/**
 * Reads the planner's reply, forgiving everything that can be forgiven.
 *
 * A reply in plain prose — a model ignoring the JSON instruction — is still a
 * reply worth showing, so it is shown with the plan left as it was, rather
 * than thrown away as a failure the reader has to pay to retry. The plan
 * nested at the root instead of under "plan" is read from there. Only a reply
 * with nothing at all in it is an error.
 */
export function parsePlannerReply(text: string, previous: PlanSpec | null, now: number): PlannerReply | null {
  const parsed = extractJson(text);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const prose = text.trim();
    return prose ? { reply: prose.slice(0, MAX_REPLY_CHARS), spec: previous, ready: false } : null;
  }

  const row = parsed as Record<string, unknown>;
  const reply = typeof row.reply === 'string' ? row.reply.trim().slice(0, MAX_REPLY_CHARS) : '';
  const planRow =
    row.plan && typeof row.plan === 'object'
      ? row.plan
      : 'title' in row || 'scope' in row || 'focus' in row
        ? row
        : null;
  const spec = (planRow ? sanitizeSpec(planRow, previous, now) : null) ?? previous;
  const changed = spec !== previous;

  if (!reply && !changed) return null;
  return {
    reply: reply || 'I’ve updated the plan.',
    spec,
    ready: row.ready === true || (row.ready === undefined && !!spec),
  };
}

export async function runPlannerTurn(input: PlannerTurnInput): Promise<PlannerTurnResult> {
  const { provider, apiKey, model, signal } = input;
  if (!apiKey) throw new AppError('llm_not_configured');

  const completion = await provider.complete({
    apiKey,
    model,
    system: buildPlannerSystemPrompt(),
    user: buildPlannerUserPrompt(input),
    maxTokens: PLANNER_TOKEN_BUDGET,
    json: true,
    // A conversation is waited on line by line. Planning is judgement over a
    // short brief, not a long read, so it runs at the cheaper, faster setting.
    effort: 'low',
    signal,
  });

  input.onUsage?.(completion.usage);

  if (completion.stopReason === 'length') {
    throw new AppError('llm_bad_response', {
      message: `${model} was cut off before finishing its reply. Try again.`,
    });
  }

  const reply = parsePlannerReply(completion.text, input.previous, input.now ?? Date.now());
  if (!reply) {
    throw new AppError('llm_bad_response', { message: "The planner's reply was empty. Try again." });
  }
  return { ...reply, usage: completion.usage };
}
