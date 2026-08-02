import { GITHUB } from '../config';
import type { DeviceCodeResponse, DeviceFlowErrorCode, TokenResponse } from '../types';

/**
 * Pure state machine for the device flow. No timers, no I/O, no React — so the
 * polling/backoff/deadline rules can be tested exhaustively without a device.
 * useDeviceFlow.ts supplies the clock and the network.
 */

export type DeviceFlowFatalCode =
  | 'device_flow_disabled'
  | 'incorrect_client_credentials'
  | 'unsupported_grant_type'
  | 'incorrect_device_code'
  | 'config_missing'
  | 'unknown';

export type DeviceFlowState =
  | { status: 'idle' }
  | { status: 'requesting_code' }
  | {
      status: 'awaiting_authorization';
      userCode: string;
      verificationUri: string;
      deviceCode: string;
      intervalMs: number;
      /** Absolute wall-clock deadline; never a tick count. */
      expiresAt: number;
      nextPollAt: number;
      attempts: number;
      /** Consecutive transport failures, for a "still retrying" hint. */
      networkFailures: number;
    }
  | { status: 'success'; token: TokenResponse }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'cancelled' }
  | { status: 'fatal'; code: DeviceFlowFatalCode; message: string };

export type DeviceFlowEvent =
  | { type: 'START' }
  | { type: 'CODE_RECEIVED'; response: DeviceCodeResponse }
  | { type: 'POLL_PENDING' }
  | { type: 'POLL_SLOW_DOWN'; serverIntervalSeconds?: number }
  | { type: 'POLL_SUCCESS'; token: TokenResponse }
  | { type: 'POLL_ERROR'; code: DeviceFlowErrorCode; message: string }
  | { type: 'REQUEST_FAILED'; message: string; fatal?: boolean; fatalCode?: DeviceFlowFatalCode }
  | { type: 'DEADLINE' }
  | { type: 'CANCEL' }
  | { type: 'RETRY' };

export const initialState: DeviceFlowState = { status: 'idle' };

/** Surface a "connection problem" hint only after this many consecutive failures. */
export const NETWORK_FAILURE_HINT_THRESHOLD = 5;

/**
 * Per RFC 8628: `slow_down` adds 5s to our interval, and a server-supplied
 * interval wins if it is larger. Never drops below GitHub's 5s floor.
 */
export function nextPollIntervalMs(currentMs: number, serverIntervalSeconds?: number): number {
  const bumped = currentMs + GITHUB.slowDownIncrementMs;
  const server = serverIntervalSeconds != null ? serverIntervalSeconds * 1000 : 0;
  return Math.max(bumped, server, GITHUB.minPollIntervalMs);
}

export function isDeadlinePassed(state: DeviceFlowState, now: number): boolean {
  return state.status === 'awaiting_authorization' && now >= state.expiresAt;
}

export function remainingMs(state: DeviceFlowState, now: number): number {
  if (state.status !== 'awaiting_authorization') return 0;
  return Math.max(0, state.expiresAt - now);
}

export function isTerminal(state: DeviceFlowState): boolean {
  return (
    state.status === 'success' ||
    state.status === 'expired' ||
    state.status === 'denied' ||
    state.status === 'cancelled' ||
    state.status === 'fatal'
  );
}

function fatal(code: DeviceFlowFatalCode, message: string): DeviceFlowState {
  return { status: 'fatal', code, message };
}

export function reduce(
  state: DeviceFlowState,
  event: DeviceFlowEvent,
  now: number,
): DeviceFlowState {
  // Cancellation always wins, from any state.
  if (event.type === 'CANCEL') return { status: 'cancelled' };

  // Defensive deadline enforcement: a late poll response arriving after the
  // 15-minute window must not be treated as still-pending.
  if (isDeadlinePassed(state, now) && event.type !== 'RETRY') {
    return { status: 'expired' };
  }

  switch (event.type) {
    case 'START':
    case 'RETRY':
      return { status: 'requesting_code' };

    case 'CODE_RECEIVED': {
      const { response } = event;
      const intervalMs = Math.max(
        (response.interval ?? 5) * 1000,
        GITHUB.minPollIntervalMs,
      );
      return {
        status: 'awaiting_authorization',
        userCode: response.user_code,
        verificationUri: response.verification_uri || GITHUB.verificationUrl,
        deviceCode: response.device_code,
        intervalMs,
        expiresAt: now + (response.expires_in ?? 900) * 1000,
        nextPollAt: now + intervalMs,
        attempts: 0,
        networkFailures: 0,
      };
    }

    case 'POLL_PENDING': {
      if (state.status !== 'awaiting_authorization') return state;
      return {
        ...state,
        nextPollAt: now + state.intervalMs,
        attempts: state.attempts + 1,
        networkFailures: 0,
      };
    }

    case 'POLL_SLOW_DOWN': {
      if (state.status !== 'awaiting_authorization') return state;
      const intervalMs = nextPollIntervalMs(state.intervalMs, event.serverIntervalSeconds);
      return {
        ...state,
        intervalMs,
        nextPollAt: now + intervalMs,
        attempts: state.attempts + 1,
        networkFailures: 0,
      };
    }

    case 'POLL_SUCCESS':
      return { status: 'success', token: event.token };

    case 'POLL_ERROR':
      switch (event.code) {
        case 'authorization_pending':
          return reduce(state, { type: 'POLL_PENDING' }, now);
        case 'slow_down':
          return reduce(state, { type: 'POLL_SLOW_DOWN' }, now);
        case 'expired_token':
          return { status: 'expired' };
        case 'access_denied':
          return { status: 'denied' };
        case 'device_flow_disabled':
          return fatal('device_flow_disabled', event.message);
        case 'incorrect_client_credentials':
          return fatal('incorrect_client_credentials', event.message);
        case 'unsupported_grant_type':
          return fatal('unsupported_grant_type', event.message);
        case 'incorrect_device_code':
          return fatal('incorrect_device_code', event.message);
        default:
          return fatal('unknown', event.message);
      }

    case 'REQUEST_FAILED': {
      if (event.fatal) return fatal(event.fatalCode ?? 'unknown', event.message);
      // A dropped packet must not kill a flow the user is midway through, so we
      // stay put and try again on the next tick.
      if (state.status !== 'awaiting_authorization') {
        return fatal('unknown', event.message);
      }
      return {
        ...state,
        nextPollAt: now + state.intervalMs,
        attempts: state.attempts + 1,
        networkFailures: state.networkFailures + 1,
      };
    }

    case 'DEADLINE':
      return { status: 'expired' };

    default:
      return state;
  }
}
