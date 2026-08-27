const mockForeground = {
  backgrounded: false,
  waiters: [] as (() => void)[],
  waited: 0,
};

jest.mock('./appState', () => ({
  backgroundClock: {
    elapsed: () => 0,
    isBackgrounded: () => mockForeground.backgrounded,
    enterBackground: () => undefined,
    enterForeground: () => undefined,
    whenForeground: () => {
      mockForeground.waited += 1;
      if (!mockForeground.backgrounded) return Promise.resolve();
      return new Promise<void>((resolve) => mockForeground.waiters.push(resolve));
    },
  },
}));

import { request } from './http';
import { abortError } from './time';

/**
 * The failure this whole mechanism exists for.
 *
 * iOS closes open sockets when it suspends an app, so every request in flight
 * when the user leaves rejects with this — verbatim, including the ExpoModules
 * frame, because on SDK 57 `fetch` is the native URLSession implementation.
 */
function connectionLost(): Error {
  return new Error(
    'fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)',
  );
}

const RESPONSE = { ok: true, status: 200 } as Response;

/** Plays out one outcome per call, repeating the last one forever. */
function fetchSequence(...outcomes: (Response | Error)[]) {
  let calls = 0;
  globalThis.fetch = jest.fn(() => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
  }) as unknown as typeof fetch;
  return () => calls;
}

function releaseForeground(): void {
  mockForeground.backgrounded = false;
  const waiters = [...mockForeground.waiters];
  mockForeground.waiters.length = 0;
  for (const wake of waiters) wake();
}

beforeEach(() => {
  mockForeground.backgrounded = false;
  mockForeground.waiters.length = 0;
  mockForeground.waited = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('retrying a dropped connection', () => {
  it('retries and succeeds, so leaving the app does not fail the note', async () => {
    const calls = fetchSequence(connectionLost(), RESPONSE);
    const promise = request('https://example.com', { timeoutMs: 90_000 });

    await jest.advanceTimersByTimeAsync(2_000);

    await expect(promise).resolves.toBe(RESPONSE);
    expect(calls()).toBe(2);
  });

  it('waits for the app to be awake before spending another request', async () => {
    // Retrying on the frame the app resumes fails a second time on exactly the
    // notes this is here to save: iOS restores the app before the radio.
    mockForeground.backgrounded = true;
    const calls = fetchSequence(connectionLost(), RESPONSE);
    const promise = request('https://example.com', { timeoutMs: 90_000 });

    await jest.advanceTimersByTimeAsync(60_000);
    expect(calls()).toBe(1);
    expect(mockForeground.waited).toBe(1);

    releaseForeground();
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(promise).resolves.toBe(RESPONSE);
    expect(calls()).toBe(2);
  });

  it('gives each attempt its own timeout budget', async () => {
    /*
      A drop that happens late must not leave the retry with seconds to live.
      The attempt that was cut off is not evidence about how long the next one
      will take — carrying the remainder over would time out instantly on
      precisely the long notes that are worth retrying.
    */
    let rejectFirst: (error: Error) => void = () => undefined;
    let calls = 0;

    globalThis.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve, reject) => {
          calls += 1;
          if (calls === 1) rejectFirst = reject;
          else setTimeout(() => resolve(RESPONSE), 80_000);
        }),
    ) as unknown as typeof fetch;

    const promise = request('https://example.com', { timeoutMs: 90_000 });

    await jest.advanceTimersByTimeAsync(85_000);
    rejectFirst(connectionLost());

    // Backoff, then a second attempt that takes another 80s — well past the
    // 90s budget if the two attempts shared one.
    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(81_000);

    await expect(promise).resolves.toBe(RESPONSE);
    expect(calls).toBe(2);
  });

  it('gives up after two retries rather than retrying forever', async () => {
    // Every attempt at an LLM endpoint may be billed, so this is bounded.
    const calls = fetchSequence(connectionLost());
    const promise = request('https://example.com', { timeoutMs: 90_000 });
    const rejects = expect(promise).rejects.toMatchObject({ code: 'connection_lost' });

    await jest.advanceTimersByTimeAsync(30_000);

    await rejects;
    expect(calls()).toBe(3);
  });

  it('does not retry a cancelled run', async () => {
    // Cancelling has to mean cancelled — not three more paid attempts.
    const calls = fetchSequence(abortError());
    const promise = request('https://example.com', { timeoutMs: 90_000 });
    const rejects = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    await jest.advanceTimersByTimeAsync(30_000);

    await rejects;
    expect(calls()).toBe(1);
  });

  it('does not retry its own timeout', async () => {
    /*
      A request that ran out of budget was answered by nobody for minutes.
      Sending it again spends the same money to wait the same minutes, which is
      the opposite of the dropped-socket case where nothing was ever answered.
    */
    globalThis.fetch = jest.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        }),
    ) as unknown as typeof fetch;

    const promise = request('https://example.com', { timeoutMs: 10_000 });
    const rejects = expect(promise).rejects.toMatchObject({ code: 'timeout' });

    await jest.advanceTimersByTimeAsync(60_000);

    await rejects;
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
