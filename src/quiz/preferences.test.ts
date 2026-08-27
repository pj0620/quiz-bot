jest.mock('../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { writeJson } from '../lib/kv';
import { getSelectionMode, preferencesStore, setSelectionMode } from './preferences';

const mockedWriteJson = writeJson as jest.MockedFunction<typeof writeJson>;

beforeEach(() => {
  setSelectionMode('spaced');
  jest.clearAllMocks();
});

describe('how questions are picked', () => {
  it('defaults to spaced, which is what every existing install already does', () => {
    /*
      A version bump must not silently change how someone's quizzes behave. The
      review states in the bank were all built up under spaced scheduling, and
      switching is a deliberate act.
    */
    expect(getSelectionMode()).toBe('spaced');
  });

  it('stores and persists the choice', () => {
    setSelectionMode('even');
    expect(getSelectionMode()).toBe('even');
    expect(mockedWriteJson).toHaveBeenCalledWith('quizbot.quiz.preferences.v1', {
      selectionMode: 'even',
    });
  });

  it('notifies subscribers, so the quiz screen updates without a reload', () => {
    let notified = 0;
    const unsubscribe = preferencesStore.subscribe(() => {
      notified += 1;
    });

    setSelectionMode('even');
    expect(notified).toBe(1);
    unsubscribe();
  });

  it('survives a failed write rather than taking the screen down with it', async () => {
    // A preference is not worth an error banner; the in-memory value is what
    // the app reads, and the write is a courtesy.
    mockedWriteJson.mockRejectedValueOnce(new Error('disk full'));
    expect(() => setSelectionMode('even')).not.toThrow();
    expect(getSelectionMode()).toBe('even');
    await Promise.resolve();
  });
});
