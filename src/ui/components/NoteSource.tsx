import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator,
  Pressable,
  Text,
  View,
} from 'react-native';

import { excerptAround, notePassages } from '../../notes/highlight';
import { fetchNoteText, getCachedNoteText } from '../../notes/noteText';
import { noteFilename } from '../../notes/paths';
import { userMessage } from '../../lib/errors';
import type { Provenance } from '../../quiz/types';
import { CopyButton } from './CopyButton';
import { useScreenScroll } from './Screen';
import { colors, radius, spacing, themedSheet, type } from '../theme';

/** How much of the note the collapsed view shows, centred on the highlight. */
const COLLAPSED_CHARS = 700;

type Props = {
  provenance: Provenance;
};

/**
 * The note a question came from, with the passage it used highlighted.
 *
 * Replaces a fixed 600-character slice of the top of the note, which was almost
 * never where the question came from — so the reader was shown an unrelated
 * paragraph and asked to take the attribution on trust.
 *
 * The highlight has to be visible WITHOUT expanding, and that is the whole
 * difficulty. Questions store only a short excerpt of the note's opening, so
 * windowing that excerpt around the quote does nothing: the quote is not in it.
 * The note itself is therefore fetched as soon as a question with a quote is
 * shown, and the collapsed view re-centres on the real match when it arrives.
 * The stored excerpt renders in the meantime, so there is never a blank or a
 * spinner where the note should be.
 */
export function NoteSource({ provenance }: Props) {
  const { path, quote, excerpt, noteTitle, section, revision, sourceId } = provenance;
  const filename = path ? noteFilename(path) : undefined;
  const screen = useScreenScroll();

  const [expanded, setExpanded] = useState(false);
  const [fullText, setFullText] = useState<string | undefined>(() =>
    path ? getCachedNoteText({ sourceId, path, revision }) : undefined,
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const highlightRef = useRef<View>(null);
  /** Set when expanding, cleared once the highlight has been scrolled to. */
  const pendingScroll = useRef(false);

  /*
    Fetched up front, but only when there is a quote to find.

    Without the note there is nothing to centre on, and a question whose
    provenance carries no quote gains nothing from the request — it would render
    identically from the stored excerpt.

    Deliberately NOT aborted on unmount. `fetchNoteText` shares one in-flight
    request per note, so aborting here would fail it for anything else waiting
    on it, and the reply is worth caching even if this component has gone.
  */
  useEffect(() => {
    if (!path || !quote || fullText !== undefined) return;

    let cancelled = false;
    fetchNoteText({ sourceId, path, revision })
      .then((text) => {
        if (!cancelled) setFullText(text);
      })
      // Silent: the stored excerpt is still shown, and nobody asked for this.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [path, quote, sourceId, revision, fullText]);

  const toggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);
    // Expanding puts everything above the quote back on screen, pushing the
    // highlight down out of view. Scrolling to it is what stops the reader
    // having to hunt for the passage they were already looking at.
    pendingScroll.current = true;

    if (fullText !== undefined || !path) return;

    setLoading(true);
    setLoadError(null);
    try {
      setFullText(await fetchNoteText({ sourceId, path, revision }));
    } catch (error) {
      // Staying expanded on failure: collapsing would look like the tap missed,
      // and the stored excerpt below is still worth reading.
      setLoadError(userMessage(error));
    } finally {
      setLoading(false);
    }
  }, [expanded, fullText, path, sourceId, revision]);

  /**
   * Fires once the highlighted passage has a position, which is the earliest
   * moment it can be scrolled to — the note may have arrived over the network
   * several frames after the tap.
   */
  const onHighlightLayout = useCallback(() => {
    if (!pendingScroll.current) return;
    pendingScroll.current = false;
    screen?.scrollIntoView(highlightRef.current);
  }, [screen]);

  /*
    The full note once expanded; otherwise a window centred on the quote, taken
    from the note if it has arrived and from the stored excerpt if not.
  */
  const body = useMemo(() => {
    if (expanded && fullText !== undefined) {
      return { text: fullText, clippedStart: false, clippedEnd: false };
    }
    const windowed = excerptAround(fullText ?? excerpt ?? '', quote, COLLAPSED_CHARS);
    return {
      text: windowed.text,
      clippedStart: windowed.clippedStart,
      clippedEnd: windowed.clippedEnd,
    };
  }, [expanded, fullText, excerpt, quote]);

  const passages = useMemo(() => notePassages(body.text, quote), [body.text, quote]);
  const caption = [noteTitle, section].filter(Boolean).join(' › ');
  const canExpand = !!path;

  return (
    <View style={styles.wrapper}>
      <View style={styles.header}>
        <Ionicons name="document-text-outline" size={14} color={colors.textMuted} />
        <Text style={styles.caption} numberOfLines={2}>
          {caption || filename || 'Unknown note'}
        </Text>

        {filename ? (
          // The filename, not the repository path: it's what you type into the
          // quick-switcher in a notes app to open this note.
          <CopyButton
            label="Copy name"
            accessibilityLabel={`Copy note name ${filename}`}
            text={filename}
          />
        ) : null}
      </View>

      <View style={styles.quote}>
        {body.clippedStart ? <Text style={styles.ellipsis}>…</Text> : null}

        {passages.length === 0 ? (
          <Text style={styles.text}>(no readable text in this note)</Text>
        ) : (
          passages.map((passage, index) => (
            <View
              key={index}
              // Only the passage the highlight starts in is a scroll target;
              // the rest are plain blocks and need no identity.
              ref={passage.startsHighlight ? highlightRef : undefined}
              onLayout={passage.startsHighlight ? onHighlightLayout : undefined}
              collapsable={false}
            >
              <Text style={styles.text} selectable>
                {passage.segments.map((segment, segmentIndex) =>
                  segment.highlighted ? (
                    <Text key={segmentIndex} style={styles.highlight}>
                      {segment.text}
                    </Text>
                  ) : (
                    <Text key={segmentIndex}>{segment.text}</Text>
                  ),
                )}
              </Text>
            </View>
          ))
        )}

        {body.clippedEnd ? <Text style={styles.ellipsis}>…</Text> : null}
      </View>

      {loadError ? <Text style={styles.error}>{loadError}</Text> : null}

      {canExpand ? (
        <Pressable
          accessibilityRole="button"
          onPress={toggle}
          style={({ pressed }) => [styles.expandButton, pressed && styles.pressed]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={15}
              color={colors.primary}
            />
          )}
          <Text style={styles.expandLabel}>
            {loading ? 'Loading note…' : expanded ? 'Show less' : 'Read the full note'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themedSheet(() => ({
  wrapper: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  caption: { ...type.smallStrong, color: colors.textMuted, flex: 1 },
  pressed: { opacity: 0.6 },
  quote: {
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    // A quote rule, so the note reads as the writer's own words rather than as
    // more of the app's copy.
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    // Replaces the blank lines the note's own text used to carry, now that it
    // is split into passages rather than rendered as one block.
    gap: spacing.sm,
  },
  text: { ...type.body, color: colors.text, lineHeight: 24 },
  /*
    A tinted background rather than coloured text.

    The highlighted run is the writer's own prose and has to stay as readable as
    the rest of it; recolouring the words themselves would make the passage the
    question came from harder to read than the material around it.
  */
  highlight: {
    backgroundColor: colors.highlightSurface,
    color: colors.text,
    fontWeight: '600',
  },
  ellipsis: { ...type.small, color: colors.textFaint },
  error: { ...type.small, color: colors.danger },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  expandLabel: { ...type.smallStrong, color: colors.primary },
}));
