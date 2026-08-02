import { requireGitHubConfig } from '../../../config/env';
import { encodeForm, FORM_CONTENT_TYPE } from '../../../lib/form';
import { AppError, toAppError } from '../../../lib/errors';
import { requestJson } from '../../../lib/http';
import { GITHUB } from '../config';
import {
  isOAuthError,
  type DeviceCodeResponse,
  type DeviceFlowErrorCode,
  type OAuthResponse,
  type TokenResponse,
} from '../types';

/**
 * Network calls against github.com (NOT api.github.com). The only module that
 * talks to the OAuth endpoints.
 *
 * No client secret appears anywhere in this file, by design: the device flow
 * omits it, and GitHub's refresh endpoint documents client_secret as "Required
 * unless the user access token was generated using the device flow". That single
 * exemption is what lets this app hold credentials indefinitely with no backend.
 */

const OAUTH_HEADERS = {
  Accept: 'application/json',
  'Content-Type': FORM_CONTENT_TYPE,
};

/** Step 1: ask GitHub for a device code + the code the user will type. */
export async function requestDeviceCode(signal?: AbortSignal): Promise<DeviceCodeResponse> {
  const { clientId } = requireGitHubConfig();

  const { data } = await requestJson<DeviceCodeResponse | OAuthResponse>(GITHUB.deviceCodeUrl, {
    method: 'POST',
    headers: OAUTH_HEADERS,
    body: encodeForm({ client_id: clientId }),
    signal,
  });

  if (isOAuthError(data as OAuthResponse)) {
    const error = data as { error: string; error_description?: string };
    throw new AppError('unknown', {
      message: describeOAuthError(error.error, error.error_description),
    });
  }

  const response = data as DeviceCodeResponse;
  if (!response?.device_code || !response?.user_code) {
    throw new AppError('unknown', { message: 'GitHub returned an unexpected device code response.' });
  }
  return response;
}

export type PollOutcome =
  | { kind: 'token'; token: TokenResponse }
  | { kind: 'error'; code: DeviceFlowErrorCode; intervalSeconds?: number; message: string };

/**
 * Step 2: exchange the device code for a token, once.
 *
 * GitHub reports pending/denied/expired as HTTP 200 with an `error` field, so
 * this resolves with an outcome rather than throwing for those cases. It only
 * throws for transport failures, which the caller treats as retryable.
 */
export async function pollForToken(deviceCode: string, signal?: AbortSignal): Promise<PollOutcome> {
  const { clientId } = requireGitHubConfig();

  const { data } = await requestJson<OAuthResponse>(GITHUB.accessTokenUrl, {
    method: 'POST',
    headers: OAUTH_HEADERS,
    body: encodeForm({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: GITHUB.deviceGrantType,
    }),
    signal,
  });

  if (isOAuthError(data)) {
    return {
      kind: 'error',
      code: data.error as DeviceFlowErrorCode,
      intervalSeconds: data.interval,
      message: describeOAuthError(data.error, data.error_description),
    };
  }

  return { kind: 'token', token: data };
}

/**
 * Refreshes an expiring access token. No client secret — see the note at the top
 * of this file. Returns the raw response so the caller can persist the ROTATED
 * refresh token, which GitHub reissues on every refresh.
 */
export async function refreshAccessToken(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<{ kind: 'token'; token: TokenResponse } | { kind: 'error'; code: string; message: string }> {
  const { clientId } = requireGitHubConfig();

  const { data } = await requestJson<OAuthResponse>(GITHUB.accessTokenUrl, {
    method: 'POST',
    headers: OAUTH_HEADERS,
    body: encodeForm({
      client_id: clientId,
      grant_type: GITHUB.refreshGrantType,
      refresh_token: refreshToken,
    }),
    signal,
  });

  if (isOAuthError(data)) {
    return {
      kind: 'error',
      code: data.error,
      message: describeOAuthError(data.error, data.error_description),
    };
  }
  return { kind: 'token', token: data };
}

/** Developer-facing text that names the actual fix where one exists. */
export function describeOAuthError(code: string, description?: string): string {
  switch (code) {
    case 'device_flow_disabled':
      return 'Device Flow is not enabled for this GitHub App. Enable it in the app settings under "Identifying and authorizing users".';
    case 'incorrect_client_credentials':
      return 'GitHub rejected the client ID. Check expo.extra.github.clientId in app.json.';
    case 'unsupported_grant_type':
      return 'GitHub rejected the grant type for this request.';
    case 'incorrect_device_code':
      return 'That device code is no longer valid. Start again to get a new code.';
    case 'access_denied':
      return 'Authorization was cancelled on GitHub.';
    case 'expired_token':
      return 'The code expired before it was entered.';
    default:
      return description ?? `GitHub returned an error: ${code}`;
  }
}

export { toAppError };
