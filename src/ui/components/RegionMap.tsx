import {
  useMemo } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';

import { getRegionMap } from '../../quiz/geography/maps';
import type { Region } from '../../quiz/geography/types';
import { colors, radius, themedSheet, themedTokens } from '../theme';
import { useScreenScroll } from './Screen';

/**
 * A pannable, zoomable map of one region set, or a single region's outline.
 *
 * Written for the two geography question kinds rather than as a general map
 * widget, and the same three limits that keep `DraggableList` to a page keep
 * this one honest:
 *
 *  - THE DATA IS ALREADY PROJECTED. `region.d` is an SVG path in the map's own
 *    viewBox, so there is no projection, no tiles, no network and no
 *    coordinate maths here beyond a transform. See `scripts/buildGeoData.mjs`.
 *  - HIT-TESTING IS THE SVG'S JOB. Each region is a `Path` with its own
 *    `onPress`, so the shape decides what was hit. The alternative — inverting
 *    the transform and running point-in-polygon over 50 paths — is a lot of
 *    code to reimplement something the renderer already does exactly.
 *  - ONE TRANSFORM, ON THE VIEW AROUND THE SVG. Panning and zooming move a
 *    single view rather than 50 paths — and deliberately not an SVG `<G>`, for
 *    the reason spelled out at `animatedStyle`.
 *
 * `mode` is what lets one component serve both questions: `interactive` is the
 * tap-the-region map, `static` is the outline shown above a shape question.
 */

/**
 * Zoom bounds.
 *
 * Below 1 the map would float inside its own frame. The ceiling is 5 rather
 * than 8 because zooming scales an already-rendered layer (see
 * `animatedStyle`), so detail softens as it grows — 5 is about as far as the
 * coastlines hold up.
 */
const MIN_SCALE = 1;
const MAX_SCALE = 5;

/** How long the reset-on-reveal animation takes. */
const SETTLE_MS = 220;

export type RegionMapProps = {
  mapId: string;
  /**
   * Which regions to draw. Absent draws the whole map — the usual case, and
   * what a `map-locate` question passes when it names every region.
   */
  regionIds?: string[];
  mode: 'interactive' | 'static';
  /** Highlighted as the reader's current pick. */
  selectedId?: string;
  /**
   * Marked correct. Set only after grading, and drawn even when the reader got
   * it wrong — showing that you missed without showing what you missed teaches
   * nothing, which is the same rule `ChoiceRow` follows.
   */
  correctId?: string;
  onSelect?: (regionId: string) => void;
  disabled?: boolean;
  /** Height of the map frame. Width always fills the parent. */
  height?: number;
};

