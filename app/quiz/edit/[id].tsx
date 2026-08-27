import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { QuizEditor } from '../../../src/features/quiz/QuizEditor';
import { useQuiz } from '../../../src/quiz/useQuiz';
import { CrtOverlay } from '../../../src/ui/components/CrtOverlay';
import { EmptyState } from '../../../src/ui/components/EmptyState';
import { Screen } from '../../../src/ui/components/Screen';

export default function EditQuizScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const quiz = useQuiz(typeof params.id === 'string' ? params.id : undefined);

  if (!quiz) {
    return (
      <Screen>
        <EmptyState icon="help-circle-outline" title="Quiz not found" actionTitle="Back" onAction={() => router.back()} />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `Edit ${quiz.name}` }} />
      <QuizEditor existing={quiz} />
      {/* Modal presentation escapes the root layout's copy; see CrtOverlay. */}
      <CrtOverlay />
    </>
  );
}
