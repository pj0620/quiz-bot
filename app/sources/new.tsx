import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { listSourceTypes } from '../../src/sources/registry';
import { ListRow } from '../../src/ui/components/ListRow';
import { Screen } from '../../src/ui/components/Screen';
import { colors, spacing, type } from '../../src/ui/theme';

/**
 * Source-type picker, rendered entirely from the registry. Adding a second
 * source type adds a row here with no edits to this file.
 */
export default function NewSourceScreen() {
  const router = useRouter();
  const types = listSourceTypes();

  return (
    <Screen>
      <Text style={styles.intro}>Where should QuizBot read from?</Text>
      <View style={styles.list}>
        {types.map((definition) => (
          <ListRow
            key={definition.type}
            title={definition.label}
            subtitle={definition.description}
            icon={definition.icon}
            showChevron
            // replace, so Back from the connect flow returns to the sources
            // list rather than dropping the user on this picker again.
            onPress={() => router.replace(definition.connectRoute)}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { ...type.body, color: colors.textMuted, marginBottom: spacing.xs },
  list: { gap: spacing.sm },
});
