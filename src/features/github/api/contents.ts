import { buildQuery, encodeFilePath, encodePathSegment } from '../../../lib/query';
import { GITHUB } from '../config';
import { githubRequestRaw } from './client';

/**
 * Reads a single file's contents.
 *
 * Always requests the `raw` media type. Two reasons: it skips base64 entirely
 * (Hermes' `atob` support is not worth betting on), and it is mandatory for
 * files between 1 MB and 100 MB, where the JSON variant silently returns an
 * empty `content` with `encoding: "none"` instead of an error.
 *
 * Files over 100 MB are not supported by this endpoint at all.
 */
export async function getFileRaw(
  owner: string,
  repo: string,
  path: string,
  options: { ref?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const query = buildQuery({ ref: options.ref });
  return githubRequestRaw(
    `/repos/${encodePathSegment(owner)}/${encodePathSegment(repo)}/contents/${encodeFilePath(path)}${query}`,
    { accept: GITHUB.acceptRaw, signal: options.signal },
  );
}
