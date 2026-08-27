import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { hashString, seededShuffle } from '../../lib/random';
import { ChoiceRow, type ChoiceState } from '../../ui/components/ChoiceRow';
import { DraggableList } from '../../ui/components/DraggableList';
import { RegionMap } from '../../ui/components/RegionMap';
import { TextField } from '../../ui/components/TextField';
import { colors, radius, spacing, themedSheet, type } from '../../ui/theme';
import { getRegion } from '../geography/maps';
import { isGraded, type AnswerFor, type Grade } from '../types';
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

/*
  The timeline is a real axis, not a numbered list.

  The dates are the fixed part: they sit on a spine down the left and do not
  move. The events are the loose part, dragged up and down until each one is
  beside the date it belongs to. That makes the question "when did this happen"
  rather than merely "what order were these in" — you have to know that Shiloh
  was April 1862, not just that it came after Bull Run.

  It also means two events may not share the same date TEXT: identical dates
  would draw two identical slots, and one of them would be unwinnable however
  the reader answered. `timelineLogic.isValid` rejects that.
*/

/**
 * Floor for the row height, and the height used for the frame before the cards
 * have been measured. Two wrapped lines of a label plus its padding.
 */
const TIMELINE_MIN_ROW_HEIGHT = 64;

/**
 * How far a label may wrap before it ellipsizes.
 *
 * This is what bounds the row height: every row is as tall as the tallest card,
 * so without a cap one rambling event would inflate all six.
 */
const TIMELINE_MAX_LINES = 3;

/**
 * The gap is a constant because `DraggableList` divides by row height plus gap
 * to work out which slot a finger is over, and because the rail has to step in
 * exactly the same increments or it drifts out of line with the cards.
 */
const TIMELINE_ROW_GAP = spacing.sm;

/**
 * The height of the tallest card, which every row is then sized to.
 *
 * Rows still have to share one KNOWN height — the drag maths and the rail both
 * step in whole rows — but a constant cannot know what that height is. A label
 * wraps to one line or three depending on how long it is and how wide the
 * column ends up, and the reader's text-size setting scales every one of those
 * lines. A constant that guessed two lines simply clipped anything longer.
 *
 * So the cards are laid out once, invisibly, at their natural height, and the
 * tallest one sets the row.
 */
function useTimelineRowHeight(labels: string[]) {
  /*
    Keyed by the label rather than by row index, so nothing has to be
    invalidated when the question changes: a height only ever describes the text
    it was measured from, and heights for labels no longer on screen simply stop
    being consulted.
  */
  const measured = useRef(new Map<string, number>());
  const [, remeasured] = useReducer((count: number) => count + 1, 0);

  const onCardLayout = useCallback((label: string, height: number) => {
    const previous = measured.current.get(label);
    // Sub-pixel differences are noise from the text engine, not a taller card,
    // and reacting to them would re-render on every layout pass.
    if (previous !== undefined && Math.abs(previous - height) < 0.5) return;
    measured.current.set(label, height);
    remeasured();
  }, []);

  // An unmeasured label counts as nothing, so the first frame sits at the floor
  // and grows once the measuring pass has been through layout.
  const rowHeight = labels.reduce(
    (tallest, label) => Math.max(tallest, measured.current.get(label) ?? 0),
    TIMELINE_MIN_ROW_HEIGHT,
  );

  return { rowHeight, onCardLayout };
}

/**
 * The measuring pass: the same cards, laid out at their natural height with
 * nothing to clip them, positioned out of the flow so they neither show nor
 * take up space. Rendered inside the card column so it is measured at exactly
 * the width the real cards get.
 */
function TimelineMeasure({
  labels,
  onCardLayout,
}: {
  labels: string[];
  onCardLayout: (label: string, height: number) => void;
}) {
  return (
    <View style={styles.measureLayer} pointerEvents="none" aria-hidden>
      {labels.map((label, index) => (
        <View
          key={`${index}-${label}`}
          onLayout={(event) => onCardLayout(label, event.nativeEvent.layout.height)}
        >
          <TimelineCard label={label} tone="idle" draggable={false} autoHeight />
        </View>
      ))}
    </View>
  );
}

/** Fits "September 1862" on two lines at `type.micro`. */
const TIMELINE_RAIL_WIDTH = 76;
const TIMELINE_DOT = 10;

/** The dates and the spine they hang on. Static — only the cards move. */
function TimelineRail({
  dates,
  filled,
  rowHeight,
}: {
  dates: string[];
  filled: boolean[];
  rowHeight: number;
}) {
  return (
    <View style={styles.rail}>
      {/*
        Inset by half a row top and bottom so the line runs between the first
        and last dots rather than overshooting into empty space.
      */}
      <View style={[styles.railLine, { top: rowHeight / 2, bottom: rowHeight / 2 }]} />
      {dates.map((date, index) => (
        <View
          key={`${index}-${date}`}
          style={[
            styles.railSlot,
            {
              height: rowHeight,
              marginBottom: index === dates.length - 1 ? 0 : TIMELINE_ROW_GAP,
            },
          ]}
        >
          <Text style={styles.railDate} numberOfLines={2}>
            {date}
          </Text>
          <View style={[styles.railDot, filled[index] && styles.railDotFilled]} />
        </View>
      ))}
    </View>
  );
}

