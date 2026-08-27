import { Pressable, Text, View } from 'react-native';

import { colors, radius, spacing, themedSheet, type } from '../theme';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

/** Used in the quiz editor for mix and difficulty selection. */
export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.track}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.selectedSegment,
              pressed && !selected && styles.pressed,
            ]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedSheet(() => ({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    minHeight: 38,
    borderRadius: radius.sm,
  },
  selectedSegment: { backgroundColor: colors.primary },
  pressed: { backgroundColor: colors.surfaceAlt },
  label: { ...type.small, color: colors.textMuted, fontWeight: '600' },
  selectedLabel: { color: colors.primaryText },
}));
