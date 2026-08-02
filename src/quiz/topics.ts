/**
 * Topic normalization.
 *
 * Topics are the load-bearing weak link in this design: they drive topic
 * quizzes AND the mastery display, and they're produced by a generator rather
 * than curated. If "React Hooks", "react hooks" and "react-hooks" coexist, both
 * features quietly degrade — you get three near-empty quizzes and mastery
 * numbers split across synonyms.
 *
 * So: normalize aggressively at WRITE time (never at read time, or the bank and
 * the rules disagree), and elsewhere never let a user type a free-form topic —
 * they pick from `topicVocabulary()`, which can only contain normalized values.
 */

const MAX_TOPICS_PER_QUESTION = 3;
const MAX_TOPIC_LENGTH = 32;

/**
 * Words too generic to be useful as a study topic.
 *
 * The second group is what a vault produces: notes filed under "Chapter 3" or
 * sitting in a folder called "Notes" would otherwise become topics that match
 * everything and mean nothing.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'is',
  'it', 'this', 'that', 'general', 'misc', 'other', 'stuff', 'thing', 'things',

  'note', 'notes', 'chapter', 'chapters', 'section', 'sections', 'part',
  'summary', 'untitled', 'index', 'inbox', 'daily', 'todo', 'draft', 'unsorted',
]);

/**
 * "React Hooks!" -> "react-hooks". Returns null when nothing usable survives,
 * which callers must drop rather than store as an empty string.
 */
export function normalizeTopic(raw: string): string | null {
  const slug = raw
    .trim()
    .toLowerCase()
    // Accents to ASCII so "café" and "cafe" don't split a topic.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) return null;
  if (STOPWORDS.has(slug)) return null;

  if (slug.length > MAX_TOPIC_LENGTH) {
    /*
      Cut at a word boundary.

      A hard slice produces "podcast-netherlands-the-revolt-t", which is what a
      truncated topic looks like everywhere it's displayed. Dropping the partial
      trailing word costs a little precision and reads like something a person
      wrote. The floor stops a single very long first word from cutting to
      nothing.
    */
    const cut = slug.slice(0, MAX_TOPIC_LENGTH);
    const boundary = cut.lastIndexOf('-');
    const trimmed = boundary >= 8 ? cut.slice(0, boundary) : cut;
    return trimmed.replace(/-+$/g, '');
  }

  return slug;
}

/**
 * Normalizes, de-duplicates, drops stopwords, and caps the count. Order is
 * preserved so the generator's most-relevant-first ordering survives — the
 * first topic is treated as primary in the UI.
 */
export function normalizeTopics(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw) {
    const topic = normalizeTopic(value);
    if (!topic || seen.has(topic)) continue;
    seen.add(topic);
    result.push(topic);
    if (result.length >= MAX_TOPICS_PER_QUESTION) break;
  }
  return result;
}

/** "react-hooks" -> "React Hooks", for display only. */
export function formatTopic(topic: string): string {
  return topic
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export type TopicCount = { topic: string; count: number };

/**
 * The set of topics actually present in the bank, most common first.
 *
 * This is what the quiz editor offers. A rule can only ever reference a topic
 * that exists, which removes the entire class of "I made a quiz and it has zero
 * questions because I typed a topic nothing matches".
 */
export function topicVocabulary(
  questions: readonly { topics: string[] }[],
): TopicCount[] {
  const counts = new Map<string, number>();
  for (const question of questions) {
    for (const topic of question.topics) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([topic, count]) => ({ topic, count })).sort(
    // Count descending, then alphabetically so ordering is stable across renders.
    (a, b) => b.count - a.count || a.topic.localeCompare(b.topic),
  );
}
