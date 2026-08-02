import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';

import { isGitHubConfigured } from '../../../config/env';
import { abortError, isAbortError, nowMs } from '../../../lib/time';
import { GITHUB } from '../config';
import { pollForToken, requestDeviceCode } from './deviceFlow';
import {
  initialState,
  isTerminal,
  reduce,
  type DeviceFlowEvent,
  type DeviceFlowState,
} from './deviceFlowMachine';
import { persistNewGrant } from './tokenManager';

export type UseDeviceFlow = {
  state: DeviceFlowState;
  /** Idempotent; safe to call from a button handler. */
  start: () => void;
  cancel: () => void;
  retry: () => void;
  copyCode: () => Promise<void>;
  openVerificationPage: () => Promise<void>;
  copied: boolean;
};

export function useDeviceFlow(onSuccess?: () => void): UseDeviceFlow {
  const [state, setStateRaw] = useState<DeviceFlowState>(initialState);
  const [copied, setCopied] = useState(false);

  // The loop reads state synchronously, so it needs a ref alongside React state.
  const stateRef = useRef<DeviceFlowState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Guards against React 19 Strict Mode double-invoking effects. Without this,
   * requesting a device code twice would display one code while polling the
   * other, and the flow would silently never complete.
   */
  const startedRef = useRef(false);
  const wakeRef = useRef<(() => void) | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const setState = useCallback((next: DeviceFlowState) => {
    stateRef.current = next;
    setStateRaw(next);
  }, []);

  const dispatch = useCallback(
    (event: DeviceFlowEvent) => {
      setState(reduce(stateRef.current, event, nowMs()));
    },
    [setState],
  );

  /** Sleep that can be cut short by an AppState resume or a cancellation. */
  const waitFor = useCallback((ms: number, signal: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        wakeRef.current = null;
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      const timer = setTimeout(finish, ms);
      wakeRef.current = finish;
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }, []);

  const runLoop = useCallback(
    async (signal: AbortSignal) => {
      // Step 1: get the code the user will type.
      try {
        const response = await requestDeviceCode(signal);
        if (signal.aborted) return;
        dispatch({ type: 'CODE_RECEIVED', response });
      } catch (error) {
        if (signal.aborted || isAbortError(error)) return;
        dispatch({
          type: 'REQUEST_FAILED',
          message: error instanceof Error ? error.message : 'Could not reach GitHub.',
          fatal: true,
        });
        return;
      }

      // Step 2: poll until authorized, denied, expired, or cancelled.
      while (!signal.aborted) {
        const current = stateRef.current;
        if (current.status !== 'awaiting_authorization') return;

        const wait = Math.max(0, current.nextPollAt - nowMs());
        if (wait > 0) {
          try {
            await waitFor(wait, signal);
          } catch {
            return; // aborted
          }
        }
        if (signal.aborted) return;

        // Wall-clock deadline, checked on every iteration. Never tick counting:
        // iOS throttles JS timers hard while the app is backgrounded, and the
        // user is backgrounded for most of this flow.
        if (nowMs() >= current.expiresAt) {
          dispatch({ type: 'DEADLINE' });
          return;
        }

        try {
          const outcome = await pollForToken(current.deviceCode, signal);
          if (signal.aborted) return;

          if (outcome.kind === 'token') {
            dispatch({ type: 'POLL_SUCCESS', token: outcome.token });
            try {
              await persistNewGrant(outcome.token);
              // Closing the browser sheet ourselves is a nice touch; it may
              // already be gone, so failure here is not interesting.
              await WebBrowser.dismissBrowser().catch(() => undefined);
              onSuccessRef.current?.();
            } catch (error) {
              dispatch({
                type: 'REQUEST_FAILED',
                message:
                  error instanceof Error ? error.message : 'Could not save your GitHub credentials.',
                fatal: true,
              });
            }
            return;
          }

          dispatch({ type: 'POLL_ERROR', code: outcome.code, message: outcome.message });
        } catch (error) {
          if (signal.aborted || isAbortError(error)) return;
          // Transport failure: stay in the flow and try again next tick.
          dispatch({
            type: 'REQUEST_FAILED',
            message: error instanceof Error ? error.message : 'Connection problem',
          });
        }

        if (isTerminal(stateRef.current)) return;
      }
    },
    [dispatch, waitFor],
  );

  const start = useCallback(() => {
    if (startedRef.current) return;

    if (!isGitHubConfigured()) {
      setState({
        status: 'fatal',
        code: 'config_missing',
        message:
          'GitHub is not configured. Add your GitHub App client ID and slug to expo.extra.github in app.json, then restart with: npx expo start -c',
      });
      return;
    }

    startedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setState(reduce(stateRef.current, { type: 'START' }, nowMs()));
    void runLoop(controller.signal);
  }, [runLoop, setState]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    startedRef.current = false;
    dispatch({ type: 'CANCEL' });
  }, [dispatch]);

  const retry = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    startedRef.current = false;
    setState(initialState);
    // Defer so the aborted loop fully unwinds before a new one starts.
    setTimeout(() => start(), 0);
  }, [setState, start]);

  const copyCode = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'awaiting_authorization') return;
    await Clipboard.setStringAsync(current.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const openVerificationPage = useCallback(async () => {
    const current = stateRef.current;
    const url =
      current.status === 'awaiting_authorization' ? current.verificationUri : GITHUB.verificationUrl;
    // openAuthSessionAsync uses ASWebAuthenticationSession on iOS, which shares
    // the Safari cookie jar — a user already signed into GitHub skips password
    // and 2FA. openBrowserAsync would force a fresh sign-in every time.
    await WebBrowser.openAuthSessionAsync(url, null).catch(() => undefined);
  }, []);

  // Poll immediately when the user returns from the browser, rather than making
  // them watch a spinner for the remainder of the interval.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status !== 'active') return;
      const current = stateRef.current;
      if (current.status !== 'awaiting_authorization') return;
      if (nowMs() >= current.expiresAt) {
        dispatch({ type: 'DEADLINE' });
        return;
      }
      wakeRef.current?.();
    });
    return () => subscription.remove();
  }, [dispatch]);

  // Abort any in-flight request when the screen goes away.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      startedRef.current = false;
    };
  }, []);

  return { state, start, cancel, retry, copyCode, openVerificationPage, copied };
}
