import { useEffect, useState } from 'react';
import { AccessibilityInfo, Text, type StyleProp, type TextStyle } from 'react-native';

import { useTypewriter } from '../terminalFx';
import { colors, themedSheet } from '../theme';

/**
 * Text that types itself out under a blinking block cursor, the way the
 * machine the Terminal theme imitates would have printed it.
 *
 * Outside Terminal (or with the effect switched off, or with the system's
 * reduce-motion set) it renders a plain `Text` — so callers use it wherever
 * the effect belongs and never gate it themselves.
 *
 * The typing must not reflow the page: revealing a wrapped paragraph one
 * character at a time re-wraps it every tick, and answer options below the
 * prompt would crawl down the screen as it grew. So the FULL text is laid out
 * from the first frame, with the unrevealed remainder painted transparent —
 * the boundary between visible and invisible is what moves. The cursor stands
 * in the first unrevealed cell, which only works because every Terminal
 * glyph — █ included — is one monospace cell wide; under a proportional face
 * the substitution would jiggle, which is one more reason this renders plain
 * in every other theme.
 *
 * The cursor blinks a few beats after the line completes and then retires,
 * settling to a plain selectable `Text`. Selection is withheld until then: a
 * copy taken mid-type would include the cursor block and the invisible tail.
 */

/** One tick of the printer. ~83 characters a second at 2 per tick. */
const TICK_MS = 24;
/** The classic cursor cadence. */
const BLINK_MS = 500;
/** Toggles after typing completes before the cursor retires — three blinks. */
const PARTING_BLINKS = 6;
/** Long prompts speed up so nothing takes over ~1.5s to print. */
const MAX_TICKS = 60;

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  /** Honoured once the animation has settled; see above. */
  selectable?: boolean;
};

export function TypewriterText({ text, style, selectable = false }: Props) {
  const wanted = useTypewriter();
  const [reduceMotion, setReduceMotion] = useState(false);
  const enabled = wanted && !reduceMotion;

  const [shownCount, setShownCount] = useState(enabled ? 0 : text.length);
  const [cursorOn, setCursorOn] = useState(true);
  const [settled, setSettled] = useState(!enabled);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduceMotion(value);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSettled(true);
      return;
    }

    setShownCount(0);
    setCursorOn(true);
    setSettled(false);

    const step = Math.max(2, Math.ceil(text.length / MAX_TICKS));
    let count = 0;
    let blink: ReturnType<typeof setInterval> | undefined;

    const typing = setInterval(() => {
      count = Math.min(text.length, count + step);
      setShownCount(count);
      if (count < text.length) return;

      clearInterval(typing);
      let toggles = 0;
      blink = setInterval(() => {
        toggles += 1;
        setCursorOn((visible) => !visible);
        if (toggles >= PARTING_BLINKS && blink) {
          clearInterval(blink);
          setSettled(true);
        }
      }, BLINK_MS);
    }, TICK_MS);

    return () => {
      clearInterval(typing);
      if (blink) clearInterval(blink);
    };
  }, [text, enabled]);

  if (settled) {
    return (
      <Text style={style} selectable={selectable}>
        {text}
      </Text>
    );
  }

  const rest = text.slice(shownCount);
  return (
    // The full text at once for screen readers — the animation is visual only.
    <Text style={style} accessibilityLabel={text}>
      {text.slice(0, shownCount)}
      <Text style={cursorOn ? styles.cursor : styles.ghost}>█</Text>
      {rest.length > 1 ? <Text style={styles.ghost}>{rest.slice(1)}</Text> : null}
    </Text>
  );
}

const styles = themedSheet(() => ({
  cursor: { color: colors.primary },
  /*
    Transparent colour is not enough: nested runs inherit the parent's
    phosphor glow (see `buildType`), and invisible glyphs casting a green
    bloom would ghost the whole unrevealed line onto the screen.
  */
  ghost: { color: 'transparent', textShadowColor: 'transparent', textShadowRadius: 0 },
}));
