import type { ParsedNote } from '../../notes/parse';
import { buildNoteBlock } from './prompt';

/**
 * The prompts behind quiz plans: the PLANNER, who agrees a plan with the
 * reader in conversation, and the closing a note request gets when it is
 * written under a plan.
 *
 * Pure string building, kept apart from anything that makes a request, like
 * `prompt.ts`. Three things here are load-bearing:
 *
 *  - The planner does NOT write questions. A separate writer does, following
 *    the plan note by note, and that writer already carries the whole of
 *    `buildSystemPrompt` — standing alone, the five-year test, one idea per
 *    question. A plan that repeats those rules back is noise; a plan is for
 *    what is particular to THIS quiz. The prompt says so, because the failure
 *    otherwise is a focus list reading "clear, well-written questions".
 *
 *  - The scope is a rule the APP evaluates, not a list the planner writes.
 *    It proposes phrases; each turn it is told exactly how many notes they
 *    match and which. That report is the only way a model can know its scope
 *    matched nothing, so it is never left out.
 *
 *  - It proposes a complete plan straight away. A planner that interviews the
 *    reader before offering anything turns a two-tap flow into a form to fill
 *    in by chat; making sensible assumptions and saying which ones matter is
 *    what makes the conversation short.
 */

export const PLANNER_FORMAT_NOTES = `- multiple-choice: pick one of 3-5 options
- true-false: judge a statement
- short-answer: answer in a sentence, marked by the app
- list-recall: name several items of a real list
- fill-blank: supply a missing fact in a sentence
- timeline: put 3-6 events in order`;

export function buildPlannerSystemPrompt(): string {
  return `You are a quiz designer. You are working with one person to plan a quiz built
from their own study notes — notes they wrote while reading books, listening to
podcasts or taking courses.

They tell you what they want to be quizzed on and which notes it should draw
from. Together you agree a PLAN: which notes it reads, what the questions should
go after, what to leave alone, which formats, how hard, and how many questions
each note is worth. When they accept it, a separate writer generates the
questions note by note, following the plan to the letter. Then they review the
questions in batches and tell you what to change.

THE WRITER ALREADY KNOWS HOW TO WRITE A GOOD QUESTION. It makes every question
stand alone, carry its own context, test one idea, and skip what nobody would
remember in five years. Do not put any of that in the plan. The plan is for what
is particular to THIS quiz — "the two systems and the biases they cause", "skip
the experiments' sample sizes", "dates only to the decade".

HOW TO TALK
- Brief and concrete: two to five sentences in "reply". No headings. A short
  list only when you are offering them a choice.
- Propose a complete plan straight away, from the very first message. Make
  sensible assumptions, say which one or two matter, and ask at most two
  questions — only ones whose answers would really change the plan.
- When they give FEEDBACK on generated questions, find the pattern behind it
  and change the plan so the writer stops making that mistake. Say which rule
  you added or changed, quoting it.
- You only write the plan. Never claim to have written, changed or deleted
  questions — the app does that when the reader asks it to.
- Batch size and autopilot are switches on the plan screen, not part of the
  plan. If asked, say where they are.

CHOOSING THE NOTES
You are shown a catalogue of their notes, and — once there is a plan — exactly
how many notes its scope matches and which. "scope.terms" are phrases matched
against each note's folder and filename, ignoring case and punctuation, as
WHOLE WORDS; a note matches if ANY term appears. The name of a series, written
the way the catalogue spells it, is usually the best term. "scope.excludeTerms"
rule notes out; "scope.folders" restricts to top-level folders. All empty means
every note they have — only propose that if it is really what they asked for.
If the match report says the scope matches nothing, or the wrong notes, fix it.

THE PLAN
- title: a short name, as they would say it.
- summary: one or two sentences on what this quiz is for.
- focus: 2-6 short bullets naming what the questions should go after.
- avoid: 0-6 short bullets naming what to leave alone.
- formats: an empty list for a natural mix, unless they care. The formats:
${PLANNER_FORMAT_NOTES}
- difficulty: "gentle", "mixed" or "challenging".
- questionsPerNote: 2-10. A dense chapter is worth more than a page of jottings.
- style: anything else about tone or wording, in a sentence, or "".

Return JSON only, with no other text:
{"reply":"what you say to them","plan":{"title":"...","summary":"...",
"scope":{"terms":["..."],"excludeTerms":[],"folders":[]},"focus":["..."],
"avoid":["..."],"formats":[],"difficulty":"mixed","questionsPerNote":5,
"style":""},"ready":true}

Always send the WHOLE plan, every field, even when only one thing changed.
"ready" is true when the plan is complete enough to try sample questions.`;
}

export type PlannerTranscriptEntry = {
  role: 'user' | 'assistant' | 'event';
  text: string;
  /** A review's digest rather than something typed. */
  feedback?: boolean;
};

