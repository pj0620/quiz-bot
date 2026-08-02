import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import type { Outcome } from '../quiz/types';

/**
 * Haptics wrapper.
 *
 * Nothing else imports expo-haptics directly, so adding a settings toggle later
 * touches only this file. Every call is best-effort: haptics failing is never
 * worth surfacing, and the simulator has no haptic engine at all.
 */

const enabled = Platform.OS === 'ios' || Platform.OS === 'android';

async function safely(run: () => Promise<void>): Promise<void> {
  if (!enabled) return;
  try {
    await run();
  } catch {
    // Deliberately silent.
  }
}

/** Fired on reveal — most of what makes answering feel physical. */
export function answerFeedback(outcome: Outcome): Promise<void> {
  return safely(async () => {
    switch (outcome) {
      case 'correct':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'partial':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'incorrect':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  });
}

/** Light tick when selecting an option. */
export function selectTick(): Promise<void> {
  return safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}
