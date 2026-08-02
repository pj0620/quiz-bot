/**
 * Query-string building.
 *
 * Deliberately hand-rolled: React Native 0.86's `URL` is a regex approximation
 * (it appends trailing slashes and has no real parser) and its `URLSearchParams`
 * is a partial shim. Neither is worth betting request correctness on.
 */

export type QueryValue = string | number | boolean | undefined | null;

/** Builds `?a=1&b=2`, skipping undefined/null. Returns '' when nothing is set. */
export function buildQuery(params: Record<string, QueryValue>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/**
 * Percent-encodes a path segment for use in a URL path.
 * `encodeURIComponent` escapes `/`, which is what we want for a single segment.
 */
export function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Encodes a repo file path, preserving `/` separators but escaping each segment.
 * `src/a b.ts` -> `src/a%20b.ts`
 */
export function encodeFilePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodePathSegment)
    .join('/');
}
