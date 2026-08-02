import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { hashString, seededShuffle } from '../../lib/random';
import { ChoiceRow, type ChoiceState } from '../../ui/components/ChoiceRow';
import { TextField } from '../../ui/components/TextField';
import { colors, spacing, type } from '../../ui/theme';
import { isGraded, type Grade } from '../types';
import type { AnswerView, AnswerViewProps } from './contract';
import { parseTemplate } from './fillBlank';
import type { QuestionFormat } from '../types';
import type { QuestionOf } from './contract';

/**
 * Answer renderers, one per format.
 *
 * Separate from the logic modules so grading stays testable without React, and
 * so this file can import UI primitives without dragging them into the pure
 * layer.
 */

/** Shared state machine for a selectable option. */
function choiceState(input: {
  isSelected: boolean;
  isCorrect: boolean;
  grade: Grade | null;
}): ChoiceState {
  const { isSelected, isCorrect, grade } = input;
  if (!isGraded(grade)) return isSelected ? 'selected' : 'idle';

  // After reveal: mark the right answer green even when the user missed it —
  // showing you were wrong without showing what was right teaches nothing.
  if (isCorrect) return 'correct';
  if (isSelected) return 'incorrect';
  return 'muted';
}

function MultipleChoiceView({
  question,
  answer,
  onChange,
  grade,
  disabled,
  shuffleSeed = 0,
}: AnswerViewProps<QuestionOf<'multiple-choice'>>) {
  // Shuffled so the generator may always emit the correct answer first without
  // leaking it. Grading is by id, so order never affects correctness.
  const choices = useMemo(
    () => seededShuffle(question.choices, hashString(question.id) ^ shuffleSeed),
    [question.id, question.choices, shuffleSeed],
  );

  return (
    <View style={styles.stack}>
      {choices.map((choice) => {
        const isCorrect = choice.id === question.correctChoiceId;
        const isSelected = answer?.choiceId === choice.id;
        return (
          <ChoiceRow
            key={choice.id}
            label={choice.text}
            state={choiceState({ isSelected, isCorrect, grade })}
            annotation={isGraded(grade) && isCorrect && !isSelected ? 'Correct answer' : undefined}
            disabled={disabled || isGraded(grade)}
            onPress={() => onChange({ format: 'multiple-choice', choiceId: choice.id })}
          />
        );
      })}
    </View>
  );
}

function TrueFalseView({
  question,
  answer,
  onChange,
  grade,
  disabled,
}: AnswerViewProps<QuestionOf<'true-false'>>) {
  // Zero bespoke styling — proof that ChoiceRow's props are right.
  return (
    <View style={styles.stack}>
      {[true, false].map((value) => (
        <ChoiceRow
          key={String(value)}
          label={value ? 'True' : 'False'}
          state={choiceState({
            isSelected: answer?.value === value,
            isCorrect: question.correct === value,
            grade,
          })}
          annotation={
            isGraded(grade) && question.correct === value && answer?.value !== value
              ? 'Correct answer'
              : undefined
          }
          disabled={disabled || isGraded(grade)}
          onPress={() => onChange({ format: 'true-false', value })}
        />
      ))}
    </View>
  );
}