type CardTone = 'idle' | 'correct' | 'wrong' | 'plain';

function TimelineCard({
  label,
  tone,
  draggable,
  /** Set only by the measuring pass, which needs the card's natural height. */
  autoHeight = false,
}: {
  label: string;
  tone: CardTone;
  draggable: boolean;
  autoHeight?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        autoHeight && styles.cardAuto,
        tone === 'correct' && styles.cardCorrect,
        tone === 'wrong' && styles.cardWrong,
      ]}
    >
      <Text
        style={[styles.cardLabel, tone === 'wrong' && styles.cardLabelWrong]}
        numberOfLines={TIMELINE_MAX_LINES}
      >
        {label}
      </Text>
      {/*
        A grip, not a radio button. The row is dragged, never selected, and the
        earlier `ChoiceRow` reuse also announced itself to screen readers as a
        radio option — which is simply untrue of a reorder list.

        The slot is a fixed width whether or not anything sits in it, so the
        label has the same room to wrap in every state — which is what lets one
        measuring pass stand in for all of them.
      */}
      <View style={styles.cardTrailing}>
        {draggable ? (
          <Ionicons name="reorder-two-outline" size={20} color={colors.textFaint} />
        ) : tone === 'correct' ? (
          <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        ) : tone === 'wrong' ? (
          <Ionicons name="close-circle" size={18} color={colors.danger} />
        ) : null}
      </View>
    </View>
  );
}

function TimelineView({
  question,
  answer,
  onChange,
  grade,
  disabled,
  shuffleSeed = 0,
}: AnswerViewProps<QuestionOf<'timeline'>>) {
  const parts = isGraded(grade) ? grade.parts : undefined;

  /*
    Shuffled for the same reason multiple-choice shuffles its options: the
    events are STORED in their correct order, so the scramble is the only thing
    standing between the reader and the answer. Seeded from the question id and
    the session seed, so it survives a re-render and a resumed session.
  */
  const scrambled = useMemo(
    () => seededShuffle(question.events, hashString(question.id) ^ shuffleSeed),
    [question.id, question.events, shuffleSeed],
  );

  const order = answer?.order ?? [];

  /*
    The starting order is published rather than held locally.

    The Check button is gated on the DRAFT answer, so a view that kept its
    scramble to itself would leave Check disabled for good. Publishing is also
    the honest thing here: with drag-to-reorder the reader starts holding a
    complete answer, and submitting it untouched means "I think this is right".
  */
  useEffect(() => {
    if (parts !== undefined || disabled) return;
    if (order.length === question.events.length) return;
    onChange({ format: 'timeline', order: scrambled.map((event) => event.id) });
  }, [parts, disabled, order.length, question.events.length, scrambled, onChange]);

  /*
    Gated on `parts`, NOT on `answer`.

    Two paths arrive here having revealed the answer without one: the read-only
    question screen, and "I don't know" — and the second leaves the reader's
    half-finished draft in `answer`, so marking it up would pass a verdict on
    something never submitted. (`parts === undefined` rather than `!parts`: an
    empty object is truthy.)
  */
  // The rail is the same in every state: the dates are the fixed axis.
  const dates = question.events.map((event) => event.date);

  /*
    Measured from the stored order rather than the scramble: it is the same set
    of labels either way, so both states settle on the same row height and the
    rows do not resize when the answer is revealed.
  */
  const labels = question.events.map((event) => event.label);
  const { rowHeight, onCardLayout } = useTimelineRowHeight(labels);

  if (isGraded(grade)) {
    /*
      The TRUE pairing, so the reader leaves knowing which event belongs to
      which date — that is the whole point of answering.

      Marked from `parts`, never from `answer`. Two paths arrive here with the
      answer revealed and no attempt behind it: the read-only question screen,
      and "I don't know" — and the second leaves a half-dragged order sitting in
      `answer`, so marking that up would pass a verdict on something never
      submitted.
    */
    return (
      <View style={styles.timelineBody}>
        <TimelineRail
          dates={dates}
          filled={question.events.map(() => true)}
          rowHeight={rowHeight}
        />
        <View style={styles.timelineCards}>
          <TimelineMeasure labels={labels} onCardLayout={onCardLayout} />
          {question.events.map((event, index) => (
            <View
              key={event.id}
              style={[
                styles.timelineSlot,
                {
                  height: rowHeight,
                  marginBottom: index === question.events.length - 1 ? 0 : TIMELINE_ROW_GAP,
                },
              ]}
            >
              <TimelineCard
                label={event.label}
                tone={
                  parts === undefined ? 'plain' : parts[event.id] === true ? 'correct' : 'wrong'
                }
                draggable={false}
              />
            </View>
          ))}
        </View>
      </View>
    );
  }

  const byId = new Map(question.events.map((event) => [event.id, event]));
  const arranged = order.flatMap((id) => {
    const event = byId.get(id);
    return event ? [event] : [];
  });
  // Falls back to the scramble for the frame before the mount effect lands.
  const rows = arranged.length === question.events.length ? arranged : scrambled;

  return (
    <View style={styles.stack}>
      <Text style={styles.timelineHint}>
        Hold an event to pick it up, then drag it to its date.
      </Text>
      <View style={styles.timelineBody}>
        <TimelineRail dates={dates} filled={dates.map(() => false)} rowHeight={rowHeight} />
        {/*
          The column is a wrapper rather than the list's own style, so the
          measuring pass can sit inside it and be laid out at the same width
          the cards get.
        */}
        <View style={styles.timelineCards}>
          <TimelineMeasure labels={labels} onCardLayout={onCardLayout} />
          <DraggableList
            items={rows}
            keyOf={(event) => event.id}
            rowHeight={rowHeight}
            gap={TIMELINE_ROW_GAP}
            disabled={disabled}
            onReorder={(ids) => onChange({ format: 'timeline', order: ids })}
            renderItem={(event) => (
              <TimelineCard label={event.label} tone="idle" draggable={!disabled} />
            )}
          />
        </View>
      </View>
    </View>
  );
}

