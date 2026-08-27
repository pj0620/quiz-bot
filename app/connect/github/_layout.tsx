import { Stack } from 'expo-router';

import { stackScreenOptions } from '../../../src/ui/navigation/screenOptions';

export default function ConnectGitHubLayout() {
  return (
    <Stack screenOptions={stackScreenOptions()}>
      <Stack.Screen name="index" options={{ title: 'Connect GitHub' }} />
      <Stack.Screen name="install" options={{ title: 'Choose repositories' }} />
      <Stack.Screen name="repos" options={{ title: 'Pick repositories' }} />
    </Stack>
  );
}
