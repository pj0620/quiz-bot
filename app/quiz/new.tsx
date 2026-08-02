import { Stack } from 'expo-router';

import { QuizEditor } from '../../src/features/quiz/QuizEditor';

export default function NewQuizScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'New quiz' }} />
      <QuizEditor />
    </>
  );
}
