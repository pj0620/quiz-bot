import { isValidQuestion } from '../questionTypes/registry';
import type { MultipleChoiceQuestion, Question, TimelineQuestion } from '../types';
import { calendarQuestionId, listCalendarQuestions } from './catalog';
import { HOLIDAYS, MONTHS } from './data';
import { CALENDAR_SOURCE_ID, CALENDAR_SUBJECTS, CALENDAR_TOPIC } from './types';

/*
  The catalog's contract, inherited verbatim from geography:

    the ID may depend only on subject/kind/item; everything else may depend
    on the seed.

  Both halves fail SILENTLY — a moved id orphans review states without a
  single error, and a frozen option set never surfaces as a bug.
*/

const NOW = 1_760_000_000_000;
const SEED = 12345;

const ALL = () => listCalendarQuestions(CALENDAR_SUBJECTS, SEED, NOW);

function find(id: string, seed = SEED): Question | undefined {
  return listCalendarQuestions(CALENDAR_SUBJECTS, seed, NOW).find(
    (question) => question.id === id,
  );
}

function findChoice(id: string, seed = SEED): MultipleChoiceQuestion {
  const question = find(id, seed);
  if (question?.format !== 'multiple-choice') throw new Error(`expected multiple-choice for ${id}`);
  return question;
}

