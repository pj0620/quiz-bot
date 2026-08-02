import { useEffect, useRef, useState } from 'react';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { startAdhocSession } from '../../src/quiz/startSession';
import { EmptyState } from '../../src/ui/components/EmptyState';
import { LoadingBlock } from '../../src/ui/components/LoadingBlock';
import { Screen } from '../../src/ui/components/Screen';

/**
 * Launcher for ad-hoc sessions ("review what I missed", "practice this now").
 *
 * A route rather than an inline handler so it can be navigated to with
 * `router.replace` — which keeps the finished session off the back stack.
 */
export default function StartAdhocSessionScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ questionIds?: string; name?: string }>();
  const [failed, setFailed] = useState(false);
  // Strict Mode double-invokes effects; without this guard two sessions start.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const ids = (params.questionIds ?? '').split(',').filter(Boolean);
    const result = startAdhocSession(ids, params.name ?? 'Practice');

    if (!result) {
      setFailed(true);
      return;
    }
    router.replace(`/session/${encodeURIComponent(result.session.id)}`);
  }, [params.questionIds, params.name, router]);

  return (
    <>
      <Stack.Screen options={{ title: 'Starting…' }} />
      <Screen>
        {failed ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Nothing to practise"
            body="Those questions are no longer available."
            actionTitle="Back"
            onAction={() => router.dismissAll()}
          />
        ) : (
          <LoadingBlock message="Building your session…" />
        )}
      </Screen>
    </>
  );
}
