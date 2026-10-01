import { useCallback, useEffect, useMemo, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native';

import { updateDraft } from '../../../../src/quiz/builder/store';
import { usePlan } from '../../../../src/quiz/builder/useBuilder';
import { getAnswerView, getQuestionLogic } from '../../../../src/quiz/questionTypes';
import { getQuestionEditor } from '../../../../src/quiz/questionTypes/editors';
import type { Difficulty, Grade, Question } from '../../../../src/quiz/types';
import { Badge } from '../../../../src/ui/components/Badge';
import { Button } from '../../../../src/ui/components/Button';
import { Card } from '../../../../src/ui/components/Card';
import { EmptyState } from '../../../../src/ui/components/EmptyState';
import { Screen } from '../../../../src/ui/components/Screen';
import { SectionHeader } from '../../../../src/ui/components/SectionHeader';
import { SegmentedControl } from '../../../../src/ui/components/SegmentedControl';
import { TextField } from '../../../../src/ui/components/TextField';
import { colors, spacing, themedSheet, type } from '../../../../src/ui/theme';

/**
 * Fixing one drafted question by hand, before it reaches the bank.
 *
 * The bank's editor reads from the bank, and a draft is not in it yet — so
 * this is that editor's hand half, built from the same registry pieces, saving
 * back onto the batch. The model half is deliberately absent: "Needs work" on
 * the review card already sends a draft to the model, with the reader's
 * reasons, alongside every other draft flagged in the batch.
 */

const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: 'intro', label: 'Intro' },
  { value: 'core', label: 'Core' },
  { value: 'deep', label: 'Deep' },
];

export default function EditDraftScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; questionId: string }>();
  const planId = typeof params.id === 'string' ? params.id : undefined;
  const questionId = typeof params.questionId === 'string' ? params.questionId : undefined;
  const plan = usePlan(planId);

  const saved = useMemo(
    () => plan?.batches.flatMap((batch) => batch.drafts).find((draft) => draft.id === questionId),
    [plan, questionId],
  );
  const [draft, setDraft] = useState<Question | null>(saved ?? null);

  // Seeded once, so edits survive the plan store changing underneath — a batch
  // still writing updates the plan on every note.
  useEffect(() => {
    setDraft((current) => (current && current.id === saved?.id ? current : (saved ?? null)));
  }, [saved]);

  const revealed: Grade = useMemo(() => ({ status: 'graded', outcome: 'correct', score: 1 }), []);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const save = useCallback(() => {
    if (!planId || !draft) return;
    updateDraft(planId, draft);
    router.back();
  }, [planId, draft, router]);

  const leave = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('Discard your changes?', 'This question goes back to how it was.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  }, [dirty, router]);

  if (!saved || !draft || !planId) {
    return (
      <Screen>
        <EmptyState
          icon="help-circle-outline"
          title="Question not found"
          body="Its batch may have been kept or discarded already."
          actionTitle="Back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const Editor = getQuestionEditor(draft.format);
  const AnswerView = getAnswerView(draft.format);
  const logic = getQuestionLogic(draft.format);

  return (
    <>
      <Stack.Screen options={{ title: 'Edit question' }} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen>
          <View style={styles.metaRow}>
            <Badge label={logic.label} />
            <Badge label="Draft" tone="primary" />
          </View>

          <SectionHeader title="Question" />
          <TextField
            value={draft.prompt}
            onChangeText={(prompt) => setDraft({ ...draft, prompt })}
            placeholder="What is being asked"
            autoCapitalize="sentences"
            autoCorrect
            multiline
          />

          <Editor question={draft} onChange={(next) => setDraft(next)} />

          <SectionHeader title="Explanation" />
          <TextField
            value={draft.explanation}
            onChangeText={(explanation) => setDraft({ ...draft, explanation })}
            placeholder="Why the answer is right — shown after answering"
            autoCapitalize="sentences"
            autoCorrect
            multiline
          />

          <SectionHeader title="Difficulty" />
          <SegmentedControl
            options={DIFFICULTIES}
            value={draft.difficulty}
            onChange={(difficulty) => setDraft({ ...draft, difficulty })}
          />

          <Card tone="inset" title="Preview">
            <Text style={styles.prompt}>{draft.prompt}</Text>
            <AnswerView
              question={draft as never}
              answer={null as never}
              onChange={() => undefined}
              grade={revealed}
              disabled
            />
            <Text style={styles.hint}>{draft.explanation}</Text>
          </Card>

          <Text style={styles.hint}>
            Saved to the batch, not your bank — it joins the bank when you keep the batch. To have the AI rewrite it
            instead, mark it “Needs work” in the review.
          </Text>
          <Button title="Save" onPress={save} disabled={!dirty || !draft.prompt.trim()} />
          <Button title="Cancel" variant="plain" onPress={leave} />
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = themedSheet(() => ({
  fill: { flex: 1 },
  metaRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  prompt: { ...type.bodyStrong, color: colors.text, lineHeight: 22 },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
}));
