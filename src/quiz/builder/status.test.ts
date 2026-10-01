import { planStatus } from './status';
import { defaultSettings, emptyScope, emptyUsage, type PlanBatch, type PlanSpec, type QuizPlan } from './types';

function spec(version: number): PlanSpec {
  return {
    version,
    title: 'TFAS',
    summary: '',
    scope: emptyScope(),
    focus: [],
    avoid: [],
    formats: [],
    difficulty: 'mixed',
    questionsPerNote: 4,
    style: '',
    author: 'ai',
    updatedAt: 1,
  };
}

function batch(overrides: Partial<PlanBatch>): PlanBatch {
  return {
    id: 'b1',
    number: 1,
    kind: 'batch',
    status: 'accepted',
    requested: 10,
    specVersion: 1,
    createdAt: 1,
    drafts: [],
    reviews: {},
    acceptedIds: ['q1'],
    discarded: 0,
    notes: [],
    usage: emptyUsage(),
    ...overrides,
  };
}

function plan(overrides: Partial<QuizPlan> = {}): QuizPlan {
  return {
    id: 'p1',
    createdAt: 1,
    updatedAt: 1,
    request: 'TFAS',
    spec: spec(1),
    accepted: spec(1),
    messages: [],
    batches: [batch({})],
    coverage: {},
    seen: {},
    settings: defaultSettings(),
    plannerUsage: emptyUsage(),
    ...overrides,
  };
}

const idle = { job: null, thinking: false, freshCount: 0, questionCount: 12 };

describe('planStatus', () => {
  it('says a plan is writing, and how far along, before anything else', () => {
    const writing = plan({
      batches: [
        batch({ status: 'generating', acceptedIds: [], notes: [
          { key: 'a', title: 'A', status: 'done', questionCount: 4 },
          { key: 'b', title: 'B', status: 'running', questionCount: 0 },
        ] }),
      ],
    });
    const status = planStatus(writing, { ...idle, job: { kind: 'generate', planId: 'p1', batchId: 'b1' } });
    expect(status).toMatchObject({ label: 'Writing', needsYou: false });
    expect(status.detail).toContain('1 of 2 notes read');
  });

  it('flags a batch waiting for review as needing the reader', () => {
    const status = planStatus(plan({ batches: [batch({ status: 'review', acceptedIds: [] })] }), idle);
    expect(status).toMatchObject({ label: 'Review', tone: 'warning', needsYou: true });
  });

  it('describes a plan still being drafted', () => {
    expect(planStatus(plan({ accepted: null, spec: null, batches: [] }), idle).detail).toBe('Waiting for a first plan');
    expect(planStatus(plan({ accepted: null, spec: null, batches: [] }), { ...idle, thinking: true }).detail).toMatch(
      /thinking/,
    );
    expect(planStatus(plan({ accepted: null, batches: [] }), idle)).toMatchObject({ needsYou: true });
  });

  it('asks the reader to accept a proposed change', () => {
    expect(planStatus(plan({ spec: spec(2) }), idle)).toMatchObject({ label: 'Changes', needsYou: true });
  });

  it('points out new notes', () => {
    expect(planStatus(plan(), { ...idle, freshCount: 2 }).detail).toBe('2 new notes to write questions for');
  });

  it('suggests samples for an accepted plan that has kept nothing', () => {
    expect(planStatus(plan({ batches: [] }), idle)).toMatchObject({ label: 'Ready', needsYou: true });
  });

  it('settles on the plan’s mode and its questions once it is in use', () => {
    expect(planStatus(plan(), idle)).toMatchObject({ label: 'Active', detail: '12 questions in your bank' });
    expect(planStatus(plan({ settings: { ...defaultSettings(), mode: 'autopilot' } }), idle).label).toBe('Autopilot');
  });
});
