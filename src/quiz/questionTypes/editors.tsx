import { Text, View } from 'react-native';

import { Button } from '../../ui/components/Button';
import { SectionHeader } from '../../ui/components/SectionHeader';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { TextField } from '../../ui/components/TextField';
import { colors, spacing, themedSheet, type } from '../../ui/theme';
import type { Question, QuestionFormat, TimelineEvent } from '../types';
import type { QuestionOf } from './contract';
import { MAX_EVENTS, MIN_EVENTS } from './timeline';

/**
 * Hand-editing the answer half of a question, one editor per format.
 *
 * Registered exactly like `views.tsx`: a mapped type over `QuestionFormat`, so
 * adding a format without adding an editor is a compile error rather than a
 * screen that silently offers no way to fix its answers.
 *
 * The shared half — prompt, explanation, difficulty — is NOT here. Every format
 * has those and the edit screen draws them once; duplicating them into five
 * editors would be five places to forget one.
 *
 * These edit the STORED shape directly (`correctChoiceId`, a spliced `{{a}}`
 * template) rather than the model's row shape. That is the right call for a
 * hand edit — what you see is what is saved — and it is why the LLM path in
 * `reviseQuestion.ts` has to translate in both directions instead.
 */

export type QuestionEditorProps<Q extends Question = Question> = {
  question: Q;
  onChange: (next: Q) => void;
};

export type QuestionEditor<Q extends Question = Question> = (
  props: QuestionEditorProps<Q>,
) => React.ReactElement;

/**
 * A list of short strings with add and remove.
 *
 * Rows are keyed by INDEX on purpose. The values are user-editable and freely
 * duplicated — two identical choices are legal while you are mid-edit — so
 * anything derived from the text would collide and make React reuse the wrong
 * input mid-keystroke.
 */
function StringList({
  label,
  values,
  onChange,
  min,
  addLabel,
  placeholder,
}: {
  label: string;
  values: readonly string[];
  onChange: (next: string[]) => void;
  /** Below this, the remove buttons disappear — the format needs them. */
  min: number;
  addLabel: string;
  placeholder?: string;
}) {
  return (
    <>
      <SectionHeader title={label} />
      {values.map((value, index) => (
        <View key={index} style={styles.row}>
          <View style={styles.grow}>
            <TextField
              value={value}
              onChangeText={(text) => onChange(values.map((v, i) => (i === index ? text : v)))}
              placeholder={placeholder}
              autoCapitalize="sentences"
              autoCorrect
              multiline
            />
          </View>
          {values.length > min ? (
            <Button
              title="Remove"
              variant="plain"
              onPress={() => onChange(values.filter((_, i) => i !== index))}
            />
          ) : null}
        </View>
      ))}
      <Button title={addLabel} variant="secondary" onPress={() => onChange([...values, ''])} />
    </>
  );
}

function MultipleChoiceEditor({
  question,
  onChange,
}: QuestionEditorProps<QuestionOf<'multiple-choice'>>) {
  return (
    <>
      <SectionHeader title="Choices" />
      {question.choices.map((choice, index) => (
        <View key={choice.id} style={styles.row}>
          <View style={styles.grow}>
            <TextField
              label={choice.id === question.correctChoiceId ? 'Correct answer' : undefined}
              value={choice.text}
              onChangeText={(text) =>
                onChange({
                  ...question,
                  choices: question.choices.map((c, i) => (i === index ? { ...c, text } : c)),
                })
              }
              autoCapitalize="sentences"
              autoCorrect
              multiline
            />
          </View>
          <View style={styles.choiceActions}>
            {/* Marking the right answer is a tap, not a field: grading is by
                id, and asking someone to type an id is asking for a typo that
                makes every answer wrong. */}
            {choice.id === question.correctChoiceId ? null : (
              <Button
                title="Correct"
                variant="secondary"
                onPress={() => onChange({ ...question, correctChoiceId: choice.id })}
              />
            )}
            {question.choices.length > 2 && choice.id !== question.correctChoiceId ? (
              <Button
                title="Remove"
                variant="plain"
                onPress={() =>
                  onChange({ ...question, choices: question.choices.filter((_, i) => i !== index) })
                }
              />
            ) : null}
          </View>
        </View>
      ))}
      <Button
        title="Add a choice"
        variant="secondary"
        onPress={() =>
          onChange({
            ...question,
            // Ids only have to be unique within the question, and reusing a
            // removed one would silently re-point `correctChoiceId`.
            choices: [
              ...question.choices,
              { id: `c${Date.now().toString(36)}`, text: '' },
            ],
          })
        }
      />
    </>
  );
}

