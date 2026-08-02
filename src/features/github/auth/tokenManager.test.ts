import { ReauthRequiredError } from '../../../lib/errors';
import type { GitHubTokenRecord, TokenResponse } from '../types';

jest.mock('../../../config/env', () => ({
  requireGitHubConfig: () => ({ clientId: 'Iv23liTEST', appSlug: 'quizbot-test' }),
}));

jest.mock('./secureTokenStore', () => ({
  readTokenRecord: jest.fn(),
  writeTokenRecord: jest.fn(),
  deleteTokenRecord: jest.fn(),
}));

jest.mock('./deviceFlow', () => ({
  refreshAccessToken: jest.fn(),
}));

jest.mock('./connectionStore', () => ({
  setStatus: jest.fn(),
  clearConnection: jest.fn(),
  getConnection: () => ({ status: 'connected' }),
}));

import { refreshAccessToken } from './deviceFlow';
import { deleteTokenRecord, readTokenRecord, writeTokenRecord } from './secureTokenStore';
import {
  __resetTokenManagerForTests,
  forceRefresh,
  getValidAccessToken,
  recordFromTokenResponse,
} from './tokenManager';

const mockRead = readTokenRecord as jest.MockedFunction<typeof readTokenRecord>;
const mockWrite = writeTokenRecord as jest.MockedFunction<typeof writeTokenRecord>;
const mockDelete = deleteTokenRecord as jest.MockedFunction<typeof deleteTokenRecord>;
const mockRefresh = refreshAccessToken as jest.MockedFunction<typeof refreshAccessToken>;

const NOW = 1_700_000_000_000;
const MARGIN_MS = 5 * 60_000;

function record(overrides: Partial<GitHubTokenRecord> = {}): GitHubTokenRecord {
  return {
    version: 1,
    clientId: 'Iv23liTEST',
    accessToken: 'ghu_current',
    refreshToken: 'ghr_current',
    issuedAt: NOW - 1000,
    accessTokenExpiresAt: NOW + 8 * 3600_000,
    refreshTokenExpiresAt: NOW + 15897600_000,
    ...overrides,
  };
}

