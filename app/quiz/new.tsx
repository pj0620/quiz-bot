import { Stack } from 'expo-router';

import { QuizEditor } from '../../src/features/quiz/QuizEditor';
import { CrtOverlay } from '../../src/ui/components/CrtOverlay';

export default function NewQuizScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'New quiz' }} />
      <QuizEditor />
      {/* Modal presentation escapes the root layout's copy; see CrtOverlay. */}
      <CrtOverlay />
    </>
  );
}