function TrueFalseEditor({ question, onChange }: QuestionEditorProps<QuestionOf<'true-false'>>) {
  return (
    <>
      <SectionHeader title="The claim is" />
      <SegmentedControl
        options={[
          { value: 'true', label: 'True' },
          { value: 'false', label: 'False' },
        ]}
        value={question.correct ? 'true' : 'false'}
        onChange={(value) => onChange({ ...question, correct: value === 'true' })}
      />
    </>
  );
}

function ShortAnswerEditor({ question, onChange }: QuestionEditorProps<QuestionOf<'short-answer'>>) {
  return (
    <>
      <SectionHeader title="Model answer" />
      <TextField
        value={question.modelAnswer}
        onChangeText={(modelAnswer) => onChange({ ...question, modelAnswer })}
        placeholder="The answer worth remembering, in a sentence or two"
        autoCapitalize="sentences"
        autoCorrect
        multiline
      />
      <StringList
        label="Also accept"
        values={question.acceptable ?? []}
        onChange={(acceptable) =>
          // Dropped entirely when empty rather than stored as `[]`, so an
          // edited question matches the shape generation produces.
          onChange(
            acceptable.some((entry) => entry.trim())
              ? { ...question, acceptable }
              : ({ ...question, acceptable: undefined } as QuestionOf<'short-answer'>),
          )
        }
        min={0}
        addLabel="Add an accepted answer"
        placeholder="A shorter answer that should still count"
      />
      <Text style={styles.hint}>
        Written answers are marked by the model against this, so a fuller answer grades better
        than a bare keyword.
      </Text>
    </>
  );
}

function ListRecallEditor({ question, onChange }: QuestionEditorProps<QuestionOf<'list-recall'>>) {
  return (
    <>
      <StringList
        label="Items"
        values={question.items}
        onChange={(items) =>
          onChange({
            ...question,
            items,
            // Kept in range as items come and go — "name 5 of 3" is
            // unanswerable, and the generator computes it the same way.
            required: Math.max(1, Math.min(question.required, items.length)),
          })
        }
        min={2}
        addLabel="Add an item"
      />
      <SectionHeader title="How many are required" />
      <SegmentedControl
        options={question.items.map((_, index) => ({
          value: String(index + 1),
          label: String(index + 1),
        }))}
        value={String(question.required)}
        onChange={(value) => onChange({ ...question, required: Number(value) })}
      />
    </>
  );
}

/** The `{{id}}` placeholders a fill-blank template contains. */
const PLACEHOLDER = /\{\{([^}]+)\}\}/g;

function ListBlanks({ question, onChange }: QuestionEditorProps<QuestionOf<'fill-blank'>>) {
  return (
    <>
      {question.blanks.map((blank, index) => (
        <View key={blank.id}>
          <StringList
            label={`Accepted for {{${blank.id}}}`}
            values={blank.accepted}
            onChange={(accepted) =>
              onChange({
                ...question,
                blanks: question.blanks.map((b, i) => (i === index ? { ...b, accepted } : b)),
              })
            }
            min={1}
            addLabel="Add another spelling"
          />
        </View>
      ))}
    </>
  );
}

function FillBlankEditor({ question, onChange }: QuestionEditorProps<QuestionOf<'fill-blank'>>) {
  const placeholders = Array.from(question.template.matchAll(PLACEHOLDER)).map((match) => match[1]);
  const orphaned = question.blanks.filter((blank) => !placeholders.includes(blank.id));

  return (
    <>
      <SectionHeader title="Sentence" />
      <TextField
        value={question.template}
        onChangeText={(template) => onChange({ ...question, template })}
        autoCapitalize="sentences"
        autoCorrect
        multiline
      />
      <Text style={styles.hint}>
        {`Each ${'{{a}}'} becomes a gap to fill. Keep the ids matching the answers below.`}
      </Text>

      <ListBlanks question={question} onChange={onChange} />

      {/*
        A mismatch is shown rather than prevented. Editing the sentence and the
        answers are two steps, and blocking Save between them would make the
        field impossible to use — but saving a template whose placeholder has no
        answer draws an input nothing can ever grade.
      */}
      {orphaned.length > 0 ? (
        <Text style={styles.warning}>
          {orphaned.map((blank) => `{{${blank.id}}}`).join(', ')} is no longer in the sentence, so
          it will never be asked.
        </Text>
      ) : null}
      {placeholders.filter((id) => !question.blanks.some((blank) => blank.id === id)).length > 0 ? (
        <Text style={styles.warning}>
          The sentence has a gap with no accepted answer, which cannot be graded.
        </Text>
      ) : null}
    </>
  );
}

/**
 * Anything in an event label that would let the order be read off the screen —
 * a year, or a word that names a position in the sequence.
 */
