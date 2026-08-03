import { useCallback, useMemo, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { resolveCredentialsOrNull } from '../../src/features/llm/credentials';
import { gradeShortAnswer } from '../../src/features/llm/gradeShortAnswer';
import { getAnswerView, getQuestionLogic } from '../../src/quiz/questionTypes';
import {
  advanceSession,
  answerSessionItem,
  abandonSession,
  completeSession,
  flagQuestion,
  flagSessionItem,
} from '../../src/quiz/store';
import { useQuestions, useSession } from '../../src/quiz/useQuiz';
import { isGraded, outcomeFromSelfGrade, type Answer, type FlagReason, type Grade, type Question, type SelfGrade } from '../../src/quiz/types';
import { answerFeedback, selectTick } from '../../src/ui/haptics';
import { Badge } from '../../src/ui/components/Badge';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { HeaderIconButton } from '../../src/ui/components/HeaderIconButton';
import { NoteExcerpt } from '../../src/ui/components/NoteExcerpt';
import { ProgressSegments, type SegmentState } from '../../src/ui/components/ProgressSegments';
import { colors, spacing, type } from '../../src/ui/theme';

const FLAG_REASONS: { reason: FlagReason; label: string }[] = [
  { reason: 'wrong', label: 'The answer is wrong' },
  { reason: 'unclear', label: "It's unclear" },
  { reason: 'duplicate', label: "I've seen this already" },
  { reason: 'not-useful', label: 'Not useful' },
];

export default function SessionPlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const sessionId = typeof params.id === 'string' ? params.id : undefined;

  const session = useSession(sessionId);
  const questions = useQuestions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  /** Draft answer for the current item, before Check is pressed. */
  const [draft, setDraft] = useState<Answer | null>(null);
  /** True while a written answer is being marked by the model. */
  const [checking, setChecking] = useState(false);

  const questionById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions],
  );

  const item = session?.items[session.currentIndex];
  const question: Question | undefined = item ? questionById.get(item.questionId) : undefined;
  const grade: Grade | null = item?.grade ?? null;

  const segments: SegmentState[] = useMemo(() => {
    if (!session) return [];
    return session.items.map((entry, index) => {
      if (entry.flagged) return 'flagged';
      if (entry.outcome) return entry.outcome;
      if (index === session.currentIndex) return 'current';
      return 'pending';
    });
  }, [session]);

  const finish = useCallback(() => {
    if (!session) return;
    completeSession(session.id);
    // replace, so Back from results doesn't re-enter the finished quiz.
    router.replace(`/session/results/${encodeURIComponent(session.id)}`);
  }, [session, router]);

  const commit = useCallback(
    (answer: Answer) => {
      if (!session || !question) return;
      const result = answerSessionItem(session.id, question.id, answer, question);
      if (result && isGraded(result)) {
        void answerFeedback(result.outcome);
        // Scroll so the explanation is visible without the user hunting for it.
        requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      }
    },
    [session, question],
  );

  /*
    A written answer is marked by the model before being committed.

    Everything else grades instantly and offline, so this is the one path that
    waits on a network call. It is bounded three ways: only for short answer,
    only when a provider is configured, and `gradeShortAnswer` resolves to null
    on any failure instead of throwing — so the worst case is the self-grade
    buttons that were there before, never a stuck quiz.
  */
  const check = useCallback(async () => {
    if (!session || !question || !draft) return;

    if (question.format !== 'short-answer' || draft.format !== 'short-answer') {
      commit(draft);
      return;
    }

    setChecking(true);
    try {
      const credentials = await resolveCredentialsOrNull();
      const verdict = credentials
        ? await gradeShortAnswer({
            question,
            text: draft.text,
            provider: credentials.provider,
            apiKey: credentials.apiKey,
            model: credentials.model,
          })
        : null;
      commit(verdict ? { ...draft, judged: verdict } : draft);
    } finally {
      setChecking(false);
    }
  }, [session, question, draft, commit]);

  const applySelfGrade = useCallback(
    (selfGrade: SelfGrade) => {
      if (!session || !question || !draft) return;
      // Re-answering with a self grade replaces whatever verdict was there,
      // which is what lets the user overrule the model.
      const graded: Answer = { ...(item?.answer ?? draft), selfGrade } as Answer;
      const result = answerSessionItem(session.id, question.id, graded, question);
      if (result && isGraded(result)) void answerFeedback(result.outcome);
      else void answerFeedback(outcomeFromSelfGrade(selfGrade));
    },
    [session, question, draft, item],
  );

  const next = useCallback(() => {
    if (!session) return;
    const isLast = session.currentIndex >= session.items.length - 1;
    if (isLast) {
      finish();
      return;
    }
    setDraft(null);
    advanceSession(session.id);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [session, finish]);

  const promptFlag = useCallback(() => {
    if (!session || !question) return;
    Alert.alert(
      'Report this question',
      "You won't see it again, and it won't affect your review schedule.",
      [
        ...FLAG_REASONS.map(({ reason, label }) => ({
          text: label,
          onPress: () => {
            flagQuestion(question.id, reason);
            flagSessionItem(session.id, question.id);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [session, question]);

  const confirmExit = useCallback(() => {
    if (!session) return;
    Alert.alert('Leave this quiz?', 'Your progress is saved — you can pick it up from Today.', [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Save & exit', onPress: () => router.back() },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          abandonSession(session.id);
          router.back();
        },
      },
    ]);
  }, [session, router]);

  if (!session) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Quiz' }} />
        <EmptyState
          icon="help-circle-outline"
          title="Session not found"
          body="It may have been completed or discarded."
          actionTitle="Back"
          onAction={() => router.replace('/')}
        />
      </>
    );
  }

  if (!question || !item) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: session.quizName }} />
        <EmptyState
          icon="checkmark-done-outline"
          title="Nothing left to answer"
          body="This session has no remaining questions."
          actionTitle="See results"
          onAction={finish}
        />
      </>
    );
  }

  const logic = getQuestionLogic(question.format);
  const AnswerView = getAnswerView(question.format);
  const isLast = session.currentIndex >= session.items.length - 1;
  const needsSelfGrade = grade?.status === 'needs-self-grade';
  const revealed = grade !== null;
  const judged =
    item?.answer?.format === 'short-answer' ? item.answer.judged : undefined;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top bar ---------------------------------------------------------- */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <HeaderIconButton name="close" accessibilityLabel="Leave quiz" onPress={confirmExit} />
        <View style={styles.progressWrap}>
          <ProgressSegments segments={segments} />
          <Text style={styles.progressLabel}>
            {session.currentIndex + 1} of {session.items.length}
          </Text>
        </View>
        <HeaderIconButton name="flag-outline" accessibilityLabel="Report question" onPress={promptFlag} />
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Meta chips are registry-driven, so a new format needs no edit here. */}
        <View style={styles.metaRow}>
          <Badge label={logic.label} />
          <Badge label={question.difficulty} tone="neutral" />
          {question.topics[0] ? <Badge label={question.topics[0]} tone="primary" /> : null}
        </View>

        <Text style={styles.prompt} selectable>
          {question.prompt}
        </Text>

        <AnswerView
          question={question}
          answer={(item.answer ?? draft) as never}
          onChange={(value) => {
            void selectTick();
            setDraft(value as Answer);
          }}
          grade={grade}
          disabled={revealed && !needsSelfGrade}
          shuffleSeed={session.seed}
        />

        {item.flagged ? (
          <Callout tone="warning" message="Reported — you won't see this question again." />
        ) : null}

        {isGraded(grade) ? (
          <Callout
            tone={grade.outcome === 'correct' ? 'success' : 'info'}
            title={grade.outcome === 'correct' ? 'Correct' : grade.outcome === 'partial' ? 'Partly right' : 'Not quite'}
            /*
              The model's reason first when there is one — it speaks about what
              THIS person wrote, which the question's stock explanation cannot.
            */
            message={judged?.reason ? `${judged.reason}\n\n${question.explanation}` : question.explanation}
          />
        ) : null}

        {/*
          The passage the question came from, shown only after reveal. This is
          the most useful thing on the screen when you've just got something
          wrong — it's the paragraph you need to re-read — so it shows the note's
          own words rather than the repository path it happens to live at.
        */}
        {revealed && question.provenance.excerpt ? (
          <Card tone="inset" title="From your notes">
            <NoteExcerpt
              text={question.provenance.excerpt}
              noteTitle={question.provenance.noteTitle}
              section={question.provenance.section}
              maxChars={320}
            />
          </Card>
        ) : null}
      </ScrollView>

      {/* Action bar ------------------------------------------------------- */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing.md }]}>
        {needsSelfGrade ? (
          <View style={styles.selfGradeRow}>
            <Button title="Missed it" variant="destructive" onPress={() => applySelfGrade('missed')} style={styles.flexButton} />
            <Button title="Close" variant="secondary" onPress={() => applySelfGrade('close')} style={styles.flexButton} />
            <Button title="Got it" onPress={() => applySelfGrade('got-it')} style={styles.flexButton} />
          </View>
        ) : revealed ? (
          <>
            {/*
              An override, not a second grading step. The model is tolerant but
              can still be wrong, and being marked down for an answer you know
              was right would quietly corrupt the schedule.
            */}
            {judged && !item.flagged ? (
              <Button
                title={judged.outcome === 'correct' ? 'I got that wrong' : 'I got that right'}
                variant="secondary"
                onPress={() => applySelfGrade(judged.outcome === 'correct' ? 'missed' : 'got-it')}
              />
            ) : null}
            <Button title={isLast ? 'See results' : 'Next'} onPress={next} />
          </>
        ) : (
          <Button
            title={checking ? 'Checking your answer…' : 'Check'}
            onPress={() => void check()}
            disabled={checking || !logic.isAnswerComplete(draft as never)}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  progressWrap: { flex: 1, gap: spacing.xs },
  progressLabel: { ...type.small, color: colors.textMuted, textAlign: 'center' },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  metaRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  prompt: { ...type.heading, color: colors.text, lineHeight: 26 },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  selfGradeRow: { flexDirection: 'row', gap: spacing.sm },
  flexButton: { flex: 1 },
});