function MapLocateView({
  question,
  answer,
  onChange,
  grade,
  disabled,
}: AnswerViewProps<QuestionOf<'map-locate'>>) {
  const revealed = isGraded(grade);

  return (
    <View style={styles.stack}>
      {!revealed ? (
        <Text style={styles.timelineHint}>
          Pinch to zoom, drag to move, double-tap to reset.
        </Text>
      ) : null}
      <RegionMap
        mapId={question.mapId}
        regionIds={question.regionIds}
        mode="interactive"
        selectedId={answer?.regionId}
        /*
          Passed only once graded. `RegionMap` treats a `correctId` as "the
          answer is out", so setting it early would colour the target green
          before the reader has picked anything.
        */
        correctId={revealed ? question.targetRegionId : undefined}
        onSelect={(regionId) => onChange({ format: 'map-locate', regionId })}
        disabled={disabled}
      />
      {revealed ? <MapLocateVerdict question={question} answer={answer} /> : null}
    </View>
  );
}

/**
 * Names what the colours on the map mean.
 *
 * The map alone cannot say "you tapped Kentucky" — it can only shade Kentucky
 * red, which the reader has to decode by finding it. On a fifty-region map that
 * is real work, and it is work at exactly the moment they want the answer.
 */
function MapLocateVerdict({
  question,
  answer,
}: {
  question: QuestionOf<'map-locate'>;
  answer: AnswerFor<QuestionOf<'map-locate'>> | null;
}) {
  const target = getRegion(question.mapId, question.targetRegionId);
  const picked = answer ? getRegion(question.mapId, answer.regionId) : undefined;
  const correct = !!picked && picked.id === question.targetRegionId;

  return (
    <View style={styles.modelAnswer}>
      <Text style={styles.modelLabel}>Answer</Text>
      <Text style={styles.modelText}>{target?.name ?? question.targetRegionId}</Text>
      {picked && !correct ? (
        <Text style={styles.rubricItem}>You tapped {picked.name}.</Text>
      ) : null}
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
  timeline: TimelineView,
  'map-locate': MapLocateView,
};

const styles = themedSheet(() => ({
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
  timelineHint: { ...type.small, color: colors.textFaint },
  timelineBody: { flexDirection: 'row', alignItems: 'flex-start' },
  timelineCards: { flex: 1 },
  timelineSlot: { justifyContent: 'center' },
  /*
    Out of the flow and invisible, but still laid out — `onLayout` only reports
    a height for something the layout engine actually measured, so this cannot
    be `display: none`.
  */
  measureLayer: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },

  rail: { width: TIMELINE_RAIL_WIDTH },
  /*
    One continuous line behind the dots rather than a segment between each pair.
    Segments have to be positioned against neighbours and leave hairline seams
    where they meet; a single line cannot.
  */
  railLine: {
    position: 'absolute',
    right: (TIMELINE_DOT - 2) / 2,
    width: 2,
    backgroundColor: colors.border,
  },
  railSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingRight: 0,
  },
  railDate: { ...type.micro, color: colors.textMuted, textAlign: 'right', flexShrink: 1 },
  railDot: {
    width: TIMELINE_DOT,
    height: TIMELINE_DOT,
    borderRadius: TIMELINE_DOT / 2,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    // Opaque, so the spine passes behind the dot rather than through it.
    backgroundColor: colors.background,
  },
  railDotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginLeft: spacing.md,
    height: '100%',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  // Measuring only: the card sizes to its label instead of filling a row whose
  // height is the very thing being worked out.
  cardAuto: { height: 'auto' },
  cardCorrect: { backgroundColor: colors.successSurface, borderColor: colors.success },
  cardWrong: { backgroundColor: colors.surface, borderColor: colors.danger },
  cardTrailing: { width: 20, alignItems: 'center' },
  cardLabel: { ...type.body, color: colors.text, flex: 1 },
  cardLabelWrong: { color: colors.textMuted },
}));
