import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from 'react';
import { Stack,
  useLocalSearchParams,
  useRouter } from 'expo-router';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildDiscussionSummary, vocabSubjectOf } from '../../src/quiz/discussionSummary';
import { useVocabWordFor } from '../../src/quiz/vocab/useVocab';
import { resolveCredentialsOrNull } from '../../src/features/llm/credentials';
import { gradeListRecall } from '../../src/features/llm/gradeListRecall';
import { gradeShortAnswer } from '../../src/features/llm/gradeShortAnswer';
import { getAnswerView, getQuestionLogic, isAnswerComplete } from '../../src/quiz/questionTypes';
import {
  advanceSession,
  answerSessionItem,
  abandonSession,
  completeSession,
  flagQuestion,
  flagSessionItem,
  giveUpSessionItem,
  deleteQuestion,
  overrideSessionItemOutcome,
  setSessionIndex,
} from '../../src/quiz/store';
import { useSession, useSessionQuestions } from '../../src/quiz/useQuiz';
import { isPromptQuestion } from '../../src/quiz/promptSource';
import { isCalendarQuestion } from '../../src/quiz/calendar/catalog';
import { geographyLocationOf } from '../../src/quiz/geography/catalog';
import { isGraded, outcomeFromSelfGrade, type Answer, type Grade, type Outcome, type Question, type SelfGrade } from '../../src/quiz/types';
import { answerFeedback, selectTick } from '../../src/ui/haptics';
import { Badge } from '../../src/ui/components/Badge';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { Card } from '../../src/ui/components/Card';
import { CopyButton } from '../../src/ui/components/CopyButton';
import { CrtOverlay } from '../../src/ui/components/CrtOverlay';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { HeaderIconButton } from '../../src/ui/components/HeaderIconButton';
import { NoteSource } from '../../src/ui/components/NoteSource';
import { ScreenScrollProvider, useScrollAnchor } from '../../src/ui/components/Screen';
import { ProgressSegments, type SegmentState } from '../../src/ui/components/ProgressSegments';
import { PronounceButton } from '../../src/ui/components/PronounceButton';
import { QuestionFigureView } from '../../src/ui/components/QuestionFigureView';
import { QuestionLocation } from '../../src/ui/components/QuestionLocation';
import { TypewriterText } from '../../src/ui/components/TypewriterText';
import { colors, spacing, themedSheet, type } from '../../src/ui/theme';


