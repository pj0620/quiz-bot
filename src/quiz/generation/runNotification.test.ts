/*
  Whether the app is in front of the user, and therefore whether a notification
  is worth posting at all.

  The clock is built inside the factory rather than referenced from a `const`
  above it: `import` is hoisted over `const`, so the module under test is loaded
  — and this factory run — before anything declared out here is initialised.
*/
jest.mock('../../lib/appState', () => ({
  backgroundClock: {
    backgrounded: true,
    isBackgrounded() {
      return this.backgrounded;
    },
    elapsed: () => 0,
    enterBackground: () => undefined,
    enterForeground: () => undefined,
  },
}));

const mockScheduled: { content: { title?: string; body?: string } }[] = [];
const mockPermissions = { granted: true, canAskAgain: true };
let mockRequests = 0;

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(async () => ({ ...mockPermissions })),
  requestPermissionsAsync: jest.fn(async () => {
    mockRequests += 1;
    return { granted: mockPermissions.granted };
  }),
  scheduleNotificationAsync: jest.fn(async (request: { content: { title?: string; body?: string } }) => {
    mockScheduled.push(request);
    return 'id';
  }),
}));

import { backgroundClock } from '../../lib/appState';

import { notifyRunFinished } from './runNotification';
import type { RunNote, RunState } from './runStore';

const appState = backgroundClock as unknown as { backgrounded: boolean };

function note(status: RunNote['status'], questionCount = 0): RunNote {
  return { key: `k${Math.random()}`, title: 'A note.md', status, questionCount };
}

function run(overrides: Partial<RunState> = {}): RunState {
  return {
    status: 'finished',
    notes: [note('done', 3), note('done', 2)],
    added: 5,
    usage: { inputTokens: 0, outputTokens: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  mockScheduled.length = 0;
  appState.backgrounded = true;
  mockPermissions.granted = true;
  mockPermissions.canAskAgain = true;
  mockRequests = 0;
});

describe('telling the user a run has finished', () => {
  it('says what the run produced', async () => {
    await notifyRunFinished(run());

    expect(mockScheduled).toHaveLength(1);
    expect(mockScheduled[0].content.title).toBe('Questions ready');
    expect(mockScheduled[0].content.body).toContain('5 questions');
    expect(mockScheduled[0].content.body).toContain('2 notes');
  });

  it('mentions failed notes without leading with them', async () => {
    await notifyRunFinished(run({ notes: [note('done', 5), note('failed')] }));
    expect(mockScheduled[0].content.body).toContain('1 failed');
  });

  it('says a run stopped when it ended on an error', async () => {
    await notifyRunFinished(run({ error: new Error('out of credit') }));
    expect(mockScheduled[0].content.title).toBe('Generation stopped');
  });

  it('stays quiet while the user is looking at the app', async () => {
    // The screen shows the same thing, better. A banner over it is noise.
    appState.backgrounded = false;
    await notifyRunFinished(run());
    expect(mockScheduled).toHaveLength(0);
  });

  it('stays quiet when the user cancelled', async () => {
    // A deliberate act with an immediate on-screen result — reporting it back
    // afterwards tells them nothing they did not just do.
    await notifyRunFinished(run({ status: 'cancelled' }));
    expect(mockScheduled).toHaveLength(0);
  });

  it('posts nothing when permission was refused for good', async () => {
    mockPermissions.granted = false;
    mockPermissions.canAskAgain = false;

    await freshModule(async (module) => {
      await module.notifyRunFinished(run());
    });

    expect(mockScheduled).toHaveLength(0);
    // Already refused, so it does not ask again — that would be harassment.
    expect(mockRequests).toBe(0);
  });

  it('asks for permission once, not once per run', async () => {
    // Requested at the END of the first run rather than at launch: by then the
    // user has started something that takes minutes, which is the only moment
    // being notified is worth anything.
    mockPermissions.granted = false;

    await freshModule(async (module) => {
      await module.notifyRunFinished(run());
      await module.notifyRunFinished(run());
      await module.notifyRunFinished(run());
    });

    expect(mockRequests).toBe(1);
    expect(mockScheduled).toHaveLength(0);
  });
});

/**
 * Loads a fresh copy of the module.
 *
 * The permission answer is memoised for the life of the process, deliberately,
 * so nothing observes a second decision without a new module.
 */
async function freshModule(
  body: (module: typeof import('./runNotification')) => Promise<void>,
): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    await body(require('./runNotification') as typeof import('./runNotification'));
  });
}
