import { AppState, type AppStateStatus } from 'react-native';

import { abortError } from './time';

/**
 * How long the app has spent out of the foreground, and when it is back.
 *
 * This exists because of one specific, badly-behaved interaction: every request
 * in the app is bounded by `setTimeout`, and JavaScript timers do not run while
 * an app is suspended. iOS stops the JS thread within seconds of the app being
 * backgrounded, then delivers every overdue timer the instant it comes back.
 *
 * So leaving the app during a model request and returning two minutes later
 * does not resume that request — it instantly times out, along with every other
 * request in flight. That is one half of the "processing fails if you leave the
 * app" behaviour, and it is a measurement bug rather than a network one:
 * wall-clock time was never the thing the timeout meant to bound. Subtracting
 * the suspended time makes a timeout mean what it says — how long the app has
 * actually been waiting, with its thread running.
 *
 * The other half is that iOS tears down open sockets when it suspends an app,
 * so the request is genuinely dead however patient the timeout is. Recovering
 * from that means retrying, and retrying is only worth attempting once the app
 * is awake again — which is what `whenForeground` is for. See `lib/http.ts`.
 */

export type BackgroundClock = {
  enterBackground(): void;
  enterForeground(): void;
  /** Cumulative ms the JS thread was asleep, including a spell still in progress. */
  elapsed(): number;
  isBackgrounded(): boolean;
  /**
   * Resolves once the app's JS is running — in the foreground, or inside a
   * held background window — immediately if it already is. Rejects with an
   * `AbortError` if `signal` fires while waiting, so a cancelled run doesn't
   * leave work parked until the user happens to return.
   */
  whenForeground(signal?: AbortSignal): Promise<void>;
  /**
   * Declares that the JS thread is executing even though the app is
   * backgrounded — an OS background-task window (see generation/backgroundResume).
   *
   * While at least one hold is open, requests behave as if the app were awake:
   * timeouts tick, retries proceed. `isBackgrounded()` deliberately still says
   * backgrounded, because it answers a different question — "is this in front
   * of the user" — and the completion notification keys off that.
   *
   * Returns a release function. Releasing twice is a no-op.
   */
  holdAwake(): () => void;
};

/** Pure, so the accounting can be tested without an app or an OS. */
export function createBackgroundClock(now: () => number = Date.now): BackgroundClock {
  let total = 0;
  /** When the app left the foreground; null while foregrounded. */
  let leftAt: number | null = null;
  /** When the JS thread stopped being counted as awake; null while awake. */
  let asleepAt: number | null = null;
  let holds = 0;
  const waiting = new Set<() => void>();

  const isAwake = () => leftAt === null || holds > 0;

  /** Reconciles the asleep accounting after any state change. */
  const settle = () => {
    if (isAwake()) {
      if (asleepAt !== null) {
        total += now() - asleepAt;
        asleepAt = null;
      }
      // Snapshotted before waking anyone: a waiter that resumes synchronously
      // may well start another request and register a fresh waiter, and
      // iterating the live set would try to wake that one too.
      const waiters = [...waiting];
      waiting.clear();
      for (const wake of waiters) wake();
    } else if (asleepAt === null) {
      asleepAt = now();
    }
  };

  return {
    enterBackground() {
      // Guarded: iOS emits 'inactive' then 'background' for one departure, and
      // counting the gap twice would over-credit every request.
      if (leftAt === null) {
        leftAt = now();
        settle();
      }
    },
    enterForeground() {
      if (leftAt === null) return;
      leftAt = null;
      settle();
    },
    elapsed() {
      return asleepAt === null ? total : total + (now() - asleepAt);
    },
    isBackgrounded() {
      return leftAt !== null;
    },
    whenForeground(signal) {
      if (isAwake()) return Promise.resolve();
      if (signal?.aborted) return Promise.reject(abortError());

      return new Promise<void>((resolve, reject) => {
        const wake = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          waiting.delete(wake);
          reject(abortError());
        };
        waiting.add(wake);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    holdAwake() {
      holds += 1;
      settle();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        settle();
      };
    },
  };
}

export const backgroundClock = createBackgroundClock();

/**
 * Starts feeding the clock from the OS. Called once from the root layout.
 *
 * 'inactive' counts as backgrounded on purpose. It covers the app switcher, a
 * system alert and an incoming call — during all of which the JS thread may
 * already be starved, and none of which the user thinks of as "using the app".
 */
export function startAppStateTracking(): () => void {
  const apply = (status: AppStateStatus) => {
    if (status === 'active') backgroundClock.enterForeground();
    else backgroundClock.enterBackground();
  };

  apply(AppState.currentState);
  const subscription = AppState.addEventListener('change', apply);
  return () => subscription.remove();
}