function tokenResponse(overrides: Partial<TokenResponse> = {}): TokenResponse {
  return {
    access_token: 'ghu_rotated',
    token_type: 'bearer',
    expires_in: 28800,
    refresh_token: 'ghr_rotated',
    refresh_token_expires_in: 15897600,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetTokenManagerForTests();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockWrite.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getValidAccessToken — expiry math', () => {
  it('returns the cached token when comfortably valid', async () => {
    mockRead.mockResolvedValue(record());
    await expect(getValidAccessToken()).resolves.toBe('ghu_current');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('does not refresh just outside the margin', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW + MARGIN_MS + 1 }));
    await expect(getValidAccessToken()).resolves.toBe('ghu_current');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('refreshes exactly at the margin boundary', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW + MARGIN_MS }));
    mockRefresh.mockResolvedValue({ kind: 'token', token: tokenResponse() });
    await expect(getValidAccessToken()).resolves.toBe('ghu_rotated');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes an already-expired token', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW - 1 }));
    mockRefresh.mockResolvedValue({ kind: 'token', token: tokenResponse() });
    await expect(getValidAccessToken()).resolves.toBe('ghu_rotated');
  });

  /**
   * Regression guard for the highest-risk bug in this feature: with token
   * expiration disabled on the GitHub App, GitHub omits expires_in entirely.
   * Naive arithmetic yields NaN, compares false, and refreshes on every call.
   */
  it('never refreshes a non-expiring grant', async () => {
    mockRead.mockResolvedValue(
      record({ accessTokenExpiresAt: undefined, refreshToken: undefined, refreshTokenExpiresAt: undefined }),
    );
    await expect(getValidAccessToken()).resolves.toBe('ghu_current');
    await expect(getValidAccessToken()).resolves.toBe('ghu_current');
    await expect(getValidAccessToken()).resolves.toBe('ghu_current');
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('forces a refresh when the device clock moved backwards', async () => {
    mockRead.mockResolvedValue(record({ issuedAt: NOW + 120_000 }));
    mockRefresh.mockResolvedValue({ kind: 'token', token: tokenResponse() });
    await expect(getValidAccessToken()).resolves.toBe('ghu_rotated');
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('getValidAccessToken — reauth paths', () => {
  it('throws without a network call when nothing is stored', async () => {
    mockRead.mockResolvedValue(null);
    await expect(getValidAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('throws without a network call when the refresh token has expired', async () => {
    mockRead.mockResolvedValue(record({ refreshTokenExpiresAt: NOW - 1 }));
    await expect(getValidAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('clears the credential when GitHub rejects the refresh token', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW - 1 }));
    mockRefresh.mockResolvedValue({ kind: 'error', code: 'bad_refresh_token', message: 'dead' });
    await expect(getValidAccessToken()).rejects.toBeInstanceOf(ReauthRequiredError);
    expect(mockDelete).toHaveBeenCalled();
  });

  it('does NOT clear the credential when the network fails', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW - 1 }));
    mockRefresh.mockRejectedValue(new TypeError('Network request failed'));
    await expect(getValidAccessToken()).rejects.toThrow();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe('refresh token rotation', () => {
  it('persists the NEW refresh token, not the old one', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW - 1 }));
    mockRefresh.mockResolvedValue({ kind: 'token', token: tokenResponse() });

    await getValidAccessToken();

    expect(mockWrite).toHaveBeenCalledTimes(1);
    const persisted = mockWrite.mock.calls[0][0];
    expect(persisted.refreshToken).toBe('ghr_rotated');
    expect(persisted.accessToken).toBe('ghu_rotated');
    expect(persisted.accessTokenExpiresAt).toBe(NOW + 28800_000);
  });

  it('persists before returning, so a failed write never strands a rotated token', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW - 1 }));
    mockRefresh.mockResolvedValue({ kind: 'token', token: tokenResponse() });
    mockWrite.mockRejectedValue(new Error('keychain full'));

    await expect(getValidAccessToken()).rejects.toThrow();
  });
});

describe('single-flight refresh', () => {
  it('collapses concurrent callers onto exactly one network refresh', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW - 1 }));

    let calls = 0;
    mockRefresh.mockImplementation(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { kind: 'token', token: tokenResponse() };
    });

    const results = await Promise.all([
      getValidAccessToken(),
      getValidAccessToken(),
      getValidAccessToken(),
      getValidAccessToken(),
      getValidAccessToken(),
    ]);

    expect(calls).toBe(1);
    expect(results).toEqual(Array(5).fill('ghu_rotated'));
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of simultaneous 401 retries too', async () => {
    mockRead.mockResolvedValue(record());

    let calls = 0;
    mockRefresh.mockImplementation(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { kind: 'token', token: tokenResponse() };
    });

    await Promise.all([forceRefresh(), forceRefresh(), forceRefresh()]);
    expect(calls).toBe(1);
  });

  it('allows a later refresh after the in-flight one settles', async () => {
    mockRead.mockResolvedValue(record({ accessTokenExpiresAt: NOW - 1 }));
    mockRefresh.mockResolvedValue({ kind: 'token', token: tokenResponse() });

    await forceRefresh();
    await forceRefresh();
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });
});

describe('recordFromTokenResponse', () => {
  it('computes absolute expiries from relative lifetimes', () => {
    const result = recordFromTokenResponse(tokenResponse(), NOW);
    expect(result.accessTokenExpiresAt).toBe(NOW + 28800_000);
    expect(result.refreshTokenExpiresAt).toBe(NOW + 15897600_000);
    expect(result.version).toBe(1);
    expect(result.clientId).toBe('Iv23liTEST');
  });

  it('leaves expiries undefined when GitHub omits them', () => {
    const result = recordFromTokenResponse(
      { access_token: 'ghu_x', token_type: 'bearer' },
      NOW,
    );
    expect(result.accessTokenExpiresAt).toBeUndefined();
    expect(result.refreshTokenExpiresAt).toBeUndefined();
    expect(result.refreshToken).toBeUndefined();
  });
});