const ORDER_GIVEAWAY = /\b\d{3,4}\b|\b(first|second|third|then|later|finally|next|lastly)\b/i;

function TimelineEditor({ question, onChange }: QuestionEditorProps<QuestionOf<'timeline'>>) {
  const events = question.events;
  const setEvents = (next: TimelineEvent[]) => onChange({ ...question, events: next });
  const patch = (index: number, changes: Partial<TimelineEvent>) =>
    setEvents(events.map((event, i) => (i === index ? { ...event, ...changes } : event)));

  const swap = (index: number, by: -1 | 1) => {
    const to = index + by;
    if (to < 0 || to >= events.length) return;
    const next = events.slice();
    [next[index], next[to]] = [next[to], next[index]];
    setEvents(next);
  };

  const giveaways = events.flatMap((event, index) =>
    ORDER_GIVEAWAY.test(event.label) ? [`Event ${index + 1}`] : [],
  );

  return (
    <>
      <SectionHeader title="Events, earliest first" />
      {/*
        The only editor with reorder controls, because it is the only format
        where the order on screen IS the answer — there is no separate
        correct-order field to keep in step with it. Without these, fixing two
        events that are the wrong way round means retyping both rows.
      */}
      {events.map((event, index) => (
        <View key={event.id} style={styles.row}>
          <View style={styles.grow}>
            <TextField
              label={`${index + 1}.`}
              value={event.label}
              onChangeText={(label) => patch(index, { label })}
              placeholder="What happened"
              autoCapitalize="sentences"
              autoCorrect
              multiline
            />
            <TextField
              size="compact"
              value={event.date}
              onChangeText={(date) => patch(index, { date })}
              placeholder="When — shown only after answering"
            />
          </View>
          <View style={styles.choiceActions}>
            {index > 0 ? (
              <Button title="Up" variant="secondary" onPress={() => swap(index, -1)} />
            ) : null}
            {index < events.length - 1 ? (
              <Button title="Down" variant="secondary" onPress={() => swap(index, 1)} />
            ) : null}
            {events.length > MIN_EVENTS ? (
              <Button
                title="Remove"
                variant="plain"
                onPress={() => setEvents(events.filter((_, i) => i !== index))}
              />
            ) : null}
          </View>
        </View>
      ))}

      {events.length < MAX_EVENTS ? (
        <Button
          title="Add an event"
          variant="secondary"
          onPress={() =>
            setEvents([...events, { id: `e${Date.now().toString(36)}`, label: '', date: '' }])
          }
        />
      ) : null}

      <Text style={styles.hint}>
        Dates stay hidden until the answer is checked, so keep them out of the event text.
      </Text>

      {/*
        Shown rather than prevented — the same call `FillBlankEditor` makes. A
        label with a year in it still grades correctly; it is just a much easier
        question than it looks.
      */}
      {giveaways.length > 0 ? (
        <Text style={styles.warning}>
          {giveaways.join(', ')} — the date or the position is in the event text, so the order
          can be read straight off the screen.
        </Text>
      ) : null}
    </>
  );
}

/**
 * Map questions have nothing hand-editable on them.
 *
 * Their answer half is a region id, and the set of legal region ids is a
 * generated table — so the only honest editor would be a picker over the same
 * fifty regions the question was derived from, which cannot produce a question
 * that did not already exist. They are also never STORED: the bank holds no
 * geography rows to arrive here from (see `src/quiz/geography/types.ts`), so
 * this is reachable only if one is somehow saved.
 *
 * Says so plainly rather than rendering nothing, which reads as a broken screen.
 */
function MapLocateEditor({ question }: QuestionEditorProps<QuestionOf<'map-locate'>>) {
  return (
    <Text style={styles.hint}>
      Map questions are generated from the {question.mapId.replace(/-/g, ' ')} map and have no
      editable answer.
    </Text>
  );
}

const QUESTION_EDITORS: { [K in QuestionFormat]: QuestionEditor<QuestionOf<K>> } = {
  'multiple-choice': MultipleChoiceEditor,
  'true-false': TrueFalseEditor,
  'short-answer': ShortAnswerEditor,
  'list-recall': ListRecallEditor,
  'fill-blank': FillBlankEditor,
  timeline: TimelineEditor,
  'map-locate': MapLocateEditor,
};

export function getQuestionEditor(format: QuestionFormat): QuestionEditor {
  return QUESTION_EDITORS[format] as QuestionEditor;
}

const styles = themedSheet(() => ({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
  choiceActions: { gap: spacing.xs },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  warning: { ...type.small, color: colors.warning, lineHeight: 18 },
}));