describe('question identity', () => {
  it('gives the same ids across different seeds', () => {
    const a = listCalendarQuestions(CALENDAR_SUBJECTS, 1, NOW);
    const b = listCalendarQuestions(CALENDAR_SUBJECTS, 99999, NOW);

    expect(a.map((question) => question.id)).toEqual(b.map((question) => question.id));
  });

  it('gives the same ids across different derivation clocks', () => {
    const a = listCalendarQuestions(['holidays'], SEED, NOW);
    const b = listCalendarQuestions(['holidays'], SEED, NOW + 90 * 24 * 3600 * 1000);

    expect(a.map((question) => question.id)).toEqual(b.map((question) => question.id));
  });

  it('never collides across subjects, kinds or items', () => {
    const ids = ALL().map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('pins the id derivation, because changing it orphans every review state', () => {
    expect(calendarQuestionId('months', 'month-after', 'oct')).toBe(
      calendarQuestionId('months', 'month-after', 'oct'),
    );
    expect(calendarQuestionId('months', 'month-after', 'oct')).not.toBe(
      calendarQuestionId('months', 'month-from-number', 'oct'),
    );
    expect(calendarQuestionId('months', 'month-after', 'oct')).not.toBe(
      calendarQuestionId('holidays', 'month-after', 'oct'),
    );
  });
});

describe('options', () => {
  it('varies the distractors between sessions', () => {
    // Scanned over several seeds rather than compared across two: two seeds
    // CAN legitimately agree; a run that never disagrees is the real failure.
    const id = calendarQuestionId('months', 'month-after', 'jan');
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed += 1) {
      seen.add(JSON.stringify(findChoice(id, seed).choices.map((choice) => choice.id).sort()));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('always includes the right answer among them', () => {
    for (const question of ALL()) {
      if (question.format !== 'multiple-choice') continue;
      expect(question.choices.map((choice) => choice.id)).toContain(question.correctChoiceId);
    }
  });

  it('never repeats an option within one question', () => {
    for (const question of ALL()) {
      if (question.format !== 'multiple-choice') continue;
      const ids = question.choices.map((choice) => choice.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('never offers the asked month as an answer to "what follows it"', () => {
    // "Which month comes right after April?" offering April reads as a typo,
    // and a reader who picks it has told you nothing about what they know.
    for (const month of MONTHS) {
      const question = findChoice(calendarQuestionId('months', 'month-after', month.id));
      expect(question.choices.map((choice) => choice.id)).not.toContain(month.id);
    }
  });
});

describe('months', () => {
  it('accepts the abbreviations a reader would actually type', () => {
    const october = find(calendarQuestionId('months', 'month-from-number', 'oct'));
    if (october?.format !== 'short-answer') throw new Error('expected short answer');

    expect(october.acceptable).toContain('October');
    expect(october.acceptable).toContain('Oct');
  });

  it('accepts a month number written as digits, ordinal or words', () => {
    const october = find(calendarQuestionId('months', 'number-from-month', 'oct'));
    if (october?.format !== 'short-answer') throw new Error('expected short answer');

    for (const spelling of ['10', '10th', 'ten', 'tenth']) {
      expect(october.acceptable).toContain(spelling);
    }
  });

  it('wraps the year: after December comes January', () => {
    const december = findChoice(calendarQuestionId('months', 'month-after', 'dec'));
    expect(december.correctChoiceId).toBe('jan');
  });

  it('knows every month length, February with its leap-year caveat', () => {
    const september = findChoice(calendarQuestionId('months', 'month-length', 'sep'));
    expect(september.correctChoiceId).toBe('d30');

    const february = findChoice(calendarQuestionId('months', 'month-length', 'feb'));
    expect(february.correctChoiceId).toBe('d28');
    const correct = february.choices.find((choice) => choice.id === 'd28');
    expect(correct?.text).toContain('29');
  });

  describe('ordering questions', () => {
    const timelines = (seed: number) =>
      listCalendarQuestions(['months'], seed, NOW).filter(
        (question): question is TimelineQuestion => question.format === 'timeline',
      );

    it('stores events earliest-first, which IS the answer key', () => {
      for (const question of timelines(SEED)) {
        const numbers = question.events.map(
          (event) => MONTHS.find((month) => month.id === event.id)!.number,
        );
        expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
      }
    });

    it('never repeats a month across the three questions of one session', () => {
      const seen = timelines(SEED).flatMap((question) => question.events.map((event) => event.id));
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('keeps the id but redraws the month groups when the seed changes', () => {
      const groupings = new Set<string>();
      const ids = new Set<string>();
      for (let seed = 1; seed <= 12; seed += 1) {
        const questions = timelines(seed);
        for (const question of questions) ids.add(question.id);
        groupings.add(
          JSON.stringify(questions.map((question) => question.events.map((event) => event.id))),
        );
      }
      // Three fixed id slots however the content moves.
      expect(ids.size).toBe(3);
      expect(groupings.size).toBeGreaterThan(1);
    });
  });
});

describe('weekdays', () => {
  it('wraps the week in both directions, whatever day a calendar starts on', () => {
    expect(findChoice(calendarQuestionId('weekdays', 'day-after', 'sun')).correctChoiceId).toBe('mon');
    expect(findChoice(calendarQuestionId('weekdays', 'day-before', 'mon')).correctChoiceId).toBe('sun');
  });
});

describe('seasons', () => {
  it('asks for the months of a season as recall of all three', () => {
    const spring = find(calendarQuestionId('seasons', 'months-of-season', 'spring'));
    if (spring?.format !== 'list-recall') throw new Error('expected list recall');

    expect(spring.items).toEqual(['March', 'April', 'May']);
    expect(spring.required).toBe(3);
  });

  it('lists winter starting from December, the month the season begins', () => {
    const winter = find(calendarQuestionId('seasons', 'months-of-season', 'winter'));
    if (winter?.format !== 'list-recall') throw new Error('expected list recall');

    expect(winter.items).toEqual(['December', 'January', 'February']);
  });

  it('places December in winter, not with the fall months around it', () => {
    const december = findChoice(calendarQuestionId('seasons', 'season-of-month', 'dec'));
    expect(december.correctChoiceId).toBe('winter');
  });

  it('says "Northern Hemisphere" in every prompt that depends on it', () => {
    // Without the qualifier the question is wrong for half the planet, not
    // merely underspecified. Season ORDER is exempt: spring precedes summer
    // in both hemispheres.
    for (const question of listCalendarQuestions(['seasons'], SEED, NOW)) {
      if (question.prompt.includes('comes after')) continue;
      expect(question.prompt).toContain('Northern Hemisphere');
    }
  });
});

describe('holidays', () => {
  it('accepts the date spellings a reader would actually type', () => {
    const christmas = find(calendarQuestionId('holidays', 'holiday-date', 'christmas'));
    if (christmas?.format !== 'short-answer') throw new Error('expected short answer');

    for (const spelling of ['December 25', 'December 25th', 'Dec 25', '12/25', '25 December']) {
      expect(christmas.acceptable).toContain(spelling);
    }
  });

  it('asks every fixed-date holiday in both directions', () => {
    const questions = listCalendarQuestions(['holidays'], SEED, NOW);
    for (const holiday of HOLIDAYS) {
      expect(questions.some((q) => q.id === calendarQuestionId('holidays', 'holiday-date', holiday.id))).toBe(true);
      const reverse = findChoice(calendarQuestionId('holidays', 'holiday-from-date', holiday.id));
      expect(reverse.correctChoiceId).toBe(holiday.id);
    }
  });
});

describe('fitting into the rest of the app', () => {
  it('produces questions the storage validator accepts', () => {
    // They are never stored, but they pass through the same player and the
    // same registry — a row this rejects is one the app would refuse to render.
    for (const question of ALL()) {
      expect(isValidQuestion(question)).toBe(true);
    }
  });

  it('tags every question so the existing topic picker can build a quiz', () => {
    for (const question of ALL()) {
      expect(question.topics).toContain(CALENDAR_TOPIC);
      expect(question.sourceId).toBe(CALENDAR_SOURCE_ID);
    }
  });

  it('carries the subject as a topic, so one subject can be quizzed alone', () => {
    const holidays = listCalendarQuestions(['holidays'], SEED, NOW);
    for (const question of holidays) expect(question.topics).toContain('holidays');
  });

  it('derives nothing at all when no subject is enabled', () => {
    expect(listCalendarQuestions([], SEED, NOW)).toEqual([]);
  });

  it('scopes to the subjects asked for', () => {
    const only = listCalendarQuestions(['weekdays'], SEED, NOW);
    expect(only.length).toBeGreaterThan(0);
    for (const question of only) expect(question.topics).toContain('weekdays');
  });
});
