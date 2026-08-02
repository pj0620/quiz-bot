import { AppError, ReauthRequiredError } from '../../../lib/errors';
import { parseLinkHeader, requestJson, requestText, type RequestOptions } from '../../../lib/http';
import { GITHUB } from '../config';
import { forceRefresh, getValidAccessToken } from '../auth/tokenManager';
import { classifyThrown } from './errors';

/**
 * The only module that talks to api.github.com. Handles auth header injection,
 * the 401 -> refresh -> retry-once cycle, and Link-header pagination.
 */

export type GitHubRequestOptions = RequestOptions & {
  /** Media type; defaults to the JSON API. Raw is used for file contents. */
  accept?: string;
  /** Internal: prevents the 401 retry from recursing more than once. */
  retryOn401?: boolean;
};

function buildHeaders(token: string, accept: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: accept,
    'X-GitHub-Api-Version': GITHUB.apiVersion,
    ...extra,
  };
}

async function send(
  path: string,
  options: GitHubRequestOptions,
  mode: 'json' | 'text',
): Promise<{ data: unknown; headers: Headers }> {
  const { accept = GITHUB.acceptJson, retryOn401 = true, headers, ...rest } = options;
  const token = await getValidAccessToken();
  const url = path.startsWith('http') ? path : `${GITHUB.apiHost}${path}`;

  try {
    const runner = mode === 'json' ? requestJson : requestText;
    const result = await runner(url, { ...rest, headers: buildHeaders(token, accept, headers) });
    return { data: result.data, headers: result.headers };
  } catch (error) {
    const appError = classifyThrown(error);

    // A 401 is the only thing that reliably catches server-side revocation and
    // clock skew, so proactive expiry checks are not a substitute for this.
    if (appError.code === 'reauth_required' && retryOn401) {
      await forceRefresh(); // single-flight; throws ReauthRequiredError if dead
      return send(path, { ...options, retryOn401: false }, mode);
    }
    throw appError;
  }
}

export async function githubRequest<T>(path: string, options: GitHubRequestOptions = {}): Promise<T> {
  const { data } = await send(path, options, 'json');
  return data as T;
}

export async function githubRequestRaw(path: string, options: GitHubRequestOptions = {}): Promise<string> {
  const { data } = await send(path, { ...options, accept: options.accept ?? GITHUB.acceptRaw }, 'text');
  return data as string;
}

/** Returns the payload plus the parsed Link header, for paginated endpoints. */
export async function githubRequestWithLinks<T>(
  path: string,
  options: GitHubRequestOptions = {},
): Promise<{ data: T; links: Record<string, string> }> {
  const { data, headers } = await send(path, options, 'json');
  return { data: data as T, links: parseLinkHeader(headers.get('link')) };
}

/**
 * Follows `rel="next"` until exhausted, capped defensively so a pagination bug
 * can never turn into an unbounded request loop against a shared rate limit.
 */
export async function paginate<TPage, TItem>(
  firstPath: string,
  extract: (page: TPage) => TItem[],
  options: GitHubRequestOptions = {},
): Promise<TItem[]> {
  const items: TItem[] = [];
  let path: string | undefined = firstPath;
  let pages = 0;

  while (path && pages < GITHUB.maxPages) {
    // Annotated explicitly: `path` is both an input here and reassigned from the
    // result below, which TS otherwise reads as a circular initializer.
    const page: { data: TPage; links: Record<string, string> } =
      await githubRequestWithLinks<TPage>(path, options);
    items.push(...extract(page.data));
    path = page.links.next;
    pages += 1;
  }
  return items;
}

export { AppError, ReauthRequiredError };
