import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import { Pressable, Switch, Text, View } from 'react-native';

import { Card } from '../../src/ui/components/Card';
import { Screen } from '../../src/ui/components/Screen';
import { setTerminalFx, terminalFxStore } from '../../src/ui/terminalFx';
import {
  colors,
  listThemes,
  radius,
  setTheme,
  spacing,
  themedSheet,
  type,
  useThemeName,
  type ThemeDefinition,
} from '../../src/ui/theme';

/**
 * The theme picker.
 *
 * Each row previews its OWN palette — background strip, card, accent, text —
 * drawn from the theme's static definition rather than the live tokens, so
 * every option shows what it would look like even while a different theme is
 * active. Selecting one remounts the app (see the root layout) and lands back
 * here, which is what makes trying all four in a row painless.
 */

function Swatch({ theme }: { theme: ThemeDefinition }) {
  const palette = theme.palette;
  return (
    <View style={[styles.swatch, { backgroundColor: palette.background, borderColor: palette.borderStrong }]}>
      <View style={[styles.swatchCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Text
          style={[
            styles.swatchText,
            { color: palette.text },
            theme.monospaced && styles.swatchMono,
            !theme.monospaced && theme.fontFamily ? { fontFamily: theme.fontFamily } : null,
          ]}
          numberOfLines={1}
        >
          Aa
        </Text>
        <View style={[styles.swatchAccent, { backgroundColor: palette.primary }]} />
      </View>
    </View>
  );
}

/**
 * The Terminal theme's screen-effect switches — the parts of the CRT look a
 * reader might want off while keeping the green. Shown only while Terminal is
 * the active theme: on any other theme both effects are inert, and a switch
 * that visibly does nothing reads as broken.
 */
function TerminalFxCard() {
  const fx = terminalFxStore.use();

  return (
    <Card title="Terminal effects" icon="tv-outline" accent="primary">
      <View style={styles.fxRow}>
        <View style={styles.fxText}>
          <Text style={styles.fxLabel}>CRT screen</Text>
          <Text style={styles.fxHint}>Scanlines across every screen, shaded at the corners like tube glass.</Text>
        </View>
        <Switch
          value={fx.crtScreen}
          onValueChange={(next) => setTerminalFx({ crtScreen: next })}
          accessibilityLabel="CRT screen effect"
        />
      </View>
      <View style={styles.fxRow}>
        <View style={styles.fxText}>
          <Text style={styles.fxLabel}>Typewriter</Text>
          <Text style={styles.fxHint}>Question prompts type themselves out under a blinking block cursor.</Text>
        </View>
        <Switch
          value={fx.typewriter}
          onValueChange={(next) => setTerminalFx({ typewriter: next })}
          accessibilityLabel="Typewriter effect"
        />
      </View>
    </Card>
  );
}

export default function ThemeScreen() {
  const current = useThemeName();

  return (
    <>
      <Stack.Screen options={{ title: 'Appearance' }} />
      <Screen>
        <Text style={styles.lead}>
          Changes apply straight away, everywhere. Colours — and where a theme calls for it, the
          typeface, the corners, the glow and the screen itself.
        </Text>

        {listThemes().map((theme) => {
          const selected = theme.name === current;
          return (
            <Pressable
              key={theme.name}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setTheme(theme.name)}
              style={({ pressed }) => [
                styles.row,
                selected && styles.rowSelected,
                pressed && styles.rowPressed,
              ]}
            >
              <Swatch theme={theme} />
              <View style={styles.textWrap}>
                <Text style={styles.label}>{theme.label}</Text>
                <Text style={styles.description}>{theme.description}</Text>
              </View>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={selected ? colors.primary : colors.textFaint}
              />
            </Pressable>
          );
        })}

        {current === 'terminal' ? <TerminalFxCard /> : null}
      </Screen>
    </>
  );
}

const styles = themedSheet(() => ({
  lead: { ...type.small, color: colors.textMuted, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowSelected: { borderColor: colors.primary },
  rowPressed: { backgroundColor: colors.surfaceActive },
  // A miniature page: ground, one card, one line of text, one accent bar.
  swatch: {
    width: 72,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.xs,
    justifyContent: 'flex-end',
  },
  swatchCard: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    gap: 3,
  },
  swatchText: { fontSize: 12, fontWeight: '700' },
  swatchMono: { fontFamily: type.mono.fontFamily },
  swatchAccent: { height: 4, borderRadius: radius.pill, alignSelf: 'stretch' },
  textWrap: { flex: 1, gap: 2 },
  label: { ...type.bodyStrong, color: colors.text },
  description: { ...type.small, color: colors.textMuted, lineHeight: 17 },
  fxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fxText: { flex: 1, gap: 2 },
  fxLabel: { ...type.bodyStrong, color: colors.text },
  fxHint: { ...type.small, color: colors.textMuted, lineHeight: 17 },
}));
