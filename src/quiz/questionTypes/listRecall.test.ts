import type { ListRecallQuestion } from '../types';
import { entryMatchesItem, listRecallAnswer, listRecallLogic, listRecallNeedsJudge } from './listRecall';

const question: ListRecallQuestion = {
  id: 'q1',
  prompt: 'Name 3 of the 4 Northern advantages.',
  explanation: 'Because.',
  topics: [],
  difficulty: 'core',
  sourceId: 'src-1',
  provenance: { sourceId: 'src-1', path: 'a.md' },
  addedAt: 0,
  format: 'list-recall',
  required: 3,
  items: ['Population', 'Economic Strength', 'Professional Military', 'Presidential Leadership'],
} as ListRecallQuestion;

describe('entryMatchesItem', () => {
  it('matches exactly, ignoring case and trailing punctuation', () => {
    expect(entryMatchesItem('population.', 'Population')).toBe(true);
  });

  it('matches by containment either way round', () => {
    expect(entryMatchesItem('Population', 'Population advantage')).toBe(true);
    expect(entryMatchesItem('the population ratio', 'Population')).toBe(true);
  });

  it('does not use containment on very short text', () => {
    expect(entryMatchesItem('war', 'warfare')).toBe(false);
  });

  it('forgives a spelling slip', () => {
    expect(entryMatchesItem('Presidental Leadership', 'Presidential Leadership')).toBe(true);
    expect(entryMatchesItem('Professional Militery', 'Professional Military')).toBe(true);
  });

  it('forgives reordered words', () => {
    expect(entryMatchesItem('leadership presidential', 'Presidential Leadership')).toBe(true);
  });

  it('does not match a different item that merely looks alike', () => {
    expect(entryMatchesItem('Economic Weakness', 'Economic Strength')).toBe(false);
    expect(entryMatchesItem('Popularity', 'Population')).toBe(false);
  });
});

describe('listRecallLogic.grade', () => {
  it('counts a misspelt entry, so the grade does not depend on a model', () => {
    const grade = listRecallLogic.grade(question, listRecallAnswer(['Populaton', 'Economic Strenght', 'Professional Military']));
    expect(grade).toEqual({
      status: 'graded',
      outcome: 'correct',
      score: 1,
      parts: { '0': true, '1': true, '2': true },
    });
  });

  it('claims each item once, so a repeated entry cannot score twice', () => {
    const grade = listRecallLogic.grade(question, listRecallAnswer(['Population', 'population', 'Population']));
    expect(grade).toMatchObject({ outcome: 'partial', score: 1 / 3, parts: { '0': true } });
  });

  it('adds the model’s matches to its own', () => {
    const grade = listRecallLogic.grade(question, listRecallAnswer(['Population', 'lots of people'], { matchedItems: [3] }));
    expect(grade).toMatchObject({ score: 2 / 3, parts: { '0': true, '3': true } });
  });
});

describe('listRecallNeedsJudge', () => {
  it('is false when every entry already names an item', () => {
    expect(listRecallNeedsJudge(question, ['Population', 'Economic Strenght'])).toBe(false);
    expect(listRecallNeedsJudge(question, ['Population', '', ''])).toBe(false);
  });

  it('is false when enough items are named for full marks whatever the rest', () => {
    // The model can only add matches, and the score is already capped.
    expect(
      listRecallNeedsJudge(question, ['Population', 'Economic Strength', 'Professional Military', 'a good navy']),
    ).toBe(false);
  });

  it('is true when an unmatched entry could still raise the grade', () => {
    expect(listRecallNeedsJudge(question, ['Population', 'a strong economy'])).toBe(true);
    expect(listRecallNeedsJudge(question, ['many people'])).toBe(true);
  });

  it('is false when nothing was typed', () => {
    expect(listRecallNeedsJudge(question, ['', ' '])).toBe(false);
  });
});
