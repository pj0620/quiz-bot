jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { coverageKey } from '../generation/coverage';
import type { NoteCandidate } from '../generation/selectNotes';
import { addQuestions, clearQuestionBank, getQuestions, getQuizById, quizzesStore } from '../store';
import type { MultipleChoiceQuestion } from '../types';
import {
  acceptBatch,
  acceptSpec,
  addDrafts,
  applyPlannerReply,
  askedForNote,
  baselinePlan,
  beginBatch,
  createPlan,
  deletePlan,
  discardBatch,
  getPlan,
  markNotesSeen,
  plansStore,
  questionsForPlan,
  recordNoteFailure,
  recordNoteRead,
  replaceDraft,
  resetAllPlanCoverage,
  saveHandEdit,
  setDraftReview,
  updateDraft,
  updatePlanSettings,
} from './store';
import { emptyScope, isValidPlan, normalizePlan, type PlanSpec, type QuizPlan } from './types';

const NOW = 1_760_000_000_000;

function question(id: string, path = 'Books/TFAS 1.md'): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}?`,
    explanation: 'Because.',
    topics: ['tfas'],
    difficulty: 'core',
    sourceId: 'github-repo:1',
    provenance: { sourceId: 'github-repo:1', path },
    addedAt: NOW,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
  };
}

function spec(version: number, overrides: Partial<PlanSpec> = {}): PlanSpec {
  return {
    version,
    title: 'TFAS',
    summary: '',
    scope: { ...emptyScope(), terms: ['TFAS'] },
    focus: [],
    avoid: [],
    formats: [],
    difficulty: 'mixed',
    questionsPerNote: 5,
    style: '',
    author: 'ai',
    updatedAt: NOW,
    ...overrides,
  };
}

function note(path: string, contentHash = `h-${path}`): NoteCandidate {
  return { sourceId: 'github-repo:1', path, contentHash, title: path, folder: 'Books' };
}

/** A plan whose v1 the reader has accepted. */
function acceptedPlan(): QuizPlan {
  const plan = createPlan('Quiz me on TFAS', NOW);
  applyPlannerReply(plan.id, { text: 'Here is a plan.', spec: spec(1) }, NOW);
  acceptSpec(plan.id, NOW);
  return getPlan(plan.id)!;
}

function openBatchWith(planId: string, ids: string[]) {
  const batch = beginBatch(planId, { kind: 'batch', requested: ids.length, specVersion: 1, notes: [] }, NOW)!;
  addDrafts(planId, batch.id, ids.map((id) => question(id)));
  return batch;
}

beforeEach(() => {
  plansStore.set({ plans: [] });
  quizzesStore.set({ quizzes: [] });
  clearQuestionBank();
});

describe('the conversation', () => {
  it('starts a plan with the reader’s request as its first message', () => {
    const plan = createPlan('  Quiz me on my Thinking Fast and Slow notes  ', NOW);
    expect(plan.request).toBe('Quiz me on my Thinking Fast and Slow notes');
    expect(plan.messages).toEqual([expect.objectContaining({ role: 'user', text: plan.request })]);
    expect(plan.spec).toBeNull();
    expect(plan.accepted).toBeNull();
  });

  it('records the plan version a reply produced, and its cost', () => {
    const plan = createPlan('TFAS', NOW);
    applyPlannerReply(plan.id, { text: 'Plan v1.', spec: spec(1), usage: { inputTokens: 5, outputTokens: 7 } }, NOW);
    const updated = getPlan(plan.id)!;
    expect(updated.spec?.version).toBe(1);
    expect(updated.messages[1]).toMatchObject({ role: 'assistant', planVersion: 1 });
    expect(updated.plannerUsage).toEqual({ inputTokens: 5, outputTokens: 7 });
  });

  it('records no version when the reply left the plan as it was', () => {
    const plan = acceptedPlan();
    applyPlannerReply(plan.id, { text: 'Just answering.', spec: plan.spec }, NOW);
    expect(getPlan(plan.id)!.messages.at(-1)?.planVersion).toBeUndefined();
  });

  it('accepts the working plan once, and says so in the conversation', () => {
    const plan = createPlan('TFAS', NOW);
    applyPlannerReply(plan.id, { text: 'Plan.', spec: spec(1) }, NOW);
    expect(acceptSpec(plan.id, NOW)?.version).toBe(1);
    acceptSpec(plan.id, NOW);
    const events = getPlan(plan.id)!.messages.filter((message) => message.role === 'event');
    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('You accepted plan v1.');
  });
});

describe('hand edits', () => {
  it('accept themselves on a plan already in use', () => {
    const plan = acceptedPlan();
    const saved = saveHandEdit(plan.id, { ...plan.spec!, difficulty: 'challenging' }, NOW);
    const updated = getPlan(plan.id)!;
    expect(saved?.version).toBe(2);
    expect(updated.accepted?.version).toBe(2);
    expect(updated.accepted?.author).toBe('user');
  });

  /*
    The planner proposed v2 and the reader has not accepted it. A hand edit
    must start from v1 — the plan in force — or saving a new title would slip
    every unreviewed change in v2 past the reader.
  */
  it('start from the accepted plan, replacing a pending proposal out loud', () => {
    const plan = acceptedPlan();
    applyPlannerReply(plan.id, { text: 'Harder.', spec: spec(2, { difficulty: 'challenging' }) });
    const saved = saveHandEdit(plan.id, { ...spec(1), title: 'My title' }, NOW);
    const updated = getPlan(plan.id)!;
    expect(saved).toMatchObject({ version: 3, title: 'My title', difficulty: 'mixed' });
    expect(updated.accepted).toBe(updated.spec);
    expect(updated.messages.at(-1)?.text).toBe('You edited the plan by hand (v3), replacing the planner’s unaccepted v2.');
  });

  it('leave a plan still being drafted waiting for acceptance', () => {
    const plan = createPlan('TFAS', NOW);
    applyPlannerReply(plan.id, { text: 'Plan.', spec: spec(1) }, NOW);
    saveHandEdit(plan.id, { ...spec(1), title: 'Mine' }, NOW);
    expect(getPlan(plan.id)!.accepted).toBeNull();
    expect(getPlan(plan.id)!.spec?.title).toBe('Mine');
  });
});

describe('what the plan has read', () => {
  /*
    The baseline only ADDS. Rewriting a known note's hash would silently
    absorb an edit — the exact change the new-note check exists to notice.
  */
  it('baselines the notes in scope without overwriting a known version', () => {
    const plan = acceptedPlan();
    markNotesSeen(plan.id, [note('a.md', 'old')]);
    baselinePlan(plan.id, [note('a.md', 'new'), note('b.md')], NOW);
    const updated = getPlan(plan.id)!;
    expect(updated.seen[coverageKey('github-repo:1', 'a.md')]).toBe('old');
    expect(updated.seen[coverageKey('github-repo:1', 'b.md')]).toBe('h-b.md');
    expect(updated.baselinedAt).toBe(NOW);
  });

  it('counts passes, clears failures on success, and acknowledges the version read', () => {
    const plan = acceptedPlan();
    const target = note('a.md');
    recordNoteFailure(plan.id, target, NOW);
    recordNoteRead(plan.id, target, 4, NOW);
    recordNoteRead(plan.id, target, 3, NOW);
    const updated = getPlan(plan.id)!;
    const key = coverageKey(target.sourceId, target.path);
    expect(updated.coverage[key]).toEqual({ contentHash: 'h-a.md', passes: 2, questionCount: 7, lastAt: NOW });
    expect(updated.seen[key]).toBe('h-a.md');
  });

  /*
    A cleared bank with plan coverage left behind is a plan that believes it
    has nothing left to read — and an empty bank it cannot refill.
  */
  it('forgets what every plan has read, keeping what each has acknowledged', () => {
    const plan = acceptedPlan();
    recordNoteRead(plan.id, note('a.md'), 4, NOW);
    resetAllPlanCoverage();
    const updated = getPlan(plan.id)!;
    expect(updated.coverage).toEqual({});
    expect(updated.seen[coverageKey('github-repo:1', 'a.md')]).toBe('h-a.md');
  });

  it('counts a failure without spending a pass', () => {
    const plan = acceptedPlan();
    recordNoteFailure(plan.id, note('a.md'), NOW);
    expect(getPlan(plan.id)!.coverage[coverageKey('github-repo:1', 'a.md')]).toMatchObject({ passes: 0, failures: 1 });
  });
});

describe('batches', () => {
  it('numbers batches across the plan', () => {
    const plan = acceptedPlan();
    const first = beginBatch(plan.id, { kind: 'sample', requested: 5, specVersion: 1, notes: [] }, NOW)!;
    const second = beginBatch(plan.id, { kind: 'batch', requested: 10, specVersion: 1, notes: [] }, NOW)!;
    expect([first.number, second.number]).toEqual([1, 2]);
  });

  it('drops drafts the bank or the plan already holds', () => {
    const plan = acceptedPlan();
    addQuestions([question('in-bank')]);
    const first = openBatchWith(plan.id, ['a', 'b']);
    const second = beginBatch(plan.id, { kind: 'batch', requested: 3, specVersion: 1, notes: [] }, NOW)!;
    const added = addDrafts(plan.id, second.id, [question('in-bank'), question('a'), question('c'), question('c')]);
    expect(added.map((draft) => draft.id)).toEqual(['c']);
    expect(getPlan(plan.id)!.batches.find((batch) => batch.id === first.id)!.drafts).toHaveLength(2);
  });

  it('keeps a batch into the bank, tagged with the plan, minus dropped and unfixed drafts', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a', 'b', 'c', 'd']);
    markReview(plan.id, batch.id);
    setDraftReview(plan.id, batch.id, 'b', { verdict: 'drop', tags: [], note: '' });
    setDraftReview(plan.id, batch.id, 'c', { verdict: 'fix', tags: ['too-easy'], note: '' });

    const outcome = acceptBatch(plan.id, batch.id, { now: NOW });
    expect(outcome).toEqual({ kept: 2, added: 2, discarded: 2 });
    expect(questionsForPlan(plan.id).map((entry) => entry.id).sort()).toEqual(['a', 'd']);

    const settled = getPlan(plan.id)!.batches.find((entry) => entry.id === batch.id)!;
    expect(settled).toMatchObject({ status: 'accepted', drafts: [], acceptedIds: ['a', 'd'], discarded: 2 });
  });

  it('creates the plan’s quiz on the first keep, and never resurrects a deleted one', () => {
    const plan = acceptedPlan();
    const first = openBatchWith(plan.id, ['a']);
    markReview(plan.id, first.id);
    acceptBatch(plan.id, first.id, { now: NOW });

    const quizId = getPlan(plan.id)!.quizId!;
    expect(getQuizById(quizId)?.rule.planIds).toEqual([plan.id]);

    quizzesStore.set({ quizzes: [] });
    const second = openBatchWith(plan.id, ['b']);
    markReview(plan.id, second.id);
    acceptBatch(plan.id, second.id, { now: NOW });
    expect(getQuizById(quizId)).toBeUndefined();
  });

  it('refuses to keep a batch twice', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a']);
    markReview(plan.id, batch.id);
    acceptBatch(plan.id, batch.id, { now: NOW });
    expect(acceptBatch(plan.id, batch.id, { now: NOW })).toEqual({ kept: 0, added: 0, discarded: 0 });
  });

  it('auto-keeps a batch still marked generating, for autopilot', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a', 'b']);
    expect(acceptBatch(plan.id, batch.id, { auto: true, now: NOW }).kept).toBe(2);
    expect(getPlan(plan.id)!.batches[0].autoAccepted).toBe(true);
  });

  it('discards a batch without touching the bank', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a', 'b']);
    discardBatch(plan.id, batch.id, NOW);
    expect(getQuestions()).toHaveLength(0);
    expect(getPlan(plan.id)!.batches[0]).toMatchObject({ status: 'discarded', drafts: [], discarded: 2 });
  });

  it('replaces a fixed draft in place and resets its review', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a']);
    setDraftReview(plan.id, batch.id, 'a', { verdict: 'fix', tags: ['unclear'], note: '' });
    replaceDraft(plan.id, batch.id, { ...question('a'), prompt: 'Clearer?' }, { tags: [], note: '', revisedFrom: 'Prompt a?' });
    const updated = getPlan(plan.id)!.batches[0];
    expect(updated.drafts[0].prompt).toBe('Clearer?');
    expect(updated.reviews.a).toEqual({ tags: [], note: '', revisedFrom: 'Prompt a?' });
  });

  /*
    Correcting a flagged draft by hand answers the flag. Left set, keeping the
    batch would discard the very question the reader just fixed.
  */
  it('clears "needs work" when the reader fixes a draft by hand', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a']);
    setDraftReview(plan.id, batch.id, 'a', { verdict: 'fix', tags: ['unclear'], note: 'which study?' });
    updateDraft(plan.id, { ...question('a'), prompt: 'Clearer now?' });
    expect(getPlan(plan.id)!.batches[0].reviews.a).toEqual({ tags: [], note: '', revisedFrom: 'Prompt a?' });

    markReview(plan.id, batch.id);
    expect(acceptBatch(plan.id, batch.id, { now: NOW }).kept).toBe(1);
  });

  it('saves a hand edit to a draft, keeping it tagged with the plan', () => {
    const plan = acceptedPlan();
    openBatchWith(plan.id, ['a']);
    expect(updateDraft(plan.id, { ...question('a'), prompt: 'Edited?' })).toBe(true);
    expect(getPlan(plan.id)!.batches[0].drafts[0]).toMatchObject({ prompt: 'Edited?', planId: plan.id });
    expect(updateDraft(plan.id, question('missing'))).toBe(false);
  });

  it('lists what a note has already been asked, in the bank and in review', () => {
    const plan = acceptedPlan();
    addQuestions([{ ...question('kept'), planId: plan.id }, question('other-plan')]);
    openBatchWith(plan.id, ['draft']);
    expect(askedForNote(getPlan(plan.id)!, 'github-repo:1', 'Books/TFAS 1.md').sort()).toEqual([
      'Prompt draft?',
      'Prompt kept?',
    ]);
  });
});

describe('settings', () => {
  it('clamps what it stores', () => {
    const plan = acceptedPlan();
    updatePlanSettings(plan.id, { batchSize: 10_000, depth: 9, mode: 'autopilot' });
    expect(getPlan(plan.id)!.settings).toMatchObject({ batchSize: 200, depth: 3, mode: 'autopilot' });
  });
});

describe('deletePlan', () => {
  it('takes its questions and quiz with it when asked', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a']);
    markReview(plan.id, batch.id);
    acceptBatch(plan.id, batch.id, { now: NOW });
    const quizId = getPlan(plan.id)!.quizId!;

    deletePlan(plan.id, { withQuestions: true });
    expect(getPlan(plan.id)).toBeUndefined();
    expect(getQuestions()).toHaveLength(0);
    expect(getQuizById(quizId)).toBeUndefined();
  });

  it('can leave its questions in the bank, no longer tagged', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a']);
    markReview(plan.id, batch.id);
    acceptBatch(plan.id, batch.id, { now: NOW });

    deletePlan(plan.id, { withQuestions: false });
    expect(getQuestions()).toHaveLength(1);
    expect(getQuestions()[0].planId).toBeUndefined();
  });
});

describe('normalizePlan', () => {
  /*
    The cold-launch repair. A batch still "generating" after a launch will
    never finish — the app died mid-run — and left alone it would lock the plan
    behind a spinner forever. Drafts saved before the interruption survive.
  */
  it('turns an interrupted batch with drafts into one waiting for review', () => {
    const plan = acceptedPlan();
    const batch = openBatchWith(plan.id, ['a']);
    const stored = getPlan(plan.id)!;
    const interrupted: QuizPlan = {
      ...stored,
      batches: stored.batches.map((entry) =>
        entry.id === batch.id
          ? { ...entry, notes: [{ key: 'k', title: 'TFAS 1', status: 'running', questionCount: 0 }] }
          : entry,
      ),
    };
    const repaired = normalizePlan(JSON.parse(JSON.stringify(interrupted)));
    expect(repaired.batches[0]).toMatchObject({ status: 'review', error: expect.stringMatching(/Interrupted/) });
    expect(repaired.batches[0].notes[0].status).toBe('skipped');
  });

  it('marks an interrupted batch with nothing in it as failed', () => {
    const plan = acceptedPlan();
    beginBatch(plan.id, { kind: 'batch', requested: 5, specVersion: 1, notes: [] }, NOW);
    expect(normalizePlan(getPlan(plan.id)!).batches[0].status).toBe('failed');
  });

  it('drops a malformed draft, never the plan', () => {
    const plan = acceptedPlan();
    openBatchWith(plan.id, ['a', 'b']);
    const stored = JSON.parse(JSON.stringify(getPlan(plan.id)!)) as QuizPlan;
    (stored.batches[0].drafts[1] as unknown as Record<string, unknown>).choices = 'broken';
    expect(isValidPlan(stored)).toBe(true);
    expect(normalizePlan(stored).batches[0].drafts.map((draft) => draft.id)).toEqual(['a']);
  });
});

/** Generation finished: the batch now waits on the reader. */
function markReview(planId: string, batchId: string) {
  plansStore.set({
    plans: plansStore.get().plans.map((plan) =>
      plan.id !== planId
        ? plan
        : { ...plan, batches: plan.batches.map((b) => (b.id === batchId ? { ...b, status: 'review' as const } : b)) },
    ),
  });
}
