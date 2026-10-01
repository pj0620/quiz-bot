import type { Question } from '../types';
import type { DraftReview, FeedbackTag, PlanBatch } from './types';

/**
 * Turning a reader's review into words a model can act on.
 *
 * Two audiences, two jobs. A FIX goes to the question writer and is about one
 * question: make this better, this way. A DIGEST goes to the planner and is
 * about the pattern: what keeps going wrong, so the plan can stop it. The tags
 * serve both, which is why each carries its instruction rather than the
 * screens composing one.
 */

export type FeedbackTagInfo = {
  tag: FeedbackTag;
  /** The chip. Short enough that the whole row fits a phone. */
  label: string;
  /** What the writer is told when fixing a question tagged with this. */
  instruction: string;
};

export const FEEDBACK_TAGS: readonly FeedbackTagInfo[] = [
  {
    tag: 'too-easy',
    label: 'Too easy',
    instruction: 'It is too easy. Make it test understanding — why, how, what follows — rather than recognition.',
  },
  {
    tag: 'too-hard',
    label: 'Too hard',
    instruction: 'It is too hard or too specific. Make it more direct and approachable without losing the idea.',
  },
  {
    tag: 'trivia',
    label: 'Not worth knowing',
    instruction:
      'It asks about a detail not worth remembering. Ask about the idea that detail was there to illustrate instead.',
  },
  {
    tag: 'unclear',
    label: 'Unclear',
    instruction: 'The wording is unclear or ambiguous. Make it unambiguous, and able to stand on its own.',
  },
  {
    tag: 'wrong',
    label: 'Wrong answer',
    instruction:
      'The answer is wrong or doubtful. Correct it, or ask something that can be answered with confidence.',
  },
  {
    tag: 'repeat',
    label: 'Repetitive',
    instruction: 'It repeats another question. Ask about something different from the same material.',
  },
  {
    tag: 'format',
    label: 'Wrong format',
    instruction: 'The format does not suit the material. Rewrite it in a better-suited format.',
  },
];

export function tagLabel(tag: FeedbackTag): string {
  return FEEDBACK_TAGS.find((info) => info.tag === tag)?.label ?? tag;
}

export function emptyReview(): DraftReview {
  return { tags: [], note: '' };
}

/**
 * The instruction a fix sends with one question: every tagged problem, then
 * the reader's own words, which are the most specific thing available.
 */
export function fixInstruction(review: DraftReview): string {
  const parts = review.tags
    .map((tag) => FEEDBACK_TAGS.find((info) => info.tag === tag)?.instruction)
    .filter((part): part is string => !!part);
  const note = review.note.trim();
  if (note) parts.push(`The reader says: "${note}"`);
  return parts.length > 0 ? parts.join('\n') : 'Make this a better question for this quiz.';
}

export type ReviewTally = {
  total: number;
  /** Explicitly kept. */
  keep: number;
  fix: number;
  drop: number;
  /** Not looked at — kept along with `keep` when the batch is accepted. */
  unreviewed: number;
};

export function tallyReviews(batch: Pick<PlanBatch, 'drafts' | 'reviews'>): ReviewTally {
  const tally: ReviewTally = { total: batch.drafts.length, keep: 0, fix: 0, drop: 0, unreviewed: 0 };
  for (const draft of batch.drafts) {
    const verdict = batch.reviews[draft.id]?.verdict;
    if (verdict === 'keep') tally.keep += 1;
    else if (verdict === 'fix') tally.fix += 1;
    else if (verdict === 'drop') tally.drop += 1;
    else tally.unreviewed += 1;
  }
  return tally;
}

/**
 * The drafts that go into the bank when a batch is kept.
 *
 * A draft still marked "fix" is LEFT OUT: the reader said it was not good
 * enough as written, and keeping the batch anyway is a decision about the rest
 * of it, not a reversal of that one. The keep button says how many it drops,
 * so this is never a surprise.
 */
export function draftsToKeep(batch: Pick<PlanBatch, 'drafts' | 'reviews'>): Question[] {
  return batch.drafts.filter((draft) => {
    const verdict = batch.reviews[draft.id]?.verdict;
    return verdict !== 'drop' && verdict !== 'fix';
  });
}

const MAX_DIGEST_ROWS = 10;
const MAX_DIGEST_PROMPT_CHARS = 140;

function quoted(question: Question): string {
  const prompt = question.prompt.replace(/\s+/g, ' ').trim();
  return `“${prompt.length > MAX_DIGEST_PROMPT_CHARS ? `${prompt.slice(0, MAX_DIGEST_PROMPT_CHARS - 1)}…` : prompt}”`;
}

/** The reader's own words survive; an essay pasted into one note is trimmed. */
const MAX_DIGEST_NOTE_CHARS = 200;

function reasons(review: DraftReview | undefined): string {
  if (!review) return '';
  const parts = review.tags.map(tagLabel);
  const note = review.note.replace(/\s+/g, ' ').trim();
  if (note) {
    parts.push(`"${note.length > MAX_DIGEST_NOTE_CHARS ? `${note.slice(0, MAX_DIGEST_NOTE_CHARS - 1)}…` : note}"`);
  }
  return parts.length > 0 ? ` — ${parts.join('; ')}` : '';
}

function section(title: string, rows: string[]): string[] {
  if (rows.length === 0) return [];
  const shown = rows.slice(0, MAX_DIGEST_ROWS);
  const more = rows.length - shown.length;
  return ['', title, ...shown, ...(more > 0 ? [`…and ${more} more`] : [])];
}

/**
 * The reader's review of a batch, written as a message to the planner.
 *
 * Shaped around what the planner can change: the questions that needed work
 * and why come first, with the reader's own words quoted, because that is the
 * pattern a plan revision has to stop. Liked questions are included too — they
 * are what the revision must NOT break.
 */
export function feedbackDigest(batch: PlanBatch, label: string): string {
  const liked: string[] = [];
  const needWork: string[] = [];
  const dropped: string[] = [];
  let silent = 0;

  for (const draft of batch.drafts) {
    const review = batch.reviews[draft.id];
    switch (review?.verdict) {
      case 'keep':
        liked.push(`- ${quoted(draft)}${reasons(review)}`);
        break;
      case 'fix':
        needWork.push(`- ${quoted(draft)}${reasons(review)}`);
        break;
      case 'drop':
        dropped.push(`- ${quoted(draft)}${reasons(review)}`);
        break;
      default:
        silent += 1;
    }
  }

  const lines = [`My feedback on ${label.toLowerCase()} (${batch.drafts.length} questions):`];
  lines.push(...section('Needed work:', needWork));
  lines.push(...section('Dropped:', dropped));
  lines.push(...section('Liked:', liked));
  if (silent > 0) lines.push('', `${silent} more were fine as they were.`);
  lines.push('', 'Update the plan so the next questions avoid these problems and keep what worked.');
  return lines.join('\n');
}

/** Whether a review holds anything worth sending to the planner. */
export function hasFeedback(batch: Pick<PlanBatch, 'drafts' | 'reviews'>): boolean {
  return batch.drafts.some((draft) => {
    const review = batch.reviews[draft.id];
    return !!review && (review.verdict === 'fix' || review.verdict === 'drop' || review.tags.length > 0 || !!review.note.trim());
  });
}
