import { createBackgroundClock } from './appState';

describe('background clock', () => {
  let now = 0;
  const clock = () => createBackgroundClock(() => now);

  beforeEach(() => {
    now = 1_000;
  });

  it('counts nothing while the app stays in the foreground', () => {
    const background = clock();
    now += 5_000;
    expect(background.elapsed()).toBe(0);
    expect(background.isBackgrounded()).toBe(false);
  });

  it('counts a completed spell away', () => {
    const background = clock();
    background.enterBackground();
    now += 30_000;
    background.enterForeground();
    now += 5_000;

    expect(background.elapsed()).toBe(30_000);
    expect(background.isBackgrounded()).toBe(false);
  });

  it('counts a spell that is still in progress', () => {
    // A request checking its deadline while the app is away needs the in-flight
    // stretch too, or it decides it has timed out mid-suspension.
    const background = clock();
    background.enterBackground();
    now += 12_000;

    expect(background.elapsed()).toBe(12_000);
    expect(background.isBackgrounded()).toBe(true);
  });

  it('adds up several spells', () => {
    const background = clock();
    background.enterBackground();
    now += 10_000;
    background.enterForeground();
    now += 1_000;
    background.enterBackground();
    now += 4_000;
    background.enterForeground();

    expect(background.elapsed()).toBe(14_000);
  });

  it('does not double-count iOS emitting inactive then background', () => {
    /*
      One departure produces two events on iOS. Restarting the clock on the
      second would drop the gap between them; counting both would credit a
      request with time it never spent away.
    */
    const background = clock();
    background.enterBackground();
    now += 2_000;
    background.enterBackground();
    now += 8_000;
    background.enterForeground();

    expect(background.elapsed()).toBe(10_000);
  });

  it('ignores a foreground event when it was never backgrounded', () => {
    const background = clock();
    background.enterForeground();
    now += 5_000;
    background.enterForeground();

    expect(background.elapsed()).toBe(0);
  });
});

describe('waiting for the foreground', () => {
  let now = 0;
  const clock = () => createBackgroundClock(() => now);

  beforeEach(() => {
    now = 1_000;
  });

  it('resolves immediately when the app is already in front of the user', async () => {
    await expect(clock().whenForeground()).resolves.toBeUndefined();
  });

  it('resolves when the app comes back', async () => {
    const background = clock();
    background.enterBackground();

    let resumed = false;
    const waiting = background.whenForeground().then(() => {
      resumed = true;
    });

    // Nothing may run yet: a retry sent while the app is suspended is a wasted
    // request, and on iOS it is one that cannot even reach the network.
    await Promise.resolve();
    expect(resumed).toBe(false);

    background.enterForeground();
    await waiting;
    expect(resumed).toBe(true);
  });

  it('wakes every waiter, since a run has several requests in flight', async () => {
    const background = clock();
    background.enterBackground();

    const waiting = Promise.all([background.whenForeground(), background.whenForeground()]);
    background.enterForeground();

    await expect(waiting).resolves.toEqual([undefined, undefined]);
  });

  it('does not re-wake a waiter registered after the app came back', async () => {
    // A woken request usually starts another one immediately. Waking the new
    // waiter off the same event would let it retry against a stale answer.
    const background = clock();
    background.enterBackground();

    let second: Promise<void> | null = null;
    const first = background.whenForeground().then(() => {
      background.enterBackground();
      second = background.whenForeground();
    });

    background.enterForeground();
    await first;

    let resumed = false;
    void (second as unknown as Promise<void>).then(() => {
      resumed = true;
    });
    await Promise.resolve();
    expect(resumed).toBe(false);

    background.enterForeground();
    await second;
  });

  it('rejects when the run is cancelled while away', async () => {
    // Otherwise a cancelled run leaves retries parked until the user happens to
    // open the app again, and the run never actually settles.
    const background = clock();
    background.enterBackground();
    const controller = new AbortController();

    const waiting = background.whenForeground(controller.signal);
    controller.abort();

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects straight away when cancelled before it was called', async () => {
    const background = clock();
    background.enterBackground();
    const controller = new AbortController();
    controller.abort();

    await expect(background.whenForeground(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('holding the clock awake for a background task window', () => {
  let now = 0;
  const clock = () => createBackgroundClock(() => now);

  beforeEach(() => {
    now = 1_000;
  });

  it('lets waiters proceed while backgrounded, since the JS thread IS running', async () => {
    const background = clock();
    background.enterBackground();
    const release = background.holdAwake();

    // Both a waiter parked before the hold and one arriving during it.
    await expect(background.whenForeground()).resolves.toBeUndefined();
    release();
  });

  it('wakes a waiter that was parked before the hold began', async () => {
    const background = clock();
    background.enterBackground();

    let resumed = false;
    const waiting = background.whenForeground().then(() => {
      resumed = true;
    });

    const release = background.holdAwake();
    await waiting;
    expect(resumed).toBe(true);
    release();
  });

  it('stops crediting suspended time during the hold, so timeouts tick again', () => {
    /*
      A request made inside the background window must still be bounded: the
      thread is running and the network is reachable, so a hung request there
      is a real hang, not a suspension.
    */
    const background = clock();
    background.enterBackground();
    now += 10_000; // genuinely suspended

    const release = background.holdAwake();
    now += 60_000; // working inside the task window
    expect(background.elapsed()).toBe(10_000);

    release();
    now += 5_000; // suspended again after the window closes
    expect(background.elapsed()).toBe(15_000);
  });

  it('still reports backgrounded, so the completion notification posts', () => {
    // isBackgrounded answers "is this in front of the user", which a background
    // task window is not — the whole point of the notification is that moment.
    const background = clock();
    background.enterBackground();
    const release = background.holdAwake();

    expect(background.isBackgrounded()).toBe(true);
    release();
  });

  it('stays awake until every hold is released, and releasing twice is a no-op', () => {
    const background = clock();
    background.enterBackground();

    const first = background.holdAwake();
    const second = background.holdAwake();

    first();
    first(); // must not decrement past its own hold
    now += 7_000;
    expect(background.elapsed()).toBe(0); // second hold still open

    second();
    now += 3_000;
    expect(background.elapsed()).toBe(3_000);
  });

  it('hands over cleanly when the app is foregrounded mid-hold', () => {
    const background = clock();
    background.enterBackground();
    const release = background.holdAwake();

    background.enterForeground();
    release();
    now += 4_000;

    // Foregrounded and unheld: awake, so nothing accumulates.
    expect(background.elapsed()).toBe(0);
    expect(background.isBackgrounded()).toBe(false);
  });
});
