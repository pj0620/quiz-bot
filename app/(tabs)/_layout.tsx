import { Ionicons } from '@expo/vector-icons';
// js-tabs, not the deprecated `Tabs` from 'expo-router', and not
// unstable-native-tabs — we need control over the badge and tint colours and
// don't want an unstable API on the app's primary navigation.
import { Tabs } from 'expo-router/js-tabs';

import { useAttentionCount } from '../../src/quiz/builder/useBuilder';
import { runStore } from '../../src/quiz/generation/runStore';
import { colors } from '../../src/ui/theme';

export default function TabsLayout() {
  /*
    Notes left in the run currently going, or undefined for no badge.

    A run outlives the screen that started it, so from any other tab there was
    nothing at all to say one was in progress. The badge is the only signal that
    reaches every tab; the card inside Library says what is actually happening.

    A selector returning a number rather than the state, so this re-renders once
    per note instead of on every store write.
  */
  const remaining = runStore.useSelector((state) => {
    if (state.status !== 'running') return undefined;
    const left = state.notes.filter(
      (note) => note.status === 'pending' || note.status === 'running',
    ).length;
    return left > 0 ? left : undefined;
  });

  /*
    Quiz plans waiting on the reader — a batch to review, or new notes to
    write questions for. The same reasoning as the Library badge: a batch
    finishes while the reader is somewhere else, and nothing else on any tab
    would say so.
  */
  const attention = useAttentionCount();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.text },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.background, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Stats',
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="quizzes"
        options={{
          title: 'Quizzes',
          tabBarIcon: ({ color, size }) => <Ionicons name="albums-outline" size={size} color={color} />,
        }}
      />
      {/*
        Between Quizzes and Library because it is the bridge between them: it
        builds quizzes out of library material.
      */}
      <Tabs.Screen
        name="build"
        options={{
          title: 'Build',
          tabBarIcon: ({ color, size }) => <Ionicons name="construct-outline" size={size} color={color} />,
          tabBarBadge: attention > 0 ? attention : undefined,
          // The one pairing every palette guarantees is readable — see `primaryText`.
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.primaryText },
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ color, size }) => <Ionicons name="library-outline" size={size} color={color} />,
          tabBarBadge: remaining,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.primaryText },
        }}
      />
    </Tabs>
  );
}
