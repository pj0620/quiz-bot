import { useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet, Text, View } from 'react-native';

import { isGitHubConfigured } from '../../src/config/env';
import { connectionStore } from '../../src/features/github/auth/connectionStore';
import { getSourceType } from '../../src/sources/registry';
import { sourcesStore } from '../../src/sources/store';
import { useSources } from '../../src/sources/useSources';
import type { InfoSource, SourceHealthStatus } from '../../src/sources/types';
import { Button } from '../../src/ui/components/Button';
import { Callout } from '../../src/ui/components/Callout';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { HeaderIconButton } from '../../src/ui/components/HeaderIconButton';
import { ListRow } from '../../src/ui/components/ListRow';
import { SectionHeader } from '../../src/ui/components/SectionHeader';
import { Card } from '../../src/ui/components/Card';
import { useQuestions } from '../../src/quiz/useQuiz';
import { Screen } from '../../src/ui/components/Screen';
import { colors, spacing, type } from '../../src/ui/theme';

const HEALTH_COLORS: Record<SourceHealthStatus, string> = {
  unknown: colors.textFaint,
  ok: colors.success,
  empty: colors.warning,
  no_access: colors.danger,
  error: colors.danger,
};

function HealthDot({ sourceId }: { sourceId: string }) {
  const status = sourcesStore.useSelector((state) => state.health[sourceId]?.status ?? 'unknown');
  return <View style={[styles.dot, { backgroundColor: HEALTH_COLORS[status] }]} />;
}

function SourceRow({ source }: { source: InfoSource }) {
  const router = useRouter();
  const definition = getSourceType(source);

  return (
    <ListRow
      title={definition.getTitle(source)}
      subtitle={definition.getSubtitle(source)}
      icon={definition.icon}
      onPress={() => router.push(`/sources/${encodeURIComponent(source.id)}`)}
      accessory={<HealthDot sourceId={source.id} />}
      showChevron
    />
  );
}

export default function LibraryScreen() {
  const router = useRouter();
  const sources = useSources();
  const connection = connectionStore.use();
  const configured = isGitHubConfigured();
  const questions = useQuestions();

  return (
    <>
      <Tabs.Screen
        options={{
          title: 'Library',
          headerRight: () => (
            <View style={styles.headerActions}>
              <HeaderIconButton
                name="settings-outline"
                accessibilityLabel="Settings"
                onPress={() => router.push('/settings')}
              />
              <HeaderIconButton
                name="add"
                accessibilityLabel="Add an info source"
                onPress={() => router.push('/sources/new')}
              />
            </View>
          ),
        }}
      />
      <Screen>
        {!configured ? (
          <Callout
            tone="warning"
            title="GitHub isn't configured yet"
            message={
              'Create a GitHub App, enable Device Flow, and set Contents: Read-only. Then paste its Client ID and slug into expo.extra.github in app.json and restart with: npx expo start -c'
            }
          />
        ) : null}

        {connection.status === 'reauth_required' ? (
          <Callout
            tone="warning"
            title="GitHub connection expired"
            message={
              connection.login
                ? `Reconnect as @${connection.login} to keep reading your repositories. Your sources are still saved.`
                : 'Reconnect to GitHub to keep reading your repositories. Your sources are still saved.'
            }
          >
            <Button
              title="Reconnect to GitHub"
              onPress={() => router.push('/connect/github')}
              variant="secondary"
            />
          </Callout>
        ) : null}

        {sources.length > 0 ? (
          <Card title="Question bank">
            <Text style={styles.bankCount}>
              {questions.length} question{questions.length === 1 ? '' : 's'}
            </Text>
            {/* Pushes rather than running inline: generation is now a long,
                cancellable, paid process that needs progress and its own space. */}
            <Button
              title="Generate questions"
              onPress={() => router.push('/generate')}
              variant="secondary"
            />
            {questions.length > 0 ? (
              <Button
                title="Browse questions"
                variant="plain"
                onPress={() => router.push('/questions')}
              />
            ) : null}
          </Card>
        ) : null}

        {sources.length === 0 ? (
          <EmptyState
            icon="library-outline"
            title="No notes yet"
            body="Connect a repository of markdown notes and QuizBot will build questions from what you've written."
            actionTitle="Add a source"
            onAction={() => router.push('/sources/new')}
          />
        ) : (
          <View style={styles.list}>
            <SectionHeader title={`${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`} />
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  list: { gap: spacing.sm },
  bankCount: { ...type.bodyStrong, color: colors.text },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
