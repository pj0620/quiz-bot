const mockSuspendedMs = { value: 0 };

jest.mock('./appState', () => ({
  backgroundClock: {
    elapsed: () => mockSuspendedMs.value,
    isBackgrounded: () => false,
    enterBackground: () => undefined,
    enterForeground: () => undefined,
    whenForeground: () => Promise.resolve(),
  },
}));

import { request } from './http';
import { abortError } from './time';

/**
 * A fetch that never settles on its own, so the timeout is the only thing that
 * can end the request — which is exactly what is under test.
 */
function hangingFetch() {
  let settle: (response: Response) => void = () => undefined;

  globalThis.fetch = jest.fn(
    (_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((resolve, reject) => {
        settle = resolve;
        init?.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
      }),
  ) as unknown as typeof fetch;

  return { settle: (response: Response) => settle(response) };
}

const RESPONSE = { ok: true, status: 200 } as Response;

beforeEach(() => {
  mockSuspendedMs.value = 0;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('request timeouts', () => {
  it('times out once the budget is spent awake', async () => {
    const { settle } = hangingFetch();
    const promise = request('https://example.com', { timeoutMs: 10_000 });
    const rejects = expect(promise).rejects.toMatchObject({ code: 'timeout' });

    await jest.advanceTimersByTimeAsync(10_100);
    await rejects;
    expect(settle).toBeDefined();
  });

  it('does not time out early', async () => {
    const { settle } = hangingFetch();
    const promise = request('https://example.com', { timeoutMs: 90_000 });

    await jest.advanceTimersByTimeAsync(89_000);
    settle(RESPONSE);

    await expect(promise).resolves.toBe(RESPONSE);
  });

  /*
    The behaviour this whole mechanism exists for.

    On iOS the JS thread stops when the app is backgrounded and every overdue
    timer is delivered the instant it resumes. With a plain wall-clock timeout,
    leaving the app for five minutes during a 90-second model request means the
    request — and every other one in flight — is aborted the moment the user
    comes back. That is the "processing fails if you leave the app" report, and
    it is a measurement bug: the app was not waiting during those five minutes.
  */
  it('gives back the time the app spent suspended', async () => {
    const { settle } = hangingFetch();
    const promise = request('https://example.com', { timeoutMs: 90_000 });

    // Five minutes away, with the suspended clock keeping pace with wall-clock
    // exactly as it does on a device.
    for (let step = 0; step < 10; step += 1) {
      mockSuspendedMs.value += 30_000;
      await jest.advanceTimersByTimeAsync(30_000);
    }

    // Still alive: none of that counted against the budget.
    settle(RESPONSE);
    await expect(promise).resolves.toBe(RESPONSE);
  });

  it('still times out on foreground time either side of a suspension', async () => {
    // Being away doesn't buy an unlimited request — only the awake seconds are
    // counted, and they still add up to the budget.
    hangingFetch();
    const promise = request('https://example.com', { timeoutMs: 60_000 });
    const rejects = expect(promise).rejects.toMatchObject({ code: 'timeout' });

    await jest.advanceTimersByTimeAsync(40_000);

    mockSuspendedMs.value += 120_000;
    await jest.advanceTimersByTimeAsync(120_000);

    await jest.advanceTimersByTimeAsync(21_000);
    await rejects;
  });

  it('reports a caller cancellation as an abort, not as a timeout', async () => {
    hangingFetch();
    const controller = new AbortController();
    const promise = request('https://example.com', { signal: controller.signal, timeoutMs: 90_000 });
    const rejects = expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    controller.abort();
    await jest.advanceTimersByTimeAsync(0);
    await rejects;
  });
});
