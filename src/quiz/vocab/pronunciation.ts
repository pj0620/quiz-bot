import { HttpError, request, requestJson } from '../../lib/http';

/**
 * Where the SOUND of a word comes from.
 *
 * The recordings behind the speaker button on Google's own definition panel
 * are plain MP3 files on `ssl.gstatic.com`, at guessable paths — no key, no
 * API, just a filename derived from the word. That is the audio people already
 * recognise, so it is tried first, most recent generation first. Words Google
 * never recorded fall through to the Free Dictionary API, which answers with
 * its own hosted recordings (and, for older entries, the very same gstatic
 * files). Only the URL is resolved here; playing it — and falling back to
 * speech synthesis when there is nothing to play — is `usePronunciation`'s
 * job, because this module stays importable under jest.
 *
 * Every lookup is a guess against services with no contract, so the resolver
 * PROBES: a candidate counts only when it answers 200 with an audio body
 * behind it. A captive portal that says 200-with-HTML to everything would
 * otherwise hand the player a login page to chew on.
 */

/** The gstatic sound stores, newest first. Each holds `{word}--_us_1.mp3`. */
const GSTATIC_SOUND_BASES = [
  'https://ssl.gstatic.com/dictionary/static/sounds/20200429',
  'https://ssl.gstatic.com/dictionary/static/sounds/oxford',
];

const DICTIONARY_API_BASE = 'https://api.dictionaryapi.dev/api/v2/entries/en';

/**
 * Snappy by design: these run behind a button tap, and every candidate that
 * times out is time the reader spends staring at a speaker icon. Better to
 * give up and let the synthesised voice answer than to be thorough. No
 * retries for the same reason — the fallback IS the retry.
 */
const LOOKUP_TIMEOUT_MS = 8_000;

/**
 * "Beg the Question" -> "beg_the_question", as a gstatic filename spells it.
 *
 * Deliberately NOT `vocabSlug`, despite the near-identical shape: that one is
 * the word's IDENTITY and hyphenates spaces, where these filenames join with
 * underscores. Coupling them means a future identity rule quietly changes
 * which URLs get probed.
 */
export function pronunciationToken(word: string): string {
  return word
    .trim()
    .toLowerCase()
    // Accents to ASCII: the sound files are named "naive", not "naïve".
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
}

/** The gstatic URLs worth probing for a word, in the order to try them. */
export function candidateAudioUrls(word: string): string[] {
  const token = pronunciationToken(word);
  if (!token) return [];
  return GSTATIC_SOUND_BASES.map((base) => `${base}/${token}--_us_1.mp3`);
}

/**
 * The audio URL out of a Free Dictionary API payload, or undefined.
 *
 * Defensive at every step because the payload is someone else's JSON: entries
 * hold a `phonetics` array whose members MAY carry `audio`, which may be
 * empty, and which is sometimes protocol-relative (`//ssl.gstatic.com/...`).
 * American recordings are preferred to match the gstatic candidates above;
 * otherwise the first one offered wins.
 */
export function audioFromDictionaryPayload(payload: unknown): string | undefined {
  if (!Array.isArray(payload)) return undefined;

  const urls: string[] = [];
  for (const entry of payload) {
    const phonetics = (entry as { phonetics?: unknown })?.phonetics;
    if (!Array.isArray(phonetics)) continue;
    for (const phonetic of phonetics) {
      const audio = (phonetic as { audio?: unknown })?.audio;
      if (typeof audio !== 'string') continue;
      const trimmed = audio.trim();
      if (!trimmed) continue;
      urls.push(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed);
    }
  }

  // Plain-http recordings are dropped rather than fixed up: iOS blocks the
  // request anyway, and rewriting a host we don't control to https is a guess.
  const usable = urls.filter((url) => url.startsWith('https://'));
  return usable.find((url) => /[-_]us[._-]/.test(url)) ?? usable[0];
}

export type PronunciationTransports = {
  /** True when `url` answers 200 with audio behind it. Throws on transport failure. */
  probe?: (url: string) => Promise<boolean>;
  /** The parsed dictionary payload for `word`. Throws `HttpError` on a 404. */
  lookup?: (word: string) => Promise<unknown>;
};

async function probeAudioUrl(url: string): Promise<boolean> {
  const response = await request(url, {
    method: 'HEAD',
    timeoutMs: LOOKUP_TIMEOUT_MS,
    retries: 0,
  });
  if (!response.ok) return false;
  // The captive-portal guard: a 200 whose body is a login page is not audio.
  // An absent content-type passes — the player failing on it is harmless,
  // where rejecting it would silence a working recording.
  const contentType = response.headers.get('content-type') ?? '';
  return contentType === '' || contentType.startsWith('audio/') || contentType === 'application/octet-stream';
}

async function lookupDictionary(word: string): Promise<unknown> {
  const query = encodeURIComponent(word.trim().toLowerCase());
  const { data } = await requestJson<unknown>(`${DICTIONARY_API_BASE}/${query}`, {
    timeoutMs: LOOKUP_TIMEOUT_MS,
    retries: 0,
  });
  return data;
}

/**
 * What resolution concluded, per token, for this app run.
 *
 * `null` records a DEFINITIVE miss — every source answered and none had the
 * word — so later taps go straight to the synthesised voice instead of
 * re-asking the network. A lookup that merely FAILED (offline, timeout) is
 * not a conclusion and is deliberately not cached: the next tap may be on
 * wifi again, and caching "no" while offline would mute the recording for
 * the rest of the run. In-memory only — the audio itself has to be fetched
 * per play anyway, so persisting the URL would save one HEAD request at the
 * cost of staleness bookkeeping.
 */
const resolved = new Map<string, string | null>();

/**
 * The URL of a recording of `word`, or undefined when no source has one.
 *
 * Transports are injectable for tests; callers pass nothing.
 */
export async function resolvePronunciationUrl(
  word: string,
  transports: PronunciationTransports = {},
): Promise<string | undefined> {
  const token = pronunciationToken(word);
  if (!token) return undefined;

  const cached = resolved.get(token);
  if (cached !== undefined) return cached ?? undefined;

  const probe = transports.probe ?? probeAudioUrl;
  const lookup = transports.lookup ?? lookupDictionary;

  let definitive = true;

  for (const url of candidateAudioUrls(word)) {
    try {
      if (await probe(url)) {
        resolved.set(token, url);
        return url;
      }
    } catch {
      definitive = false;
    }
  }

  try {
    const url = audioFromDictionaryPayload(await lookup(word));
    if (url) {
      resolved.set(token, url);
      return url;
    }
  } catch (error) {
    // A 404 is the API answering "no such word" — as definitive as a miss.
    // Anything else means the question never got through.
    if (!(error instanceof HttpError)) definitive = false;
  }

  if (definitive) resolved.set(token, null);
  return undefined;
}
