/**
 * Which files in a connected repository are study notes.
 *
 * A note vault is not a codebase: the only thing worth reading is markdown, and
 * a repository that contains none is a user error worth reporting rather than a
 * bank of zero questions with no explanation.
 */

const NOTE_EXTENSION = /\.mdx?$/i;

/**
 * Directories that exist in a vault but contain nothing to learn.
 *
 * `.obsidian` is the app's own config, `.trash` is deleted notes Obsidian keeps
 * around, and template folders are skeletons full of placeholder text that would
 * otherwise generate confident nonsense.
 */
const SKIP_DIRECTORY = /(^|\/)(\.obsidian|\.trash|\.git|\.github|node_modules|_templates?|templates?|attachments|assets)\//i;

/** Vault housekeeping files that happen to be markdown. */
const SKIP_FILE = /(^|\/)(readme|license|changelog|contributing|index|_index|home|untitled)\.mdx?$/i;

export function isNotePath(path: string): boolean {
  if (!NOTE_EXTENSION.test(path)) return false;
  if (SKIP_DIRECTORY.test(path)) return false;
  if (SKIP_FILE.test(path)) return false;
  return true;
}

/** "History/History of America 40 First Year.md" -> "History of America 40 First Year" */
export function noteStem(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(NOTE_EXTENSION, '');
}

/**
 * The filename exactly as it is in the vault, extension and all.
 *
 * "History/Thinking Fast and Slow 11 Anchors.md" -> "Thinking Fast and Slow 11 Anchors.md"
 *
 * Deliberately unparsed. A vault filename is written by hand and carries the
 * book, the position in it, and the subject in one string — so it is the most
 * reliable context there is, and every attempt to split it into parts is a
 * chance to drop one. This is what the model is shown and what the UI names a
 * note by; `noteStem` and `parseNoteName` exist for topic derivation, which is
 * a separate job with different failure modes.
 */
export function noteFilename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * The immediate parent directory, which in a vault is usually the subject
 * folder ("History", "Books", "Biology"). Returns null at the vault root.
 */
export function noteFolder(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  segments.pop();
  const parent = segments.pop();
  return parent && !parent.startsWith('.') ? parent : null;
}
