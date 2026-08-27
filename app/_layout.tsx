import { useEffect, useRef } from 'react';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { hydrateKeyStatus } from '../src/features/llm/settings';
import { startAppStateTracking } from '../src/lib/appState';
import { initBackgroundResume } from '../src/quiz/generation/backgroundResume';
import { ensureBuiltinQuizzes } from '../src/quiz/store';
import { ensureBuiltinThemes } from '../src/quiz/vocab/preferences';
import { CrtOverlay } from '../src/ui/components/CrtOverlay';
import { immersiveScreenOptions, stackScreenOptions } from '../src/ui/navigation/screenOptions';
import { themes, useThemeName } from '../src/ui/theme';
import { initThemePersistence } from '../src/ui/themePersistence';

/*
  At module load, before anything renders, so the very first frame is already
  in the reader's saved theme. An effect-based hydrate would paint the default
  palette for a beat and then repaint — a flash on every single launch to save
  one line here.
*/
initThemePersistence();

// Seeded once at module load rather than in an effect: the Quizzes tab reads
// the store synchronously on first render, and a effect-based seed would show
// an empty list for a frame.
ensureBuiltinQuizzes();

// Same reasoning, same idempotence: the suggestion screen reads the theme list
// synchronously, and arriving to no themes at all would leave nothing to pick.
ensureBuiltinThemes();

/*
  Started at module load and never stopped, because it has to be running BEFORE
  the first request is sent, not once some screen has mounted.

  Request timeouts are measured in foreground time, and this is what tells them
  how long the app was suspended. Without it every request in flight when the
  app was backgrounded expires the instant it comes back. See `lib/appState.ts`.
*/
startAppStateTracking();

// Whether an API key exists can only be answered by the Keychain, which is
// async. Kicked off once here so Settings shows a truthful state on arrival
// rather than flashing "no key" for a frame.
void hydrateKeyStatus();

/*
  Reconciles the resume task's registration with whatever the last launch left
  behind — a run the OS killed mid-flight must keep its wake-up. The task's
  DEFINITION does not live here: route modules only evaluate on render, and a
  headless background launch never renders, so that sits in the entry file
  (`index.ts`). See `src/quiz/generation/backgroundResume.ts`.
*/
initBackgroundResume();

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
  const themeName = useThemeName();

  /*
    Switching theme REMOUNTS the entire tree (the `key` below): mutating the
    token objects re-colours anything that renders, but react-navigation holds
    mounted screens still, so without the remount every open screen would keep
    its old palette. The cost is navigation state — so this puts the reader
    back on the theme screen they were choosing from, rather than dumping them
    at the first tab mid-comparison.
  */
  const previousTheme = useRef(themeName);
  useEffect(() => {
    if (previousTheme.current === themeName) return;
    previousTheme.current = themeName;
    // Deferred a tick so the freshly mounted navigator is ready to be pushed on.
    const timer = setTimeout(() => router.navigate('/settings/theme'), 0);
    return () => clearTimeout(timer);
  }, [themeName]);

  return (
    <SafeAreaProvider>
      {/*
        Required by the timeline question's drag-to-reorder list. On Android,
        gestures registered outside this view never fire at all — and the
        failure is silent, so it looks like the drag simply doesn't work rather
        than like a missing provider.
      */}
      <GestureHandlerRootView style={styles.root}>
        {/* Which status-bar ink stays readable is a property of the theme:
            light content on the dark palettes, dark content on Paper and on
            Terminal's green. */}
        <StatusBar style={themes[themeName].statusBar} />
        <Stack key={themeName} screenOptions={stackScreenOptions()}>
        {/*
          The tab navigator is one screen in the root stack. Detail screens sit
          alongside it rather than inside each tab, so there's a single back
          stack and the session player can cover the tab bar.
        */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings/theme" options={{ title: 'Appearance' }} />
        <Stack.Screen name="generate/index" options={{ title: 'Generate' }} />
        <Stack.Screen name="generate/topic" options={{ title: 'Ask for questions' }} />

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

        {/* A plain stack screen rather than a modal: `suggest` pushes onward to
            the word list once words are accepted, and a modal has nowhere to
            push to. */}
        <Stack.Screen name="vocab/index" options={{ title: 'Vocabulary' }} />
        <Stack.Screen name="vocab/suggest" options={{ title: 'Suggest words' }} />
        <Stack.Screen name="vocab/[slug]" options={{ title: 'Word' }} />

        <Stack.Screen name="questions/index" options={{ title: 'Question bank' }} />
        <Stack.Screen name="questions/[id]" options={{ title: 'Question' }} />
        {/* Pushed from the player as well as from the bank, so it is a plain
            stack screen rather than a modal — a modal over the full-screen
            player has nowhere to go back to. */}
        <Stack.Screen name="questions/edit/[id]" options={{ title: 'Edit question' }} />
        </Stack>
        {/*
          Over the whole navigator — headers and tab bar included — so the
          Terminal theme's scanlines read as the glass, not as a per-screen
          decoration. Modal routes present above this view in their own native
          container, so each modal screen mounts its own copy; see CrtOverlay.
        */}
        <CrtOverlay />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
