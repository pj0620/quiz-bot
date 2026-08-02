/** Indirected so tests can freeze time without stubbing globals. */
export function nowMs(): number {
  return Date.now();
}

/** Formats a duration as `m:ss` (or `mm:ss`), clamped at zero. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * `DOMException` is not dependably present in Hermes, so we build an error that
 * matches what an aborted fetch rejects with (`name === 'AbortError'`) by hand.
 */
export function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError';
}

/** Promise timer that settles early (and rejects) if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Compact relative time for list subtitles: "just now", "5m ago", "3d ago". */
export function relativeTime(iso: string | number, from: number = nowMs()): string {
  const then = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = from - then;
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}
