import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  } from 'react';
import { RefreshControl,
  ScrollView,
  View,
} from 'react-native';

import { colors, spacing, themedSheet } from '../theme';

/**
 * Anything that can report where it is on screen — a `View` ref, in practice.
 * Narrowed to the one method needed so callers aren't tied to a component type.
 */
export type Measurable = {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
};

export type ScreenScroll = {
  /**
   * Scrolls the page so `target` sits near the top of the viewport.
   *
   * Offered through context rather than a ref prop because the component that
   * needs it is usually several layers down inside a card, and threading a ref
   * through every screen to reach it would be noise on screens that never use
   * it. Silently does nothing when the measurement fails — bringing something
   * into view is a courtesy, never load-bearing.
   */
  scrollIntoView(target: Measurable | null, offsetFromTop?: number): void;

  /**
   * Hands the drag to something embedded in the page, for as long as it needs
   * it.
   *
   * Exists for the map. A pannable surface inside a scrolling page is a genuine
   * conflict rather than a styling problem: a vertical drag is a legitimate
   * instruction to both, and whoever claims it first wins. `DraggableList`
   * solves the same clash by requiring a long press, which is right for a list
   * of six rows and wrong for a map — nobody long-presses a map before moving
   * it.
   *
   * So the map switches the page off while a finger is down on it, and back on
   * when the gesture finishes. Offered through context for the same reason as
   * `scrollIntoView`: the component that needs it is several layers down, and
   * two screens own scroll views it would otherwise have to be threaded through.
   */
  setScrollEnabled(enabled: boolean): void;
};

const ScreenScrollContext = createContext<ScreenScroll | null>(null);

export function useScreenScroll(): ScreenScroll | null {
  return useContext(ScreenScrollContext);
}

/** Room left above the target, so it doesn't sit flush against the header. */
const DEFAULT_OFFSET = 24;

/**
 * Scroll-into-view for a scroll view the caller owns.
 *
 * Split out of `Screen` because the quiz player lays itself out by hand — a top
 * bar, a scrolling middle, a fixed action bar — and so has its own `ScrollView`.
 * That is also the screen where bringing a highlight into view matters most, so
 * this could not live only inside `Screen`.
 *
 * The caller must render the returned `anchor` inside the scroll content. It is
 * how a position on screen is converted into a position in the content:
 * `ScrollView` exposes neither its own position nor its current offset, but an
 * element pinned to the top of the content answers both at once — a target's
 * offset in the content is simply how far below that anchor it sits, whatever
 * the view is currently scrolled to.
 */
export function useScrollAnchor(): {
  scroll: ScreenScroll;
  listRef: React.RefObject<ScrollView | null>;
  anchor: ReactNode;
  /** Pass to the caller's own `ScrollView`. See `ScreenScroll.setScrollEnabled`. */
  scrollEnabled: boolean;
} {
  const listRef = useRef<ScrollView>(null);
  const topRef = useRef<View>(null);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  const scrollIntoView = useCallback((target: Measurable | null, offsetFromTop = DEFAULT_OFFSET) => {
    const list = listRef.current;
    const top = topRef.current;
    if (!target || !list || !top) return;

    top.measureInWindow((_topX, topY) => {
      target.measureInWindow((_targetX, targetY) => {
        if (!Number.isFinite(topY) || !Number.isFinite(targetY)) return;
        list.scrollTo({ y: Math.max(0, targetY - topY - offsetFromTop), animated: true });
      });
    });
  }, []);

  const scroll = useMemo<ScreenScroll>(
    () => ({ scrollIntoView, setScrollEnabled }),
    [scrollIntoView],
  );

  /*
    Absolutely positioned, so it takes part in no layout at all — a zero-height
    flex child would still pick up the content container's `gap` and push
    everything down by one step.
  */
  const anchor = (
    <View ref={topRef} style={styles.anchor} pointerEvents="none" collapsable={false} />
  );

  return { scroll, listRef, anchor, scrollEnabled };
}

/** Publishes a scroll anchor to everything rendered inside it. */
export function ScreenScrollProvider({
  scroll,
  children,
}: {
  scroll: ScreenScroll | null;
  children: ReactNode;
}) {
  return <ScreenScrollContext.Provider value={scroll}>{children}</ScreenScrollContext.Provider>;
}

type Props = {
  children: ReactNode;
  scroll?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  padded?: boolean;
};

export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  padded = true,
}: Props) {
  const { scroll: api, listRef, anchor, scrollEnabled } = useScrollAnchor();

  if (!scroll) {
    return (
      <ScreenScrollProvider scroll={null}>
        <View style={[styles.container, padded && styles.padded]}>{children}</View>
      </ScreenScrollProvider>
    );
  }

  return (
    <ScreenScrollProvider scroll={api}>
      <ScrollView
        ref={listRef}
        scrollEnabled={scrollEnabled}
        style={styles.container}
        contentContainerStyle={[padded && styles.padded, styles.scrollContent]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            // Without an explicit tint the spinner renders near-black and is
            // effectively invisible against the dark background.
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textMuted}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          ) : undefined
        }
      >
        {anchor}
        {children}
      </ScrollView>
    </ScreenScrollProvider>
  );
}

const styles = themedSheet(() => ({
  container: { flex: 1, backgroundColor: colors.background },
  // Less padding above than beside: the navigation header already provides
  // separation at the top, so repeating it there just wastes a scroll.
  padded: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scrollContent: { paddingBottom: spacing.xl, gap: spacing.md },
  anchor: { position: 'absolute', top: 0, left: 0, width: 0, height: 0 },
}));
