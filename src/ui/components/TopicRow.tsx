import { View } from 'react-native';

import { MASTERY_LABELS } from '../../quiz/srs/mastery';
import type { TopicSummary } from '../../quiz/topicStats';
import { spacing, themedSheet } from '../theme';
import { GradePill } from './GradePill';
import { ListRow } from './ListRow';
import { MasteryDot } from './MasteryDot';
import { ProgressBar } from './ProgressBar';

type Props = {
  topic: TopicSummary;
  onPress?: () => void;
};

/**
 * One topic, as the Stats tab and the "By topic" screen both list it.
 *
 * Mastery and answer count in the subtitle, with the grade shown separately.
 * They answer different questions — "how well does the schedule think you know
 * this" versus "how well have you actually answered it" — and collapsing them
 * would hide the case that matters: a topic graded A that is still mostly
 * unseen.
 */
export function TopicRow({ topic, onPress }: Props) {
  const parts = [
    MASTERY_LABELS[topic.level],
    `${topic.total} question${topic.total === 1 ? '' : 's'}`,
  ];
  if (topic.answered > 0) parts.push(`${topic.correct}/${topic.answered} right`);
  if (topic.dueNow > 0) parts.push(`${topic.dueNow} due`);

  return (
    <ListRow
      title={topic.name}
      subtitle={parts.join(' · ')}
      onPress={onPress}
      accessory={
        <View style={styles.cell}>
          <GradePill grade={topic.grade} score={topic.score} />
          <View style={styles.masteryCell}>
            <ProgressBar value={topic.mastery} height={4} />
            <MasteryDot level={topic.level} size={7} />
          </View>
        </View>
      }
    />
  );
}

const styles = themedSheet(() => ({
  cell: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  masteryCell: { width: 44, gap: spacing.xs, alignItems: 'center' },
}));
