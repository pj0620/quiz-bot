/**
 * Run an async job over a list, N at a time.
 *
 * Written as a shared cursor rather than as fixed-size batches, because batching
 * is only as fast as the slowest item in each batch — and note generation is
 * exactly the workload where one item takes six times as long as its neighbours
 * (a long note is split into several model requests). A lane that finishes early
 * should pick up the next note immediately, not wait for the batch.
 */

export type PoolOptions = {
  /**
   * Checked before each item is claimed. Returning true stops the pool taking
   * on any more work; whatever is already in flight is still awaited.
   *
   * This is how cancellation stays honest: a run that has been paid for is
   * allowed to finish and report, rather than being dropped mid-request.
   */
  stop?: () => boolean;
};

/**
 * Resolves once every item has been processed, the pool was stopped, or a
 * worker threw.
 *
 * A thrown worker stops the pool and re-throws AFTER the in-flight lanes settle.
 * Rejecting immediately would leave requests running against a caller that has
 * already moved on — and for this app that means unbilled work continuing to
 * arrive with nowhere to record it.
 */
export async function forEachInPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  options: PoolOptions = {},
): Promise<void> {
  // Never zero, whatever arrives: a stored setting could be 0, negative or NaN,
  // and zero lanes would silently do nothing at all.
  const lanes = Math.max(1, Math.min(Math.floor(concurrency) || 1, items.length));

  let cursor = 0;
  let stopped = false;
  let firstError: unknown = null;

  const shouldStop = () => stopped || options.stop?.() === true;

  async function lane(): Promise<void> {
    while (!shouldStop()) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;

      try {
        await worker(items[index], index);
      } catch (error) {
        // First one wins: it is the one that actually stopped the run, and the
        // others are usually the same failure arriving on the other lanes.
        if (firstError === null) firstError = error;
        stopped = true;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: lanes }, () => lane()));

  if (firstError !== null) throw firstError;
}
