import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { hydrateKeyStatus } from '../src/features/llm/settings';
import { ensureBuiltinQuizzes } from '../src/quiz/store';
import { immersiveScreenOptions, stackScreenOptions } from '../src/ui/navigation/screenOptions';

// Seeded once at module load rather than in an effect: the Quizzes tab reads
// the store synchronously on first render, and a effect-based seed would show
// an empty list for a frame.
ensureBuiltinQuizzes();

// Whether an API key exists can only be answered by the Keychain, which is
// async. Kicked off once here so Settings shows a truthful state on arrival
// rather than flashing "no key" for a frame.
void hydrateKeyStatus();

/**
 * Anchors every route to the tabs.
 *
 * Without this, opening a detail route as the app's FIRST screen — a deep link,
 * a notification, a dev link — leaves the stack with no history, so the header
 * renders no back button and there is genuinely no way out but force-quitting.
 * Naming the initial route makes expo-router put `(tabs)` underneath whatever
 * was linked to, so back always leads somewhere.
 */
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* "light" = light-coloured status bar content, for a dark background. */}
      <StatusBar style="light" />
      <Stack screenOptions={stackScreenOptions}>
        {/*
          The tab navigator is one screen in the root stack. Detail screens sit
          alongside it rather than inside each tab, so there's a single back
          stack and the session player can cover the tab bar.
        */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="generate" options={{ title: 'Generate' }} />

        <Stack.Screen name="sources/new" options={{ presentation: 'modal', title: 'Add a source' }} />
        <Stack.Screen name="sources/[id]" options={{ title: 'Source' }} />
        <Stack.Screen name="connect/github" options={{ headerShown: false }} />

        <Stack.Screen name="quiz/[id]" options={{ title: 'Quiz' }} />
        <Stack.Screen name="quiz/new" options={{ presentation: 'modal', title: 'New quiz' }} />
        <Stack.Screen name="quiz/edit/[id]" options={{ presentation: 'modal', title: 'Edit quiz' }} />

        {/*
          The player is full-screen and non-dismissible by gesture: a back-swipe
          must not silently abandon a quiz in progress.
        */}
        <Stack.Screen name="session/[id]" options={immersiveScreenOptions} />
        <Stack.Screen name="session/start" options={{ title: 'Starting…' }} />
        <Stack.Screen name="session/results/[id]" options={{ title: 'Results' }} />

        <Stack.Screen name="questions/index" options={{ title: 'Question bank' }} />
        <Stack.Screen name="questions/[id]" options={{ title: 'Question' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