export type PlannerUserPromptInput = {
  /**
   * What the reader first asked for, verbatim. Sent on its own every turn:
   * the conversation is trimmed — and a long-lived plan's stored history
   * eventually drops its opening — but what the quiz is FOR never should be.
   */
  request?: string;
  /** `describeCatalog` output, or null when the notes could not be listed. */
  catalog: string | null;
  /** The working plan as the planner writes it (`specForPlanner`), or null. */
  plan: Record<string, unknown> | null;
  /** How many notes the plan's scope matches right now, and some of their names. */
  match: { count: number; total: number; sample: string[] } | null;
  transcript: readonly PlannerTranscriptEntry[];
};

/** Recent turns, plus the opening request, which frames everything after it. */
const MAX_TRANSCRIPT_ENTRIES = 24;
const MAX_TRANSCRIPT_CHARS = 14_000;

const SPEAKERS: Record<PlannerTranscriptEntry['role'], string> = {
  user: 'READER',
  assistant: 'YOU',
  event: 'APP',
};

/**
 * The conversation, newest last, trimmed from the oldest end — except the
 * reader's opening request, which is kept whatever happens: without it a long
 * conversation loses what the quiz was for.
 */
export function formatTranscript(entries: readonly PlannerTranscriptEntry[]): string {
  if (entries.length === 0) return '(nothing yet)';
  const render = (entry: PlannerTranscriptEntry) =>
    `${SPEAKERS[entry.role]}${entry.feedback ? ' (review feedback)' : ''}: ${entry.text.trim()}`;

  const [first, ...rest] = entries;
  const recent = rest.slice(-(MAX_TRANSCRIPT_ENTRIES - 1)).map(render);
  const opening = render(first);

  let budget = MAX_TRANSCRIPT_CHARS - opening.length;
  const kept: string[] = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].length > budget && kept.length > 0) break;
    kept.unshift(recent[index]);
    budget -= recent[index].length;
  }

  const skipped = rest.length - kept.length;
  return [opening, ...(skipped > 0 ? [`(${skipped} earlier messages omitted)`] : []), ...kept].join('\n\n');
}

export function describeMatch(match: PlannerUserPromptInput['match']): string {
  if (!match) return 'The notes could not be listed just now, so the scope cannot be checked this turn.';
  if (match.count === 0) {
    return `The plan's scope matches NONE of their ${match.total} notes. Fix "scope" so it picks out the notes they mean.`;
  }
  const more = match.count > match.sample.length ? '; …' : '';
  return `The plan's scope matches ${match.count} of their ${match.total} notes: ${match.sample.join('; ')}${more}`;
}

export function buildPlannerUserPrompt(input: PlannerUserPromptInput): string {
  const request = input.request?.trim();
  const sections = [
    ...(request ? [`WHAT THEY FIRST ASKED FOR\n${request}`] : []),
    `THEIR NOTES\n${input.catalog ?? 'The notes could not be listed just now. Plan from what they say, and keep the scope simple.'}`,
    input.plan
      ? `THE PLAN SO FAR\n${JSON.stringify(input.plan)}\n${describeMatch(input.match)}`
      : 'THE PLAN SO FAR\nNo plan yet — propose a complete one.',
    `THE CONVERSATION\n${formatTranscript(input.transcript)}`,
    'Reply to their latest message, and return the whole plan, updated.',
  ];
  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Writing questions under a plan
// ---------------------------------------------------------------------------

const MAX_ALREADY_ASKED = 30;
const MAX_ASKED_CHARS = 100;

/**
 * A note request under a plan: the note exactly as note generation shows it,
 * then a closing that holds the writer to the plan and to a count.
 *
 * The count is the plan's density, and it is a ceiling the writer is ASKED TO
 * USE — unlike plain note generation, whose closing says most notes should
 * come in well under it. The reader chose "five a note" when they agreed the
 * plan; the writer second-guessing that downwards is the thing to prevent.
 */
export function buildPlanQuestionsUserPrompt(input: {
  note: ParsedNote;
  filename: string;
  count: number;
  alreadyAsked?: readonly string[];
}): string {
  const asked = (input.alreadyAsked ?? []).slice(-MAX_ALREADY_ASKED);
  const askedBlock =
    asked.length > 0
      ? `\n\nThis quiz already has these questions from this note. Do not ask any of
them again, and do not reword them — ask about what they leave out:
${asked.map((prompt) => `- ${prompt.slice(0, MAX_ASKED_CHARS)}`).join('\n')}`
      : '';

  return `${buildNoteBlock(input.note, input.filename)}${askedBlock}

Write ${input.count} question${input.count === 1 ? '' : 's'} from this note for the quiz plan you
were given. Stay inside the plan: ask about what it says to ask about, leave
alone what it says to leave alone, and keep to its formats and difficulty.
Write fewer only if the note genuinely holds less that fits the plan, and lead
with the questions that matter most.

Read the note in the context above: expand its shorthand, and treat the subjects
it raises as the topic, not just the specific lines it happens to contain.`;
}