export function RegionMap({
  mapId,
  regionIds,
  mode,
  selectedId,
  correctId,
  onSelect,
  disabled,
  height = 320,
}: RegionMapProps) {
  const map = getRegionMap(mapId);
  // Null on a screen that does not scroll, which needs no handover.
  const setScrollEnabled = useScreenScroll()?.setScrollEnabled;

  const regions = useMemo(() => {
    if (!map) return [];
    if (!regionIds?.length) return map.regions;
    const wanted = new Set(regionIds);
    return map.regions.filter((region) => wanted.has(region.id));
  }, [map, regionIds]);

  /*
    A static figure is framed to the shape itself, not to the whole map.

    Tennessee drawn in the US viewBox is a sliver in the middle of an empty
    rectangle, and the question is "which state is this?" — so the outline has
    to fill the frame. Padded by a few percent so the shape does not touch the
    edges, which reads as clipped.
  */
  const viewBox = useMemo(() => {
    if (!map) return '0 0 1 1';
    if (mode !== 'static' || regions.length === 0) return map.viewBox.join(' ');

    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const region of regions) {
      minX = Math.min(minX, region.bbox[0]);
      minY = Math.min(minY, region.bbox[1]);
      maxX = Math.max(maxX, region.bbox[2]);
      maxY = Math.max(maxY, region.bbox[3]);
    }
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
    return [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2].join(' ');
  }, [map, mode, regions]);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  /** Frame size, needed to clamp panning to the map's own edges. */
  const frameWidth = useSharedValue(0);
  const frameHeight = useSharedValue(0);

  // Gesture start values, so a pinch scales from where it began rather than
  // snapping to 1 on every new gesture.
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  /**
   * Keeps the map covering its frame.
   *
   * Without it a pan can fling the map off screen entirely, leaving a blank
   * box with no way back — and at scale 1 there is nowhere to pan to at all,
   * so the map should simply not move.
   */
  const clamp = (value: number, limit: number) => {
    'worklet';
    return Math.min(limit, Math.max(-limit, value));
  };

  /*
    Takes the drag off the page for as long as a finger is down on the map.

    Without this the surrounding `ScrollView` and the pan are both offered the
    same vertical drag, and the page wins — the map never moves. `DraggableList`
    avoids the identical clash by demanding a long press first, which is right
    for a list and wrong here: nobody long-presses a map before dragging it.

    `onTouchesDown` rather than `onStart`, because by the time a pan has
    ACTIVATED the scroll view has usually already claimed the gesture. Released
    on finalize, which fires however the gesture ends — including when it is
    cancelled, so the page can never be left permanently frozen.
  */
  const releasePage = () => {
    'worklet';
    if (setScrollEnabled) runOnJS(setScrollEnabled)(true);
  };
  const holdPage = () => {
    'worklet';
    if (setScrollEnabled) runOnJS(setScrollEnabled)(false);
  };

  const pan = Gesture.Pan()
    .enabled(mode === 'interactive')
    .averageTouches(true)
    .onTouchesDown(holdPage)
    .onStart(() => {
      startX.value = translateX.value;
      startY.value = translateY.value;
    })
    .onUpdate((event) => {
      const limitX = (frameWidth.value * (scale.value - 1)) / 2;
      const limitY = (frameHeight.value * (scale.value - 1)) / 2;
      translateX.value = clamp(startX.value + event.translationX, limitX);
      translateY.value = clamp(startY.value + event.translationY, limitY);
    })
    .onFinalize(releasePage);

  const pinch = Gesture.Pinch()
    .enabled(mode === 'interactive')
    .onTouchesDown(holdPage)
    .onFinalize(releasePage)
    .onStart(() => {
      startScale.value = scale.value;
    })
    .onUpdate((event) => {
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * event.scale));
      scale.value = next;
      // Re-clamp as we zoom out, or the map keeps an offset it is no longer
      // wide enough to justify and drifts away from the frame.
      const limitX = (frameWidth.value * (next - 1)) / 2;
      const limitY = (frameHeight.value * (next - 1)) / 2;
      translateX.value = clamp(translateX.value, limitX);
      translateY.value = clamp(translateY.value, limitY);
    });

  /*
    Double tap to reset, because a reader who has zoomed into New England needs
    a way back that is not a dozen pinches.
  */
  const doubleTap = Gesture.Tap()
    .enabled(mode === 'interactive')
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withTiming(1, { duration: SETTLE_MS });
      translateX.value = withTiming(0, { duration: SETTLE_MS });
      translateY.value = withTiming(0, { duration: SETTLE_MS });
    });

  /*
    Pan and pinch run together — a two-finger gesture is usually both at once,
    and forcing a choice makes zooming feel like it fights you. The double tap
    is exclusive against them so the reset only fires on a clean tap.
  */
  const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pan, pinch));

  /*
    The transform goes on a plain `Animated.View` wrapping the Svg, NOT on an
    SVG `<G>`.

    This looks like a detail and is the whole reason an earlier version silently
    did nothing at all. `react-native-svg` has no Reanimated integration — it
    does not depend on it, peer-depend on it, or ship prop updaters for it — so
    an `animatedProps` transform on a `G` is written to a native view that has
    no idea what to do with it. Every gesture fired correctly and the map never
    moved, which reads from the outside as "gestures are broken".

    Animating a View's transform is Reanimated's core case and simply works. The
    cost is that zooming scales rendered output rather than re-rendering vectors,
    so the map softens as it grows; `MAX_SCALE` is set where that stops looking
    deliberate.

    Order matters: translate before scale, so a drag moves the map by the same
    number of screen pixels at every zoom level.
  */
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const onLayout = (event: LayoutChangeEvent) => {
    frameWidth.value = event.nativeEvent.layout.width;
    frameHeight.value = event.nativeEvent.layout.height;
  };

  if (!map) return null;

  const revealed = !!correctId;

  return (
    <View style={[styles.frame, { height }]} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        {/*
          `collapsable={false}` so the view survives to the native tree for
          gesture-handler to attach to.
        */}
        <Animated.View style={[styles.fill, animatedStyle]} collapsable={false}>
          <Svg width="100%" height="100%" viewBox={viewBox}>
            <G>
              {regions.map((region) => (
                <RegionPath
                  key={region.id}
                  region={region}
                  tone={toneFor({ region, selectedId, correctId, revealed })}
                  onPress={
                    mode === 'interactive' && !disabled && !revealed && onSelect
                      ? () => onSelect(region.id)
                      : undefined
                  }
                />
              ))}
            </G>
          </Svg>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

type Tone = 'idle' | 'selected' | 'correct' | 'incorrect';

function toneFor(input: {
  region: Region;
  selectedId?: string;
  correctId?: string;
  revealed: boolean;
}): Tone {
  const { region, selectedId, correctId, revealed } = input;
  if (revealed) {
    if (region.id === correctId) return 'correct';
    // Only the reader's wrong pick is marked; every other region stays neutral,
    // or the map turns into a wall of red.
    if (region.id === selectedId) return 'incorrect';
    return 'idle';
  }
  return region.id === selectedId ? 'selected' : 'idle';
}

const FILLS = themedTokens<Record<Tone, string>>(() => ({
  idle: colors.surfaceRaised,
  selected: colors.primary,
  correct: colors.success,
  incorrect: colors.danger,
}));

function RegionPath({
  region,
  tone,
  onPress,
}: {
  region: Region;
  tone: Tone;
  onPress?: () => void;
}) {
  return (
    <Path
      d={region.d}
      fill={FILLS[tone]}
      stroke={colors.background}
      /*
        In viewBox units, so it thins as the reader zooms in — which is what
        keeps borders hairline-crisp instead of growing into fat bands that
        swallow Rhode Island at 8x.
      */
      strokeWidth={1.2}
      vectorEffect="non-scaling-stroke"
      onPress={onPress}
      /*
        Explicitly inert when there is nothing to press, so a static figure
        cannot swallow a touch meant for the screen behind it. A filled path is
        hit-tested across its whole fill, which is what makes tapping the middle
        of a state work without any geometry of our own.
      */
      pointerEvents={onPress ? 'auto' : 'none'}
    />
  );
}

const styles = themedSheet(() => ({
  frame: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSunken,
  },
  fill: { flex: 1 },
}));
