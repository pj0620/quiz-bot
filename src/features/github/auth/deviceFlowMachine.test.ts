import {
  initialState,
  isDeadlinePassed,
  isTerminal,
  nextPollIntervalMs,
  reduce,
  remainingMs,
  type DeviceFlowState,
} from './deviceFlowMachine';
import type { DeviceCodeResponse, DeviceFlowErrorCode, TokenResponse } from '../types';

const T0 = 1_700_000_000_000;

const codeResponse: DeviceCodeResponse = {
  device_code: 'd'.repeat(40),
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

const token: TokenResponse = {
  access_token: 'ghu_test',
  token_type: 'bearer',
  expires_in: 28800,
  refresh_token: 'ghr_test',
  refresh_token_expires_in: 15897600,
};

/** Convenience: drive the machine to the awaiting state. */
function awaiting(now = T0): DeviceFlowState {
  return reduce({ status: 'requesting_code' }, { type: 'CODE_RECEIVED', response: codeResponse }, now);
}

describe('nextPollIntervalMs', () => {
  it('adds 5s on slow_down', () => {
    expect(nextPollIntervalMs(5_000)).toBe(10_000);
    expect(nextPollIntervalMs(10_000)).toBe(15_000);
  });

  it('honours a larger server-supplied interval', () => {
    expect(nextPollIntervalMs(5_000, 30)).toBe(30_000);
  });

  it('ignores a server interval smaller than the bumped value', () => {
    expect(nextPollIntervalMs(20_000, 7)).toBe(25_000);
  });

  it("never drops below GitHub's 5s floor", () => {
    expect(nextPollIntervalMs(0, 1)).toBeGreaterThanOrEqual(5_000);
  });
});

describe('CODE_RECEIVED', () => {
  it('captures the code and sets an absolute deadline', () => {
    const state = awaiting();
    expect(state.status).toBe('awaiting_authorization');
    if (state.status !== 'awaiting_authorization') throw new Error('unreachable');

    expect(state.userCode).toBe('WDJB-MJHT');
    expect(state.deviceCode).toBe(codeResponse.device_code);
    expect(state.expiresAt).toBe(T0 + 900_000);
    expect(state.nextPollAt).toBe(T0 + 5_000);
    expect(state.intervalMs).toBe(5_000);
  });

  it('clamps a server interval below the floor', () => {
    const state = reduce(
      { status: 'requesting_code' },
      { type: 'CODE_RECEIVED', response: { ...codeResponse, interval: 1 } },
      T0,
    );
    if (state.status !== 'awaiting_authorization') throw new Error('unreachable');
    expect(state.intervalMs).toBe(5_000);
  });
});

describe('polling transitions', () => {
  it('stays pending and schedules the next poll', () => {
    const next = reduce(awaiting(), { type: 'POLL_ERROR', code: 'authorization_pending', message: '' }, T0 + 5_000);
    expect(next.status).toBe('awaiting_authorization');
    if (next.status !== 'awaiting_authorization') throw new Error('unreachable');
    expect(next.nextPollAt).toBe(T0 + 10_000);
    expect(next.attempts).toBe(1);
  });

  it('backs off on slow_down', () => {
    const next = reduce(awaiting(), { type: 'POLL_ERROR', code: 'slow_down', message: '' }, T0 + 5_000);
    if (next.status !== 'awaiting_authorization') throw new Error('unreachable');
    expect(next.intervalMs).toBe(10_000);
    expect(next.nextPollAt).toBe(T0 + 15_000);
  });

  it('succeeds on a token', () => {
    const next = reduce(awaiting(), { type: 'POLL_SUCCESS', token }, T0 + 5_000);
    expect(next.status).toBe('success');
    if (next.status !== 'success') throw new Error('unreachable');
    expect(next.token.access_token).toBe('ghu_test');
  });

  const terminalCases: [DeviceFlowErrorCode, string][] = [
    ['expired_token', 'expired'],
    ['access_denied', 'denied'],
    ['device_flow_disabled', 'fatal'],
    ['incorrect_client_credentials', 'fatal'],
    ['unsupported_grant_type', 'fatal'],
    ['incorrect_device_code', 'fatal'],
  ];

  it.each(terminalCases)('maps %s to %s', (code, expected) => {
    const next = reduce(awaiting(), { type: 'POLL_ERROR', code, message: 'msg' }, T0 + 5_000);
    expect(next.status).toBe(expected);
  });

  it('names the fix for device_flow_disabled', () => {
    const next = reduce(
      awaiting(),
      { type: 'POLL_ERROR', code: 'device_flow_disabled', message: 'Enable Device Flow' },
      T0 + 5_000,
    );
    if (next.status !== 'fatal') throw new Error('unreachable');
    expect(next.code).toBe('device_flow_disabled');
    expect(next.message).toContain('Enable Device Flow');
  });
});

describe('network failures', () => {
  it('does not kill the flow', () => {
    const next = reduce(awaiting(), { type: 'REQUEST_FAILED', message: 'offline' }, T0 + 5_000);
    expect(next.status).toBe('awaiting_authorization');
    if (next.status !== 'awaiting_authorization') throw new Error('unreachable');
    expect(next.networkFailures).toBe(1);
  });

  it('accumulates consecutive failures and resets on a good poll', () => {
    let state = awaiting();
    for (let i = 0; i < 3; i += 1) {
      state = reduce(state, { type: 'REQUEST_FAILED', message: 'offline' }, T0 + 5_000);
    }
    if (state.status !== 'awaiting_authorization') throw new Error('unreachable');
    expect(state.networkFailures).toBe(3);

    const recovered = reduce(state, { type: 'POLL_ERROR', code: 'authorization_pending', message: '' }, T0 + 6_000);
    if (recovered.status !== 'awaiting_authorization') throw new Error('unreachable');
    expect(recovered.networkFailures).toBe(0);
  });

  it('goes fatal when explicitly flagged', () => {
    const next = reduce(
      awaiting(),
      { type: 'REQUEST_FAILED', message: 'no config', fatal: true, fatalCode: 'config_missing' },
      T0,
    );
    expect(next.status).toBe('fatal');
  });
});

describe('deadline', () => {
  it('stays alive one ms before expiry', () => {
    const state = awaiting();
    const next = reduce(state, { type: 'POLL_ERROR', code: 'authorization_pending', message: '' }, T0 + 900_000 - 1);
    expect(next.status).toBe('awaiting_authorization');
  });

  it('expires exactly at the deadline', () => {
    const state = awaiting();
    const next = reduce(state, { type: 'POLL_ERROR', code: 'authorization_pending', message: '' }, T0 + 900_000);
    expect(next.status).toBe('expired');
  });

  it('expires a late-arriving success too', () => {
    const next = reduce(awaiting(), { type: 'POLL_SUCCESS', token }, T0 + 900_001);
    expect(next.status).toBe('expired');
  });

  it('computes remaining time', () => {
    expect(remainingMs(awaiting(), T0 + 60_000)).toBe(840_000);
    expect(remainingMs(awaiting(), T0 + 10_000_000)).toBe(0);
    expect(remainingMs(initialState, T0)).toBe(0);
  });

  it('detects a passed deadline', () => {
    expect(isDeadlinePassed(awaiting(), T0)).toBe(false);
    expect(isDeadlinePassed(awaiting(), T0 + 900_000)).toBe(true);
  });
});

describe('cancellation', () => {
  const states: DeviceFlowState[] = [
    { status: 'idle' },
    { status: 'requesting_code' },
    awaiting(),
    { status: 'expired' },
    { status: 'denied' },
  ];

  it.each(states.map((s) => [s.status, s] as const))('cancels from %s', (_label, state) => {
    expect(reduce(state, { type: 'CANCEL' }, T0).status).toBe('cancelled');
  });

  it('cancels even after the deadline has passed', () => {
    expect(reduce(awaiting(), { type: 'CANCEL' }, T0 + 900_001).status).toBe('cancelled');
  });
});

describe('retry', () => {
  it('restarts from an expired state to request a fresh code', () => {
    expect(reduce({ status: 'expired' }, { type: 'RETRY' }, T0).status).toBe('requesting_code');
  });

  it('restarts even when the previous deadline has passed', () => {
    expect(reduce(awaiting(), { type: 'RETRY' }, T0 + 900_001).status).toBe('requesting_code');
  });
});

describe('isTerminal', () => {
  it('classifies states', () => {
    expect(isTerminal({ status: 'idle' })).toBe(false);
    expect(isTerminal(awaiting())).toBe(false);
    expect(isTerminal({ status: 'success', token })).toBe(true);
    expect(isTerminal({ status: 'cancelled' })).toBe(true);
    expect(isTerminal({ status: 'fatal', code: 'unknown', message: '' })).toBe(true);
  });
});