/** Shared by the two self-graded formats. */
function WrittenAnswer({
  value,
  onChangeText,
  grade,
  disabled,
  modelAnswer,
  rubric,
}: {
  value: string;
  onChangeText: (text: string) => void;
  grade: Grade | null;
  disabled?: boolean;
  modelAnswer: string;
  rubric?: string[];
}) {
  const revealed = grade !== null;

  return (
    <View style={styles.stack}>
      <TextField
        placeholder="Type your answer…"
        value={value}
        onChangeText={onChangeText}
        multiline
        editable={!disabled && !revealed}
        autoCapitalize="sentences"
        autoCorrect
      />

      {revealed ? (
        <View style={styles.modelAnswer}>
          <Text style={styles.modelLabel}>Model answer</Text>
          <Text style={styles.modelText}>{modelAnswer}</Text>
          {rubric?.length ? (
            <View style={styles.rubric}>
              {rubric.map((point) => (
                <Text key={point} style={styles.rubricItem}>
                  {'•'} {point}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ShortAnswerView({
  question,
  answer,
  onChange,
  grade,
  disabled,
}: AnswerViewProps<QuestionOf<'short-answer'>>) {
  return (
    <WrittenAnswer
      value={answer?.text ?? ''}
      onChangeText={(text) => onChange({ format: 'short-answer', text, selfGrade: answer?.selfGrade })}
      grade={grade}
      disabled={disabled}
      modelAnswer={question.modelAnswer}
      rubric={question.rubric}
    />
  );
}

function ListRecallView({
  question,
  answer,
  onChange,
  grade,
  disabled,
}: AnswerViewProps<QuestionOf<'list-recall'>>) {
  const entries = answer?.entries ?? [];
  const revealed = isGraded(grade);
  const parts = isGraded(grade) ? grade.parts : undefined;

  const setEntry = (index: number, text: string) => {
    // Padded to full length so entry 3 can be filled before entry 2 without the
    // array going sparse.
    const next = Array.from({ length: question.required }, (_, i) => entries[i] ?? '');
    next[index] = text;
    onChange({ format: 'list-recall', entries: next });
  };

  if (!revealed) {
    return (
      <View style={styles.stack}>
        {Array.from({ length: question.required }, (_, index) => (
          <TextField
            key={index}
            size="compact"
            placeholder={`${index + 1}.`}
            value={entries[index] ?? ''}
            editable={!disabled}
            onChangeText={(text) => setEntry(index, text)}
            autoCapitalize="sentences"
          />
        ))}
      </View>
    );
  }

  /*
    After reveal the whole list is shown, not just what was asked for. Someone
    who named three of five wants to see the two they didn't — that's the part
    of the note they haven't learned yet.

    `parts` is absent on the read-only question-detail screen, where there is no
    attempt to mark up; the list then renders plainly.
  */
  return (
    <View style={styles.stack}>
      {question.items.map((item, index) => {
        const found = parts?.[String(index)] === true;
        return (
          <ChoiceRow
            key={`${index}-${item}`}
            label={item}
            state={!parts ? 'idle' : found ? 'correct' : 'muted'}
            annotation={parts && !found ? 'Missed' : undefined}
            disabled
          />
        );
      })}
    </View>
  );
}

function FillBlankView({
  question,
  answer,
  onChange,
  grade,
  disabled,
}: AnswerViewProps<QuestionOf<'fill-blank'>>) {
  const runs = useMemo(() => parseTemplate(question.template), [question.template]);
  const values = answer?.values ?? {};
  const parts = isGraded(grade) ? grade.parts : undefined;

  return (
    <View style={styles.stack}>
      {/*
        A TextInput nested inside a Text is unreliable in React Native, so the
        template is split into runs and laid out as a wrapping row instead.
      */}
      <View style={styles.blankRow}>
        {runs.map((run, index) => {
          if (run.kind === 'text') {
            return (
              <Text key={index} style={styles.templateText}>
                {run.text}
              </Text>
            );
          }

          const blank = question.blanks.find((candidate) => candidate.id === run.blankId);
          const isCorrect = parts?.[run.blankId];

          return (
            <View key={index} style={styles.blankWrap}>
              <TextField
                size="compact"
                value={values[run.blankId] ?? ''}
                editable={!disabled && !isGraded(grade)}
                placeholder="…"
                onChangeText={(text) =>
                  onChange({ format: 'fill-blank', values: { ...values, [run.blankId]: text } })
                }
              />
              {isCorrect === false && blank ? (
                <Text style={styles.blankAnswer}>{blank.accepted[0]}</Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * View registry. Mapped over QuestionFormat exactly like the logic registry, so
 * adding a format without a renderer is a compile error too.
 */
export const QUESTION_TYPE_VIEWS: { [K in QuestionFormat]: AnswerView<QuestionOf<K>> } = {
  'multiple-choice': MultipleChoiceView,
  'true-false': TrueFalseView,
  'short-answer': ShortAnswerView,
  'list-recall': ListRecallView,
  'fill-blank': FillBlankView,
};

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  modelAnswer: {
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modelLabel: { ...type.smallStrong, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  modelText: { ...type.body, color: colors.text, lineHeight: 22 },
  rubric: { gap: spacing.xs },
  rubricItem: { ...type.small, color: colors.textMuted },
  blankRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  templateText: { ...type.body, color: colors.text, lineHeight: 34 },
  blankWrap: { minWidth: 110 },
  blankAnswer: { ...type.small, color: colors.success, marginTop: 2 },
});
