import { useCallback, useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * A short vertical list whose rows can be dragged into a different order.
 *
 * Written for the timeline question rather than as a general-purpose library,
 * and three deliberate limits are what keep it to a page:
 *
 *  - FIXED ROW HEIGHT. Every row is `rowHeight` tall, so the slot a finger is
 *    over is `translationY / (rowHeight + gap)` and there is no measurement
 *    pass, no layout race, and nothing to re-measure when content changes. At
 *    six rows this costs nothing.
 *  - LONG-PRESS TO PICK UP. The screens this appears on are ScrollViews, and a
 *    pan that activated on touch would fight vertical scrolling — the list
 *    would either steal every scroll or never drag. Requiring a long press is
 *    both the fix and the platform's own reorder idiom.
 *  - NO AUTO-SCROLL AT THE EDGES. The whole list fits on screen at these
 *    sizes, so there is nowhere to scroll to.
 *
 * Kept in its own module rather than inlined so that nothing which only needs
 * question LOGIC ends up importing Reanimated through a barrel.
 */

const SHIFT_MS = 160;
const LIFT_MS = 120;
const RETURN_MS = 140;

/**
 * How far a row that is NOT being dragged should move, in slots.
 *
 * Everything between the row's home and where the finger now is has to shuffle
 * one place towards the vacated slot. Without this the list only rearranges on
 * release, so there is no gap to aim at and the drop feels like a guess.
 */
function shiftFor(active: number, target: number, index: number): number {
  'worklet';
  if (active < 0 || index === active) return 0;
  if (active < target && index > active && index <= target) return -1;
  if (active > target && index < active && index >= target) return 1;
  return 0;
}

type Props<T> = {
  items: readonly T[];
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** Receives the full list of keys in their new order. */
  onReorder: (keys: string[]) => void;
  rowHeight: number;
  /**
   * Vertical space between rows. Explicit rather than assumed, because anything
   * rendered ALONGSIDE the list — a timeline rail, a column of numbers — has to
   * use the same value or it drifts out of alignment by a pixel per row.
   */
  gap: number;
  /** Renders as a plain, inert list — the read-only and post-reveal states. */
  disabled?: boolean;
  style?: ViewStyle;
};

export function DraggableList<T>({
  items,
  keyOf,
  renderItem,
  onReorder,
  rowHeight,
  gap,
  disabled = false,
  style,
}: Props<T>) {
  const step = rowHeight + gap;

  /*
    Which row is held, and which slot it is currently over. Shared rather than
    React state because every row reads them on the UI thread on every frame of
    a drag — routing that through a re-render would drop the animation to
    whatever the JS thread can manage.
  */
  const activeIndex = useSharedValue(-1);
  const targetIndex = useSharedValue(-1);
  /** 0..1 as a drag is picked up, so the other rows fade rather than blink. */
  const dragProgress = useSharedValue(0);

  const keys = items.map(keyOf).join('|');

  /*
    Cleared when the ORDER changes, not when the finger lifts.

    This is what makes the drop seamless. On release each row is displaced by
    exactly one slot from its old position — which is the same pixel as zero
    displacement from its new one. Clearing here means the re-render and the
    reset land in the same commit, so the rows never flick back to where they
    started before jumping to where they belong.
  */
  useEffect(() => {
    activeIndex.value = -1;
    targetIndex.value = -1;
  }, [keys, activeIndex, targetIndex]);

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to) return;
      const next = items.map(keyOf);
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      onReorder(next);
    },
    [items, keyOf, onReorder],
  );

  return (
    <View style={[{ gap }, style]}>
      {items.map((item, index) => (
        <DraggableRow
          key={keyOf(item)}
          index={index}
          count={items.length}
          rowHeight={rowHeight}
          step={step}
          activeIndex={activeIndex}
          targetIndex={targetIndex}
          dragProgress={dragProgress}
          disabled={disabled}
          onMove={move}
        >
          {renderItem(item, index)}
        </DraggableRow>
      ))}
    </View>
  );
}

type RowProps = {
  index: number;
  count: number;
  rowHeight: number;
  /** Row height plus the gap — the distance a finger travels per slot. */
  step: number;
  activeIndex: SharedValue<number>;
  targetIndex: SharedValue<number>;
  dragProgress: SharedValue<number>;
  disabled: boolean;
  onMove: (from: number, to: number) => void;
  children: React.ReactNode;
};

