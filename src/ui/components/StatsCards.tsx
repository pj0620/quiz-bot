import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { addDays } from '../../lib/day';
import { MASTERY_LABELS } from '../../quiz/srs/mastery';
import { overallMastery, type Stats } from '../../quiz/stats';
import { colors, spacing, themedSheet, type } from '../theme';
import { BarChart } from './BarChart';
import { Card } from './Card';
import { MASTERY_COLORS } from './MasteryDot';
import { ProgressBar } from './ProgressBar';
import { ScoreDots } from './ScoreDots';
import { SegmentedBar } from './SegmentedBar';

/**
 * The three progress cards, shared by the Stats tab and the per-topic screen.
 *
 * One component per card rather than one component for all three, so a screen
 * can still put things between them and give the mastery card an accessory
 * without the others growing props they have no use for. Each takes the whole
 * `Stats` value rather than the slice it draws, because that is what both
 * screens already hold — and it keeps the call sites to a line.
 */

const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function weekdayLabel(now: number, dayOffset: number): string {
  return WEEKDAY[new Date(addDays(now, dayOffset)).getDay()];
}

type MasteryCardProps = {
  stats: Stats;
  /** Right-aligned in the title row — the Stats tab's "By topic" link. */
  titleAccessory?: ReactNode;
  /** Makes the whole card a button; see `Card`. */
  onPress?: () => void;
};

/** "What you know": the mastery percentage and how the bank divides up. */
export function MasteryCard({ stats, titleAccessory, onPress }: MasteryCardProps) {
  const mastered = overallMastery(stats.mastery);

  return (
    <Card
      title="What you know"
      icon="school-outline"
      accent="violet"
      titleAccessory={titleAccessory}
      onPress={onPress}
    >
      <View style={styles.masteryHead}>
        <Text style={styles.big}>{Math.round(mastered * 100)}%</Text>
        <Text style={styles.hint}>
          across {stats.bankTotal} question{stats.bankTotal === 1 ? '' : 's'}
        </Text>
      </View>
      <ProgressBar value={mastered} height={8} />
      <SegmentedBar
        segments={stats.mastery.map((slice) => ({
          label: MASTERY_LABELS[slice.level],
          value: slice.count,
          color: MASTERY_COLORS[slice.level],
        }))}
      />
    </Card>
  );
}

type WindowProps = {
  stats: Stats;
  /** The same clock the stats were computed with, so weekday labels line up. */
  now: number;
};

/** "Reviews, last 14 days": how much was answered, day by day. */
export function ActivityCard({ stats, now }: WindowProps) {
  return (
    <Card title="Reviews, last 14 days" icon="bar-chart-outline" accent="teal">
      <BarChart
        bars={stats.activity.map((day) => ({
          value: day.reviewed,
          label: weekdayLabel(now, day.dayOffset),
          highlight: day.dayOffset === 0,
        }))}
        maxLabel={`peak ${Math.max(...stats.activity.map((day) => day.reviewed), 0)}`}
        emptyMessage="No reviews in the last two weeks"
      />
      <Text style={styles.hint}>
        {stats.reviewedToday > 0
          ? `${stats.reviewedToday} answered today`
          : 'Nothing answered today yet'}
      </Text>
    </Card>
  );
}

type ScoreCardProps = WindowProps & {
  /**
   * The "ready to review now" line. Off where the screen already states the
   * due count in its headline row, so the number is not said twice.
   */
  showDue?: boolean;
};

/** "How you scored": a grade per day for the last week. */
export function ScoreCard({ stats, now, showDue = true }: ScoreCardProps) {
  return (
    <Card title="How you scored" icon="ribbon-outline" accent="amber">
      <ScoreDots
        days={stats.week.map((day) => ({
          label: weekdayLabel(now, day.dayOffset),
          score: day.score,
          grade: day.grade,
          highlight: day.dayOffset === 0,
        }))}
      />
      <Text style={styles.hint}>
        Percent correct each day. Grey means you didn&rsquo;t study that day.
      </Text>
      {showDue && stats.dueNow > 0 ? (
        <Text style={styles.hint}>{stats.dueNow} ready to review now</Text>
      ) : null}
    </Card>
  );
}

const styles = themedSheet(() => ({
  masteryHead: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  big: { ...type.title, color: colors.text },
  hint: { ...type.small, color: colors.textMuted, lineHeight: 18 },
}));
