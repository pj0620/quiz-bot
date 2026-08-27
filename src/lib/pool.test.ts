import { forEachInPool } from './pool';

/** Resolves after `ms` of fake time, so ordering can be asserted exactly. */
function after(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('forEachInPool', () => {
  it('processes every item exactly once', async () => {
    const seen: number[] = [];
    await forEachInPool([1, 2, 3, 4, 5], 2, async (item) => {
      seen.push(item);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never runs more than `concurrency` at once', async () => {
    let live = 0;
    let peak = 0;

    await forEachInPool(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await after(1);
      live -= 1;
    });

    expect(peak).toBe(3);
  });

  it('gives the next item to whichever lane is free, not to a fixed batch', async () => {
    /*
      The reason this isn't `Promise.all` over chunks. Item 0 is slow; with
      batching, lane 2 would idle until it finished. Here lane 2 should get
      through everything else in the meantime.
    */
    const order: number[] = [];
    const durations = [50, 1, 1, 1, 1];

    await forEachInPool([0, 1, 2, 3, 4], 2, async (item) => {
      await after(durations[item]);
      order.push(item);
    });

    expect(order).toEqual([1, 2, 3, 4, 0]);
  });

  it('runs sequentially at a concurrency of one', async () => {
    let live = 0;
    let peak = 0;
    await forEachInPool([1, 2, 3], 1, async () => {
      live += 1;
      peak = Math.max(peak, live);
      await after(1);
      live -= 1;
    });
    expect(peak).toBe(1);
  });

  it('treats a nonsensical concurrency as one rather than as none', async () => {
    // A stored setting could be anything; zero lanes would silently do nothing.
    for (const lanes of [0, -3, Number.NaN]) {
      const seen: number[] = [];
      await forEachInPool([1, 2], lanes, async (item) => {
        seen.push(item);
      });
      expect(seen).toHaveLength(2);
    }
  });

  it('does nothing with an empty list', async () => {
    const worker = jest.fn();
    await forEachInPool([], 4, worker);
    expect(worker).not.toHaveBeenCalled();
  });

  it('stops claiming new work once `stop` turns true', async () => {
    let done = 0;
    let cancelled = false;

    await forEachInPool(Array.from({ length: 20 }, (_, i) => i), 2, async () => {
      done += 1;
      if (done === 4) cancelled = true;
      await after(1);
    }, { stop: () => cancelled });

    // The two lanes in flight when it flipped are allowed to finish; nothing
    // beyond them is started.
    expect(done).toBeLessThanOrEqual(6);
    expect(done).toBeGreaterThanOrEqual(4);
  });

  it('claims nothing at all when `stop` is already true', async () => {
    const worker = jest.fn();
    await forEachInPool([1, 2, 3], 2, worker, { stop: () => true });
    expect(worker).not.toHaveBeenCalled();
  });

  describe('a worker that throws', () => {
    it('re-throws the first error', async () => {
      await expect(
        forEachInPool([1, 2, 3], 2, async (item) => {
          if (item === 1) throw new Error('boom');
          await after(1);
        }),
      ).rejects.toThrow('boom');
    });

    it('stops the pool rather than working through the rest of the list', async () => {
      const seen: number[] = [];
      await expect(
        forEachInPool(Array.from({ length: 20 }, (_, i) => i), 2, async (item) => {
          seen.push(item);
          await after(1);
          if (item === 0) throw new Error('fatal');
        }),
      ).rejects.toThrow('fatal');

      expect(seen.length).toBeLessThan(20);
    });

    it('waits for in-flight lanes before rejecting', async () => {
      /*
        The important one. Rejecting while a request is still running would
        leave it arriving at a caller that has already given up — and in this
        app that request has been paid for.
      */
      let finished = false;

      await expect(
        forEachInPool([0, 1], 2, async (item) => {
          if (item === 0) throw new Error('fatal');
          await after(20);
          finished = true;
        }),
      ).rejects.toThrow('fatal');

      expect(finished).toBe(true);
    });
  });
});