function DraggableRow({
  index,
  count,
  rowHeight,
  step,
  activeIndex,
  targetIndex,
  dragProgress,
  disabled,
  onMove,
  children,
}: RowProps) {
  const offset = useSharedValue(0);
  const lifted = useSharedValue(0);
  /*
    Set when `onEnd` has parked this row at its landing slot.

    `onFinalize` runs AFTER `onEnd`, and its job is to clean up a gesture that
    was cancelled rather than completed. Without this flag it would also fire on
    a successful drop and animate the offset back to zero — undoing the exact
    placement that makes the hand-off to the re-render invisible.
  */
  const committed = useSharedValue(false);

  /*
    Zeroed once this row has actually MOVED in the list.

    Same continuity trick as the reset above: `onEnd` parks the held row at its
    landing slot as an offset from where it used to be, and the re-render puts
    it there for real. Both describe the same pixel, so swapping one for the
    other is invisible.
  */
  useEffect(() => {
    offset.value = 0;
  }, [index, offset]);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    // Long enough not to trigger while scrolling past, short enough to feel
    // like a deliberate pick-up rather than a wait.
    .activateAfterLongPress(220)
    .onStart(() => {
      committed.value = false;
      activeIndex.value = index;
      targetIndex.value = index;
      lifted.value = withTiming(1, { duration: LIFT_MS });
      dragProgress.value = withTiming(1, { duration: LIFT_MS });
    })
    .onUpdate((event) => {
      offset.value = event.translationY;
      // Clamped, so dragging past either end aims at the end rather than at an
      // index the list does not have.
      const slots = Math.round(event.translationY / step);
      targetIndex.value = Math.max(0, Math.min(count - 1, index + slots));
    })
    .onEnd(() => {
      const to = targetIndex.value;
      lifted.value = withTiming(0, { duration: RETURN_MS });
      dragProgress.value = withTiming(0, { duration: RETURN_MS });

      if (to === index) {
        // Nothing to commit, so nothing will re-render — ease it back into the
        // slot it never left rather than snapping.
        offset.value = withTiming(0, { duration: RETURN_MS });
        activeIndex.value = -1;
        targetIndex.value = -1;
        return;
      }

      // Instant, not animated: this is the row's final resting pixel, and the
      // re-render is about to express it as a layout change instead.
      committed.value = true;
      offset.value = (to - index) * step;
      runOnJS(onMove)(index, to);
    })
    .onFinalize(() => {
      // Covers cancellation — a gesture interrupted by a navigation or an
      // incoming call never reaches `onEnd`, and the row would stay lifted.
      if (committed.value || activeIndex.value !== index) return;
      offset.value = withTiming(0, { duration: RETURN_MS });
      lifted.value = withTiming(0, { duration: RETURN_MS });
      dragProgress.value = withTiming(0, { duration: RETURN_MS });
      activeIndex.value = -1;
      targetIndex.value = -1;
    });

  const animatedStyle = useAnimatedStyle(() => {
    const active = activeIndex.value;

    if (active === index) {
      return {
        transform: [{ translateY: offset.value }, { scale: 1 + lifted.value * 0.03 }],
        // Raised above its neighbours only while held, so the dragged row
        // passes over the others rather than under them.
        zIndex: 10,
        opacity: 1,
      };
    }

    // The rows getting out of the way recede slightly, so the held one reads as
    // the thing being moved. Driven by `dragProgress` rather than switched on
    // and off, or picking a row up would blink the whole list.
    const opacity = 1 - dragProgress.value * 0.25;

    // No drag in progress: sit still. The translate is deliberately NOT
    // animated — by the time this is reached, the layout has already absorbed
    // the reorder, and easing to zero from here would replay the move.
    if (active < 0) {
      return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, opacity };
    }

    return {
      transform: [
        {
          translateY: withTiming(shiftFor(active, targetIndex.value, index) * step, {
            duration: SHIFT_MS,
          }),
        },
        { scale: 1 },
      ],
      zIndex: 0,
      opacity,
    };
  });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.row, { height: rowHeight }, animatedStyle]}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Motion only. How a row LOOKS is the caller's business — this component owns
  // where a row is, not what it is.
  row: { justifyContent: 'center' },
});
