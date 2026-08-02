import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, type } from '../theme';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  /** Trailing count, e.g. a topic's question total. */
  count?: number;
  icon?: keyof typeof Ionicons.glyphMap;
};

export function Chip({ label, selected = false, onPress, count, icon }: ChipProps) {
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={14} color={selected ? colors.primaryText : colors.textMuted} /> : null}
      <Text style={[styles.label, selected && styles.selectedLabel]} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text style={[styles.count, selected && styles.selectedCount]}>{count}</Text>
      ) : null}
    </>
  );

  if (!onPress) {
    return <View style={[styles.chip, selected && styles.selected]}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

type GroupProps = {
  children: React.ReactNode;
  /** Horizontal scroll for long filter rows; wrap for static tag lists. */
  scroll?: boolean;
};

export function ChipGroup({ children, scroll = false }: GroupProps) {
  if (!scroll) return <View style={styles.wrapGroup}>{children}</View>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scrollGroup}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 34,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  pressed: { opacity: 0.7 },
  label: { ...type.small, color: colors.text },
  selectedLabel: { color: colors.primaryText, fontWeight: '600' },
  count: { ...type.small, color: colors.textFaint },
  selectedCount: { color: colors.primaryText, opacity: 0.8 },
  wrapGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scrollGroup: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.lg },
});
