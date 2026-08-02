import { useCallback, useEffect, useState } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useDeviceFlow } from '../../../src/features/github/auth/useDeviceFlow';
import { getAuthSnapshot } from '../../../src/features/github/auth/tokenManager';
import { NETWORK_FAILURE_HINT_THRESHOLD, remainingMs } from '../../../src/features/github/auth/deviceFlowMachine';
import { UserCodeCard } from '../../../src/features/github/ui/UserCodeCard';
import { formatCountdown, nowMs } from '../../../src/lib/time';
import { Button } from '../../../src/ui/components/Button';
import { Callout } from '../../../src/ui/components/Callout';
import { Screen } from '../../../src/ui/components/Screen';
import { colors, spacing, type } from '../../../src/ui/theme';

export default function ConnectGitHubScreen() {
  const router = useRouter();

  /**
   * Evaluated once on mount, deliberately. A reactive read would also fire when
   * the device flow flips the status to 'connected', racing the onSuccess
   * navigation below and pushing twice.
   */
  const [alreadyConnected] = useState(() => getAuthSnapshot() === 'connected');

  const goToInstall = useCallback(() => {
    router.replace('/connect/github/install');
  }, [router]);

  const { state, start, cancel, retry, copyCode, openVerificationPage, copied } =
    useDeviceFlow(goToInstall);

  // Display-only countdown; the machine's wall-clock deadline is authoritative.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (state.status !== 'awaiting_authorization') return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state.status]);

  // Already connected? Skip straight to picking repos — this is the "add another
  // repo later" path, and re-authorizing would be pointless friction.
  if (alreadyConnected) {
    return <Redirect href="/connect/github/install" />;
  }

  if (state.status === 'idle') {
    return (
      <Screen>
        <Text style={styles.heading}>Connect your GitHub account</Text>
        <Text style={styles.body}>
          QuizBot will ask GitHub for a short code, then you approve it in your browser. You choose
          exactly which repositories QuizBot can read — it gets read-only access to those and nothing
          else.
        </Text>
        <Button title="Get a code" onPress={start} />
        <Button title="Cancel" onPress={() => router.back()} variant="plain" />
      </Screen>
    );
  }

  if (state.status === 'requesting_code') {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.body}>Asking GitHub for a code…</Text>
        </View>
      </Screen>
    );
  }

  if (state.status === 'awaiting_authorization') {
    const remaining = remainingMs(state, nowMs());
    return (
      <Screen>
        <Text style={styles.heading}>Enter this code on GitHub</Text>
        <UserCodeCard code={state.userCode} copied={copied} onCopy={copyCode} />

        <Button title="Open github.com/login/device" onPress={openVerificationPage} />

        <View style={styles.waitingRow}>
          <ActivityIndicator size="small" />
          <Text style={styles.waiting}>
            Waiting for you to authorize… {formatCountdown(remaining)} left
          </Text>
        </View>

        {state.networkFailures >= NETWORK_FAILURE_HINT_THRESHOLD ? (
          <Callout
            tone="warning"
            message="Having trouble reaching GitHub. Still retrying — check your connection."
          />
        ) : null}

        <Button title="Cancel" onPress={() => { cancel(); router.back(); }} variant="plain" />
      </Screen>
    );
  }

  if (state.status === 'expired') {
    return (
      <Screen>
        <Callout tone="warning" title="That code expired" message="Codes are valid for 15 minutes." />
        <Button title="Get a new code" onPress={retry} />
        <Button title="Cancel" onPress={() => router.back()} variant="plain" />
      </Screen>
    );
  }

  if (state.status === 'denied') {
    return (
      <Screen>
        <Callout
          tone="warning"
          title="Authorization cancelled"
          message="You cancelled the request on GitHub."
        />
        <Button title="Try again" onPress={retry} />
        <Button title="Back" onPress={() => router.back()} variant="plain" />
      </Screen>
    );
  }

  if (state.status === 'fatal') {
    return (
      <Screen>
        <Callout tone="danger" title="Couldn't connect to GitHub" message={state.message} />
        <Button title="Try again" onPress={retry} variant="secondary" />
        <Button title="Back" onPress={() => router.back()} variant="plain" />
      </Screen>
    );
  }

  // success / cancelled: onSuccess has already navigated, so render a spinner
  // rather than flashing a dead-end screen.
  return (
    <Screen>
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.textMuted, lineHeight: 22 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center' },
  waiting: { ...type.small, color: colors.textMuted },
});
