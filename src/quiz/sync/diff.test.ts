import type { MultipleChoiceQuestion, ReviewState } from '../types';
import { recordReview } from '../srs/schedule';
import { applySyncResult, describeSync, emptyLedger, planSync, type SyncLedger } from './diff';

// Local-time fixtures; filenames are derived from them so the suite passes in
// any timezone (an EAS worker runs in UTC).
const NOW = new Date(2026, 9, 23, 21, 30, 0).getTime();
const LATER = NOW + 3_600_000;

function utcStamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19).replace(/:/g, '-')}Z`;
}

function question(id: string, addedAt = NOW): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: ['history'],
    difficulty: 'core',
    sourceId: 'github-repo:1',
    provenance: { sourceId: 'github-repo:1', path: 'History/Note.md' },
    addedAt,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'A' },
      { id: 'c1', text: 'B' },
    ],
    correctChoiceId: 'c0',
  };
}

const FOLDER = 'notes/quizzes';
const FIRST_FILE = `${FOLDER}/quiz-questions-${utcStamp(NOW)}.md`;

/** Runs a plan and pretends the repo accepted it, returning the new ledger and tree. */
function commit(ledger: SyncLedger, plan: ReturnType<typeof planSync>, tree: Record<string, string>, now: number) {
  const blobShas: Record<string, string> = {};
  const nextTree = { ...tree };
  for (const write of plan.writes) {
    blobShas[write.path] = `sha-${write.renderedHash}`;
    nextTree[write.path] = blobShas[write.path];
  }
  for (const path of plan.deletes) delete nextTree[path];
  return { ledger: applySyncResult(ledger, plan, blobShas, now), tree: nextTree };
}

describe('planSync', () => {
  it('writes a first batch file and the README, and owns the ids', () => {
    const plan = planSync({
      questions: [question('q1'), question('q2')],
      reviewStates: {},
      ledger: emptyLedger('github-repo:1', FOLDER),
      tree: { 'History/Note.md': 'abc' },
      now: NOW,
    });
    expect(plan.writes.map((write) => [write.path, write.kind])).toEqual([
      [FIRST_FILE, 'new'],
      [`${FOLDER}/README.md`, 'readme'],
    ]);
    expect(plan.writes[0].questionIds).toEqual(['q1', 'q2']);
    expect(plan.counts).toEqual({ added: 2, updatedFiles: 0, removed: 0 });
    expect(describeSync(plan.counts)).toBe('QuizBot sync: 2 new questions');

    const { ledger } = commit(emptyLedger('github-repo:1', FOLDER), plan, {}, NOW);
    expect(ledger.owner).toEqual({ q1: FIRST_FILE, q2: FIRST_FILE });
    expect(ledger.files[FIRST_FILE].questionIds).toEqual(['q1', 'q2']);
    expect(ledger.files[`${FOLDER}/README.md`]).toBeUndefined();
    expect(ledger.lastSyncAt).toBe(NOW);
  });

  it('does nothing when nothing changed', () => {
    const questions = [question('q1')];
    const first = planSync({ questions, reviewStates: {}, ledger: emptyLedger('s', FOLDER), tree: {}, now: NOW });
    const { ledger, tree } = commit(emptyLedger('s', FOLDER), first, {}, NOW);
    const second = planSync({ questions, reviewStates: {}, ledger, tree, now: LATER });
    expect(second.writes).toEqual([]);
    expect(second.deletes).toEqual([]);
    expect(describeSync(second.counts)).toBe('QuizBot sync: no changes');
  });

  it('rewrites a file in place when a review changes, keeping its title date', () => {
    const questions = [question('q1')];
    const first = planSync({ questions, reviewStates: {}, ledger: emptyLedger('s', FOLDER), tree: {}, now: NOW });
    const { ledger, tree } = commit(emptyLedger('s', FOLDER), first, {}, NOW);

    const reviewStates: Record<string, ReviewState> = { q1: recordReview(undefined, 'q1', 'correct', LATER) };
    const second = planSync({ questions, reviewStates, ledger, tree, now: LATER });
    expect(second.writes.map((write) => [write.path, write.kind])).toEqual([[FIRST_FILE, 'update']]);
    expect(second.writes[0].createdAt).toBe(NOW);
    expect(second.writes[0].content).toContain('- Progress: answered 1');
    expect(second.counts.updatedFiles).toBe(1);
  });

  it('adds new questions to a new file and leaves the old one alone', () => {
    const first = planSync({ questions: [question('q1')], reviewStates: {}, ledger: emptyLedger('s', FOLDER), tree: {}, now: NOW });
    const { ledger, tree } = commit(emptyLedger('s', FOLDER), first, {}, NOW);
    const second = planSync({ questions: [question('q1'), question('q2', LATER)], reviewStates: {}, ledger, tree, now: LATER });
    expect(second.writes.map((write) => write.kind)).toEqual(['new']);
    expect(second.writes[0].path).not.toBe(FIRST_FILE);
    expect(second.writes[0].questionIds).toEqual(['q2']);
  });

  it('drops a deleted question from its file and deletes a file left empty', () => {
    const first = planSync({
      questions: [question('q1'), question('q2')],
      reviewStates: {},
      ledger: emptyLedger('s', FOLDER),
      tree: {},
      now: NOW,
    });
    const state = commit(emptyLedger('s', FOLDER), first, {}, NOW);

    const second = planSync({ questions: [question('q2')], reviewStates: {}, ...state, now: LATER });
    expect(second.writes[0].questionIds).toEqual(['q2']);
    expect(second.counts.removed).toBe(1);
    const next = commit(state.ledger, second, state.tree, LATER);
    expect(next.ledger.owner).toEqual({ q2: FIRST_FILE });

    const third = planSync({ questions: [], reviewStates: {}, ...next, now: LATER + 1 });
    expect(third.writes).toEqual([]);
    expect(third.deletes).toEqual([FIRST_FILE]);
    const last = commit(next.ledger, third, next.tree, LATER + 1);
    expect(last.ledger.files).toEqual({});
    expect(last.ledger.owner).toEqual({});
  });

  it('skips a file edited outside the app and keeps its ownership frozen', () => {
    const first = planSync({
      questions: [question('q1'), question('q2')],
      reviewStates: {},
      ledger: emptyLedger('s', FOLDER),
      tree: {},
      now: NOW,
    });
    const state = commit(emptyLedger('s', FOLDER), first, {}, NOW);
    const tree = { ...state.tree, [FIRST_FILE]: 'edited-by-hand' };

    // q1 deleted in the app, q3 added: the edit must not be overwritten, q1 must
    // stay owned (so it is not re-added later), and q3 goes to a new file.
    const plan = planSync({ questions: [question('q2'), question('q3', LATER)], reviewStates: {}, ledger: state.ledger, tree, now: LATER });
    expect(plan.skipped).toEqual([{ path: FIRST_FILE, questionIds: ['q1', 'q2'], reason: 'edited-outside' }]);
    expect(plan.writes.map((write) => write.kind)).toEqual(['new']);
    expect(plan.writes[0].questionIds).toEqual(['q3']);

    const next = commit(state.ledger, plan, tree, LATER);
    expect(next.ledger.owner.q1).toBe(FIRST_FILE);
    expect(next.ledger.files[FIRST_FILE].blobSha).not.toBe('edited-by-hand');
  });

  it('recreates a file that disappeared from the repo', () => {
    const first = planSync({ questions: [question('q1')], reviewStates: {}, ledger: emptyLedger('s', FOLDER), tree: {}, now: NOW });
    const { ledger } = commit(emptyLedger('s', FOLDER), first, {}, NOW);
    const plan = planSync({ questions: [question('q1')], reviewStates: {}, ledger, tree: {}, now: LATER });
    expect(plan.writes.map((write) => [write.path, write.kind])).toEqual([[FIRST_FILE, 'recreate']]);
    expect(plan.deletes).toEqual([]);
  });

  it('forgets an empty ledger entry whose file is already gone', () => {
    const first = planSync({ questions: [question('q1')], reviewStates: {}, ledger: emptyLedger('s', FOLDER), tree: {}, now: NOW });
    const { ledger } = commit(emptyLedger('s', FOLDER), first, {}, NOW);
    const plan = planSync({ questions: [], reviewStates: {}, ledger, tree: {}, now: LATER });
    expect(plan.forget).toEqual([FIRST_FILE]);
    expect(applySyncResult(ledger, plan, {}, LATER).files).toEqual({});
  });

  it('bumps the filename when the stamp is taken', () => {
    const plan = planSync({
      questions: [question('q1')],
      reviewStates: {},
      ledger: emptyLedger('s', FOLDER),
      tree: { [FIRST_FILE]: 'someone-else' },
      now: NOW,
    });
    expect(plan.writes[0].path).toBe(`${FOLDER}/quiz-questions-${utcStamp(NOW + 1000)}.md`);
  });

  it('writes no file for questions the format cannot hold', () => {
    const plan = planSync({
      questions: [{ ...question('q1'), sourceId: 'mismatch' }],
      reviewStates: {},
      ledger: emptyLedger('s', FOLDER),
      tree: {},
      now: NOW,
    });
    expect(plan.writes).toEqual([]);
    expect(plan.unwritable).toEqual([{ id: 'q1', reason: 'not writable as a note' }]);
  });

  it('does not write the README again once the folder has files', () => {
    const first = planSync({ questions: [question('q1')], reviewStates: {}, ledger: emptyLedger('s', FOLDER), tree: {}, now: NOW });
    const state = commit(emptyLedger('s', FOLDER), first, {}, NOW);
    delete state.tree[`${FOLDER}/README.md`];
    const second = planSync({ questions: [question('q1'), question('q2', LATER)], reviewStates: {}, ...state, now: LATER });
    expect(second.writes.map((write) => write.kind)).toEqual(['new']);
  });
});
