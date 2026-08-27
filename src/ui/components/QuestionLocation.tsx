import { Text } from 'react-native';

import { geographyLocationOf } from '../../quiz/geography/catalog';
import { getRegion, getRegionMap } from '../../quiz/geography/maps';
import type { Question } from '../../quiz/types';
import { Card } from './Card';
import { RegionMap } from './RegionMap';
import { colors, spacing, themedSheet, type } from '../theme';

/**
 * Where the answer actually is, shown once the question has been answered.
 *
 * This takes the place of the "From your notes" card for geography, and the
 * substitution is not cosmetic. A derived question has no note behind it: its
 * provenance path is `us-states/us-tn`, which `NoteSource` would read as a file
 * and try to fetch from a source called `geography` that does not exist. Vocab
 * needed the same escape hatch for the same reason, and the comment on that
 * branch in `app/questions/[id].tsx` says so.
 *
 * What replaces it is the thing a reader actually wants at that moment. Being
 * shown an isolated outline and told "that was Vermont" answers the question
 * without teaching the geography — knowing the shape and knowing WHERE it sits
 * are different pieces of knowledge, and the second is the one a bare outline
 * withholds. So the whole map is drawn, with the answer highlighted in it.
 */
export function QuestionLocation({ question }: { question: Question }) {
  const location = geographyLocationOf(question);
  if (!location) return null;

  /*
    A map question already ended with this exact map on screen, answer
    highlighted, from its own answer view. Drawing a second copy underneath
    would be two identical maps stacked up, so the card is skipped entirely —
    the screens still route geography past `NoteSource`, which is the other half
    of the job and the half that matters for every format.
  */
  if (question.format === 'map-locate') return null;

  const map = getRegionMap(location.mapId);
  const region = getRegion(location.mapId, location.regionId);
  if (!map || !region) return null;

  return (
    <Card tone="inset" title="Where it is">
      <RegionMap
        mapId={location.mapId}
        /*
          Interactive, so a reader who has just met Latvia can pinch in and see
          which neighbours it sits between. `correctId` also makes every region
          inert, so there is nothing here to tap by mistake.
        */
        mode="interactive"
        correctId={location.regionId}
        height={260}
      />
      {/*
        Named as well as highlighted. On the Europe map a highlighted country
        can be a few pixels across, and "somewhere in the Baltics" is not an
        answer — the label is what makes the highlight legible without zooming.
      */}
      <Text style={styles.name}>{region.name}</Text>
      <Text style={styles.map}>{map.label}</Text>
    </Card>
  );
}

const styles = themedSheet(() => ({
  name: { ...type.bodyStrong, color: colors.text, marginTop: spacing.sm },
  map: { ...type.small, color: colors.textFaint },
}));
