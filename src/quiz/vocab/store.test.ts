jest.mock('../../lib/kv', () => ({
  isStorageDegraded: jest.fn(() => false),
  readJsonSync: jest.fn(() => null),
  writeJson: jest.fn(async () => undefined),
  getItemSync: jest.fn(() => null),
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { addQuestions, applyReview, clearQuestionBank, getQuestions, getReviewStates } from '../store';
import type { MultipleChoiceQuestion } from '../types';
import {
  addWord,
  addWords,
  getVocabWord,
  listVocabWords,
  questionsForWord,
  recordFailure,
  recordGenerated,
  removeWord,
  updateWordSense,
  vocabStore,
} from './store';
import { VOCAB_SOURCE_ID, VOCAB_TOPIC, vocabPath } from './types';

const NOW = 1_760_000_000_000;

/** A bank row shaped exactly as `parseQuestions` will build it for a word. */
function vocabQuestion(slug: string, id: string): MultipleChoiceQuestion {
  return {
    id,
    prompt: `Prompt ${id}`,
    explanation: 'Because.',
    topics: [VOCAB_TOPIC],
    difficulty: 'core',
    sourceId: VOCAB_SOURCE_ID,
    provenance: { sourceId: VOCAB_SOURCE_ID, path: vocabPath(slug), noteTitle: slug },
    addedAt: NOW,
    format: 'multiple-choice',
    choices: [
      { id: 'c0', text: 'yes' },
      { id: 'c1', text: 'no' },
    ],
    correctChoiceId: 'c0',
  };
}

beforeEach(() => {
  vocabStore.set({ words: {} });
  clearQuestionBank();
});

describe('addWord', () => {
  it('stores the display form and keys the row by its slug', () => {
    expect(addWord({ word: 'Laconic', addedBy: 'user' }, NOW)).toEqual({
      slug: 'laconic',
      added: true,
    });
    expect(getVocabWord('laconic')).toMatchObject({ word: 'Laconic', addedBy: 'user' });
  });

  it('does not create a second row for the same word typed differently', () => {
    addWord({ word: 'Laconic', addedBy: 'user' }, NOW);
    expect(addWord({ word: 'laconic', addedBy: 'ai' }, NOW)).toEqual({
      slug: 'laconic',
      added: false,
    });
    expect(listVocabWords()).toHaveLength(1);
  });

  /*
    Existing rows win, like `addQuestions`. A re-add carrying no definition must
    not flatten the meaning and generation history already on the row.
  */
  it('keeps what the existing row already knows when a duplicate arrives', () => {
    addWord({ word: 'laconic', definition: 'using few words', addedBy: 'ai' }, NOW);
    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    expect(getVocabWord('laconic')).toMatchObject({
      definition: 'using few words',
      addedBy: 'ai',
    });
  });

  it('reports duplicates separately when a whole batch is added', () => {
    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    const result = addWords(
      [
        { word: 'laconic', addedBy: 'ai' },
        { word: 'perfunctory', addedBy: 'ai' },
      ],
      NOW,
    );
    expect(result).toEqual({ added: ['perfunctory'], duplicates: ['laconic'] });
  });

  it('lists the most recently added word first', () => {
    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    addWord({ word: 'perfunctory', addedBy: 'user' }, NOW + 1_000);
    expect(listVocabWords().map((word) => word.slug)).toEqual(['perfunctory', 'laconic']);
  });
});

describe('generation history', () => {
  it('clears a recorded failure once the word succeeds, so stale errors do not linger', () => {
    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    recordFailure('laconic', 'Network request failed');
    expect(getVocabWord('laconic')?.lastError).toBe('Network request failed');

    recordGenerated('laconic', NOW);
    expect(getVocabWord('laconic')?.lastError).toBeUndefined();
    expect(getVocabWord('laconic')?.lastGeneratedAt).toBe(NOW);
  });

  it('stores the sense the questions were actually written against', () => {
    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    updateWordSense('laconic', { definition: 'using very few words', partOfSpeech: 'adjective' });
    expect(getVocabWord('laconic')).toMatchObject({
      definition: 'using very few words',
      partOfSpeech: 'adjective',
    });
  });

  it('ignores a write for a word that has been removed', () => {
    expect(() => recordGenerated('gone', NOW)).not.toThrow();
    expect(getVocabWord('gone')).toBeUndefined();
  });
});

describe('questionsForWord', () => {
  it('finds only the questions belonging to that word', () => {
    addQuestions([vocabQuestion('laconic', 'q1'), vocabQuestion('perfunctory', 'q2')]);
    expect(questionsForWord('laconic').map((question) => question.id)).toEqual(['q1']);
  });

  it('never claims a note question as a word question', () => {
    addQuestions([
      { ...vocabQuestion('laconic', 'q1'), sourceId: 'github-repo:1', provenance: { sourceId: 'github-repo:1', path: 'notes/a.md' } },
    ]);
    expect(questionsForWord('laconic')).toHaveLength(0);
  });
});

describe('removeWord', () => {
  it('takes the word and its questions together', () => {
    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    addQuestions([vocabQuestion('laconic', 'q1'), vocabQuestion('laconic', 'q2')]);

    expect(removeWord('laconic')).toEqual({ removedQuestions: 2 });
    expect(getVocabWord('laconic')).toBeUndefined();
    expect(getQuestions()).toHaveLength(0);
  });

  it('leaves other words alone', () => {
    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    addWord({ word: 'perfunctory', addedBy: 'user' }, NOW);
    addQuestions([vocabQuestion('laconic', 'q1'), vocabQuestion('perfunctory', 'q2')]);

    removeWord('laconic');
    expect(getQuestions().map((question) => question.id)).toEqual(['q2']);
    expect(getVocabWord('perfunctory')).toBeDefined();
  });

  /*
    The reason removal goes through `deleteQuestion` rather than filtering the
    bank. Ids are deterministic, so re-adding the same word regenerates the SAME
    ids — and a review state left behind would be silently re-adopted, handing
    the user a brand new question that already thinks it is due in six months.
  */
  it('takes the review history with it, so re-adding the word starts from scratch', () => {
    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    addQuestions([vocabQuestion('laconic', 'q1')]);
    applyReview('q1', 'correct', NOW);
    expect(getReviewStates()['q1']).toBeDefined();

    removeWord('laconic');
    expect(getReviewStates()['q1']).toBeUndefined();

    addWord({ word: 'laconic', addedBy: 'user' }, NOW);
    addQuestions([vocabQuestion('laconic', 'q1')]);
    expect(getReviewStates()['q1']).toBeUndefined();
  });

  it('is a no-op for a word that is not there', () => {
    expect(removeWord('nothing')).toEqual({ removedQuestions: 0 });
  });
});

/*
  The mirror of the coverage mistake documented in store.ts: there, keeping a
  ledger through a bank clear BLOCKED regeneration. Here, keeping it is what
  makes regeneration possible at all — the word list is the only record of what
  to write questions about.
*/
it('keeps the word list when the question bank is cleared', () => {
  addWord({ word: 'laconic', addedBy: 'user' }, NOW);
  addQuestions([vocabQuestion('laconic', 'q1')]);

  clearQuestionBank();

  expect(listVocabWords()).toHaveLength(1);
  expect(questionsForWord('laconic')).toHaveLength(0);
});
