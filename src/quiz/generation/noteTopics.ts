import type { ParsedNote } from '../../notes/parse';
import { noteFolder } from '../../notes/paths';
import { normalizeTopics } from '../topics';

/**
 * The topics a note's questions carry.
 *
 * Shared by every generator, and deliberately NOT delegated to an LLM. The
 * series is the primary topic, which is the single decision that makes topic
 * quizzes and mastery meaningful: forty notes named "History of America 17..40"
 * collapse onto one subject someone might actually want a quiz on, instead of
 * forty topics matching one note each.
 *
 * A model asked to pick topics per note would drift — "American History",
 * "US history", "civil-war" — and re-fragment the vocabulary within a few runs.
 */
export function topicsForNote(note: ParsedNote, path: string): string[] {
  const candidates = [note.series ?? note.title, ...note.tags];
  const folder = noteFolder(path);
  if (folder) candidates.push(folder);

  const topics = normalizeTopics(candidates);
  // Deliberately not 'notes' or 'general' — both are stopwords, so a fallback
  // using them could never be produced by normalization and would look like a
  // real topic while being unreachable from the vocabulary.
  return topics.length > 0 ? topics : ['unfiled'];
}