export default function SessionPlayerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const sessionId = typeof params.id === 'string' ? params.id : undefined;

  const session = useSession(sessionId);
  const insets = useSafeAreaInsets();
  /*
    The player owns its scroll view rather than using `Screen`, because it lays
    itself out by hand around a fixed top bar and action bar. `useScrollAnchor`
    is what lets things inside it — the note highlight — still ask to be brought
    into view.
  */
  const { scroll, listRef: scrollRef, anchor, scrollEnabled } = useScrollAnchor();

  /** Draft answer for the current item, before Check is pressed. */
  const [draft, setDraft] = useState<Answer | null>(null);
  /** True while a written answer is being marked by the model. */
  const [checking, setChecking] = useState(false);

  /*
    Tracked only to drop the home-indicator inset while the keyboard is up.

    `KeyboardAvoidingView` lifts the action bar clear of the keyboard, but the
    safe-area padding underneath it is there to clear the home indicator — which
    the keyboard is already covering. Leaving it in floats the buttons on a band
    of empty space at exactly the moment the screen is most cramped.
  */
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    // `will` events on iOS so the padding changes in step with the animation
    // rather than a beat behind it; Android only emits `did`.
    const shown = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hidden = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  // Bank plus the session's derived geography — see `useSessionQuestions`.
  const questionById = useSessionQuestions(session);

  const item = session?.items[session.currentIndex];
  const question: Question | undefined = item ? questionById.get(item.questionId) : undefined;
  const grade: Grade | null = item?.grade ?? null;

  // Undefined for everything that isn't a word, which is what makes the
  // vocabulary-only parts of the reveal appear and disappear on their own.
  const vocabWord = useVocabWordFor(question);

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
      /*
        No scroll on reveal — deliberately. This used to jump to the end so the
        explanation was visible, but that yanked the question and the chosen
        answer off the screen at exactly the moment the user wants to compare
        them against the verdict. The reveal appears in place; reading past it
        is the user's move to make.
      */
      if (result && isGraded(result)) void answerFeedback(result.outcome);
    },
    [session, question],
  );

  /*
    A typed answer is marked by the model before being committed.

    Everything else grades instantly and offline, so these are the only paths
    that wait on a network call. Both are bounded the same three ways: only for
    short answer and Name Them, only when a judge is configured, and the
    grading call resolves to null on any failure instead of throwing — so the
    worst case is what was there before: self-grade buttons for short answer,
    the local string matcher for Name Them. Never a stuck quiz.

    Resolved as 'judge' rather than 'generate': marking can be pointed at its
    own provider and model in Settings, and asking for the generator here is
    what would silently mark answers with the expensive writing model.
  */
  const check = useCallback(async () => {
    if (!session || !question || !draft) return;

    const isShortAnswer = question.format === 'short-answer' && draft.format === 'short-answer';
    const isListRecall = question.format === 'list-recall' && draft.format === 'list-recall';
    if (!isShortAnswer && !isListRecall) {
      commit(draft);
      return;
    }

    setChecking(true);
    try {
      const credentials = await resolveCredentialsOrNull('judge');
      if (!credentials) {
        commit(draft);
        return;
      }

      if (isShortAnswer) {
        const verdict = await gradeShortAnswer({
          question,
          text: draft.text,
          provider: credentials.provider,
          apiKey: credentials.apiKey,
          model: credentials.model,
        });
        commit(verdict ? { ...draft, judged: verdict } : draft);
      } else if (isListRecall) {
        const judged = await gradeListRecall({
          question,
          entries: draft.entries,
          provider: credentials.provider,
          apiKey: credentials.apiKey,
          model: credentials.model,
        });
        commit(judged ? { ...draft, judged } : draft);
      }
    } finally {
      setChecking(false);
    }
  }, [session, question, draft, commit]);

  /**
   * "I don't know" — reveal the answer, and record it honestly as missed.
   *
   * Not a blank submission through `check`: see `giveUpSessionItem` for why
   * true/false makes that unsafe. Dismissing the keyboard first is what makes
   * the explanation and the source note visible, which is the entire point of
   * pressing this rather than guessing.
   */
  const giveUp = useCallback(() => {
    if (!session || !question) return;
    Keyboard.dismiss();
    const result = giveUpSessionItem(session.id, question.id);
    // Same no-scroll rule as `commit`: the answer reveals in place.
    if (result && isGraded(result)) void answerFeedback(result.outcome);
  }, [session, question]);

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

  /**
   * The furthest the session has actually progressed: the first item still
   * waiting to be answered. Flagged items count as settled — they were dealt
   * with, not skipped. Everything behind this line is history that can be
   * revisited; the item ON it is where play resumes.
   */
  const frontier = useMemo(() => {
    if (!session) return 0;
    const index = session.items.findIndex(
      (entry) => entry.outcome === undefined && entry.grade === undefined && !entry.flagged,
    );
    return index === -1 ? session.items.length - 1 : index;
  }, [session]);

  const revisiting = !!session && session.currentIndex < frontier;

  /**
   * Where the back arrow leads: the nearest earlier item that is settled AND
   * still resolves to a question. Both halves matter — a flagged item whose
   * question was deleted mid-session has nothing to show, and landing on it
   * would drop the player into its "nothing left to answer" screen.
   */
  const backIndex = useMemo(() => {
    if (!session) return -1;
    for (let index = session.currentIndex - 1; index >= 0; index -= 1) {
      const entry = session.items[index];
      if (
        (entry.outcome !== undefined || entry.grade !== undefined) &&
        questionById.has(entry.questionId)
      ) {
        return index;
      }
    }
    return -1;
  }, [session, questionById]);

  const goTo = useCallback(
    (index: number) => {
      if (!session) return;
      setDraft(null);
      setSessionIndex(session.id, index);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    },
    [session],
  );

  const goBack = useCallback(() => {
    if (backIndex >= 0) goTo(backIndex);
  }, [backIndex, goTo]);

  /** Re-marks a revisited answer — right, or wrong — and feeds the schedule. */
  const overrideOutcome = useCallback(
    (outcome: Outcome) => {
      if (!session || !question) return;
      overrideSessionItemOutcome(session.id, question.id, outcome);
      void answerFeedback(outcome);
    },
    [session, question],
  );

  const next = useCallback(() => {
    if (!session) return;

    /*
      Walking forward through history after going back: the next settled item
      that still resolves, or the frontier where play resumes. The frontier
      lookup can't be a plain +1 for the same reason `backIndex` can't — a
      deleted question's flagged row may sit in between.
    */
    if (revisiting) {
      for (let index = session.currentIndex + 1; index < frontier; index += 1) {
        const entry = session.items[index];
        if (
          (entry.outcome !== undefined || entry.grade !== undefined) &&
          questionById.has(entry.questionId)
        ) {
          goTo(index);
          return;
        }
      }
      goTo(frontier);
      return;
    }

    const isLast = session.currentIndex >= session.items.length - 1;
    if (isLast) {
      finish();
      return;
    }
    setDraft(null);
    advanceSession(session.id);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [session, revisiting, frontier, questionById, goTo, finish]);

  /**
   * What to do about a bad question: fix it, or bin it.
   *
   * This replaced a list of report REASONS ("the answer is wrong", "it's
   * unclear"). Filing a reason only ever hid the question and left it wrong —
   * which is a fine outcome for a question you can never fix, and the wrong one
   * here, where the note it came from and the model that wrote it are both
   * still to hand. Both of these actually change the bank.
   */
  const promptFix = useCallback(() => {
    if (!session || !question) return;
    Alert.alert('This question', 'Change it, or remove it from the bank for good.', [
      {
        text: 'Edit',
        onPress: () => router.push(`/questions/edit/${encodeURIComponent(question.id)}`),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          /*
            Flagged in the session BEFORE it is deleted.

            `deleteQuestion` strips the item from the session outright, so
            without this the quiz would silently get one question shorter and
            the progress bar would jump. Marking it first leaves a settled row
            behind — and the delete then finds nothing to strip.
          */
          flagQuestion(question.id, 'not-useful');
          flagSessionItem(session.id, question.id);
          deleteQuestion(question.id);
          next();
        },
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [session, question, router, next]);

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
  /** The word this question is about, for a vocabulary question. */
  const vocabSubject = vocabSubjectOf(question, vocabWord);
  /*
    Whether the question itself already shows the word. Every vocab format is
    required to name its word EXCEPT fill-blank, where recovering the word is
    the exercise — a labelled speaker button under one would hand the answer
    over, and even an unlabelled one would say it out loud. Those get the
    button at reveal, when the word is public anyway.
  */
  const promptNamesWord =
    !!vocabSubject && question.prompt.toLowerCase().includes(vocabSubject.word.toLowerCase());

  return (
    /*
      The whole player avoids the keyboard, not just the input.

      The action bar sits outside the ScrollView so it stays put while the
      question scrolls — which also meant the keyboard covered it, and Check
      could only be reached by dismissing the keyboard first. Padding the root
      shrinks the scrollable middle and carries the bar up with it.

      Android needs no behaviour: Expo's default `softwareKeyboardLayoutMode` is
      already `resize`, and asking for padding on top of that lifts the bar twice.
    */
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top bar ---------------------------------------------------------- */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        <HeaderIconButton name="close" accessibilityLabel="Leave quiz" onPress={confirmExit} />
        {/* Back through what's already been answered — to reread it, or to
            re-mark it. Hidden on the first question, where there is no back. */}
        {backIndex >= 0 ? (
          <HeaderIconButton
            name="chevron-back"
            accessibilityLabel="Previous question"
            onPress={goBack}
          />
        ) : null}
        <View style={styles.progressWrap}>
          <ProgressSegments segments={segments} />
          <Text style={styles.progressLabel}>
            {session.currentIndex + 1} of {session.items.length}
          </Text>
        </View>
        <HeaderIconButton name="flag-outline" accessibilityLabel="Report question" onPress={promptFix} />
      </View>

      <ScreenScrollProvider scroll={scroll}>
        <ScrollView
          ref={scrollRef}
          scrollEnabled={scrollEnabled}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {anchor}
          {/* Meta chips are registry-driven, so a new format needs no edit here. */}
          <View style={styles.metaRow}>
            <Badge label={logic.label} />
            <Badge label={question.difficulty} tone="neutral" />
            {question.topics[0] ? <Badge label={question.topics[0]} tone="primary" /> : null}
          </View>

          {/*
            Keyed by question, not by text: consecutive map questions share the
            exact prompt ("Which state is this?"), and each one should still be
            typed out afresh. Plain Text everywhere outside Terminal.
          */}
          <TypewriterText key={item.questionId} style={styles.prompt} text={question.prompt} selectable />

          {/* The word with its sound, Google-panel style — part of knowing a
              word is knowing how it sounds, and hearing it gives nothing away
              that the prompt hasn't already shown. */}
          {vocabSubject && (revealed || promptNamesWord) ? (
            <View style={styles.pronounceRow}>
              <PronounceButton word={vocabSubject.word} size={28} />
              <Text style={styles.pronounceWord} selectable>
                {vocabSubject.word}
              </Text>
            </View>
          ) : null}

          {/* After the prompt: "Which state is this?" has to be read before the
              shape means anything. */}
          {question.figure ? <QuestionFigureView figure={question.figure} /> : null}

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
            >
              <View style={styles.copyRow}>
                {/*
                  The way out of the app when the explanation isn't enough.

                  Everything needed to argue about this question — the prompt, what
                  the reader put, what was right, the note or the word it came from
                  — is already on this screen, so it costs nothing to hand over as
                  one block of text and saves retyping it into a chat. Built at
                  press time from what is stored: no second model call, no waiting.
                */}
                <CopyButton
                  label="Copy for chat"
                  accessibilityLabel="Copy a summary of this question to discuss elsewhere"
                  text={() =>
                    buildDiscussionSummary({
                      question,
                      answer: item.answer,
                      outcome: item.outcome ?? grade.outcome,
                      word: vocabWord,
                    })
                  }
                />

                {/*
                  Just the word, for a word.

                  Not a smaller version of the summary but a different errand:
                  looking it up somewhere else, dropping it into a sentence you
                  are writing, searching for it. Everything the summary adds is
                  in the way of that, so this copies the bare word and nothing
                  else.
                */}
                {vocabSubject ? (
                  <CopyButton
                    label="Copy word"
                    accessibilityLabel={`Copy the word ${vocabSubject.word}`}
                    text={vocabSubject.word}
                  />
                ) : null}
              </View>
            </Callout>
          ) : null}

          {/*
            Where the answer came from, shown only after reveal — the most
            useful thing on the screen when you have just got something wrong.

            Which "where" depends on the question. A note-derived question shows
            the paragraph it was written from, in the note's own words rather
            than the repository path it happens to live at. A geography question
            has no note at all, so it shows the map instead: `NoteSource` would
            read `us-states/us-tn` as a file and try to fetch it from a source
            called `geography` that does not exist. A calendar question has no
            note either and nothing to draw — its explanation above already
            states the fact — so it shows nothing here rather than letting
            `NoteSource` chase a source called `calendar`.
          */}
          {revealed && geographyLocationOf(question) ? (
            <QuestionLocation question={question} />
          ) : revealed && isCalendarQuestion(question) ? null : revealed &&
            isPromptQuestion(question) ? (
            /*
              A prompt question has no note behind it — its provenance is the
              subject the reader typed. `NoteSource` would caption that text as
              a note title and then show it again as the excerpt.
            */
            <Card tone="inset" title="From your prompt">
              <Text style={styles.promptSource} selectable>
                {question.provenance.noteTitle ?? 'A subject you asked about'}
              </Text>
            </Card>
          ) : revealed && (question.provenance.excerpt || question.provenance.path) ? (
            <Card tone="inset" title="From your notes">
              <NoteSource provenance={question.provenance} />
            </Card>
          ) : null}
        </ScrollView>
      </ScreenScrollProvider>

      {/* Action bar ------------------------------------------------------- */}
      <View
        style={[
          styles.actions,
          { paddingBottom: (keyboardUp ? 0 : insets.bottom) + spacing.md },
        ]}
      >
        {needsSelfGrade ? (
          <View style={styles.selfGradeRow}>
            <Button title="Missed it" variant="destructive" onPress={() => applySelfGrade('missed')} style={styles.flexButton} />
            <Button title="Close" variant="secondary" onPress={() => applySelfGrade('close')} style={styles.flexButton} />
            <Button title="Got it" onPress={() => applySelfGrade('got-it')} style={styles.flexButton} />
          </View>
        ) : revealed ? (
          <>
            {/*
              An override, not a second grading step. Offered in two places
              for the same reason: right after model marking (the judge is
              tolerant but can still be wrong), and on any REVISITED question
              (you pressed Next, realised the tick was wrong, came back).
              Being marked down for an answer you know was right — or up for
              one you know was wrong — quietly corrupts the schedule.

              Deliberately NOT offered on a question just answered by exact
              grading: flipping "wrong" to "right" while still looking at the
              red cross is self-deception, not correction. Going back first is
              a small act of reconsideration, which is exactly the case the
              override exists for.
            */}
            {isGraded(grade) && !item.flagged && (judged || revisiting) ? (
              <Button
                title={grade.outcome === 'correct' ? 'I got that wrong' : 'I got that right'}
                variant="secondary"
                onPress={() => overrideOutcome(grade.outcome === 'correct' ? 'incorrect' : 'correct')}
              />
            ) : null}
            <Button title={isLast ? 'See results' : 'Next'} onPress={next} />
          </>
        ) : (
          /*
            Offered on EVERY format, not just the written ones. Not knowing is
            not a property of the question type — and on multiple-choice or
            true/false the alternative is a guess, which teaches nothing and
            lands a coin-flip "correct" in the review schedule.

            Deliberately not `destructive`: giving up honestly is the right move
            when you don't know, and colouring it like a mistake discourages
            exactly the behaviour that makes the schedule truthful.
          */
          <View style={styles.actionRow}>
            <Button
              title="I don't know"
              variant="secondary"
              onPress={giveUp}
              disabled={checking}
              style={styles.flexButton}
            />
            <Button
              title="Check"
              // The spinner rather than "Checking your answer…", which no longer
              // fits now that the button is half a row wide.
              loading={checking}
              onPress={() => void check()}
              // Via the registry, which pairs the draft with its question —
              // "complete" depends on both, and this drops an `as never`.
              disabled={checking || !isAnswerComplete(question, draft)}
              style={styles.flexButton}
            />
          </View>
        )}
      </View>
      {/* The player presents as a full-screen modal, above the root layout's
          copy — without its own glass it would be the one scanline-free screen. */}
      <CrtOverlay />
    </KeyboardAvoidingView>
  );
}

const styles = themedSheet(() => ({
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
  pronounceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start' },
  pronounceWord: { ...type.bodyStrong, color: colors.textMuted, flexShrink: 1 },
  promptSource: { ...type.body, color: colors.text, lineHeight: 24 },
  actions: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  // Wraps, because a long word makes its own button wide.
  copyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  selfGradeRow: { flexDirection: 'row', gap: spacing.sm },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  flexButton: { flex: 1 },
}));
