import { createDebouncedRecordSaver, loadRecordSync, type PersistConfig } from '../../lib/persist';
import { isValidVocabWord, type VocabWord } from './types';

/**
 * Persistence for the word ledger.
 *
 * Uses the shared ENVELOPE helpers rather than the raw `readJsonSync` /
 * `writeJson` pair the coverage ledger uses. Coverage is derived and cheap to
 * lose — regenerating it costs a re-read. A word list is content the user typed
 * or curated, so it gets the same treatment as review states: a version check,
 * and per-row validation so one corrupt entry drops alone instead of taking the
 * list with it.
 *
 * Record-shaped rather than an array, because every access is by slug.
 */
const VOCAB_KEY = 'quizbot.vocab.v1';

/**
 * Bounds both the kv value and the "don't suggest these again" list that rides
 * in the suggestion prompt.
 */
export const MAX_VOCAB_WORDS = 1000;

export const vocabConfig: PersistConfig<VocabWord> = {
  key: VOCAB_KEY,
  version: 1,
  isValid: isValidVocabWord,
};

export const loadVocabSync = () => loadRecordSync(vocabConfig);
export const vocabSaver = createDebouncedRecordSaver(vocabConfig);
