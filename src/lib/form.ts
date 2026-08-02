/**
 * application/x-www-form-urlencoded bodies for GitHub's OAuth endpoints.
 *
 * Hand-rolled for the same reason as query.ts: relying on `URLSearchParams` as a
 * fetch body to set Content-Type correctly is not dependable across RN versions.
 * We always send the header explicitly alongside this.
 */
export function encodeForm(fields: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}

export const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';
