import {
  BackButton,
  BarChart,
  CardHeading,
  GlassCard,
  HeaderMeta,
  HeadingAvg,
  Label,
  MetricValue,
  ProgressBar,
  RangeSelector,
  Screen,
  ScoreRing,
  ScreenHeader,
  Sparkline,
  StatBlock,
  StatRow,
  Txt,
  fontFamily,
  gradients,
  palette,
  progressGradients,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { EmptyDataCard } from '@/components/EmptyDataCard';
import { useDataset, useDays, useMaturities, useToday } from '@/data/hooks';
import { MATURITY_COPY } from '@/data/maturity';
import {
  fmtDate,
  fmtHoursMinutes,
  hourlyMovement,
  meanOf,
  movementByRange,
  rangeAxisLabels,
  TIME_RANGE_OPTIONS,
  type TimeRange,
} from '@/data/selectors';

function movementColor(v: number): string | null {
  if (v <= 0.18) return null;
  if (v > 0.8) return palette.peach.deep;
  if (v > 0.55) return palette.peach.mid;
  if (v > 0.32) return palette.peach.light;
  return palette.peach.pale;
}

export default function ActivityScreen() {
  const router = useRouter();
  const today = useToday();
  const days = useDays();
  const dataset = useDataset();
  const maturities = useMaturities();

  const [range, setRange] = useState<TimeRange>('day');

  // Charts anchor to the dataset's current day (any time inside it works),
  // so a stale sync still shows the last recorded day instead of emptiness.
  const anchorMs = today?.dayStart ?? Date.now();
  const dayMovement = useMemo(
    () => (today ? hourlyMovement(dataset, anchorMs) : new Array(24).fill(0)),
    [dataset, today, anchorMs],
  );
  const movement = useMemo(
    () =>
      range === 'day' ? dayMovement : movementByRange(dataset.series.move, range, anchorMs),
    [dataset, range, anchorMs, dayMovement],
  );

  // Without any movement/calorie data the rings and bars would all be fake
  // zeros — stay an honest empty state until the first daytime sync.
  if (today == null || maturities.activity.state !== 'ready') {
    return (
      <Screen aura="activity">
        <ScreenHeader title="Activity" left={<BackButton onPress={() => router.back()} />} />
        <EmptyDataCard
          art="activity"
          tint="peach"
          title="No activity yet"
          message={MATURITY_COPY.activity.empty}
        />
      </Screen>
    );
  }

  // The group gate above is dataset-wide: TODAY itself may still have no
  // movement/calorie data (e.g. only a night sync so far). Per-field zeros
  // from an unmeasured day render as numeric 0, never as invented numbers.
  const hasTodayActivity = today.activity.activeCal > 0 || dayMovement.some((v) => v > 0);

  // The week average skips days whose 0 score means "nothing measured".
  const weekScores = days.slice(-7).map((d) => d.activityScore).filter((v) => v > 0);
  const weekAvg = meanOf(weekScores);

  // Defensive: a 0/missing goal would make this NaN or Infinity.
  const goalPct =
    today.activity.goalCal > 0
      ? Math.min(1, today.activity.activeCal / today.activity.goalCal)
      : null;
  const showGoal = goalPct != null && hasTodayActivity;

  return (
    <Screen aura="activity">
      <ScreenHeader
        title="Activity"
        left={<BackButton onPress={() => router.back()} />}
        right={<HeaderMeta>{fmtDate(today.dayStart)}</HeaderMeta>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard tint="peach" contentStyle={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
            <ScoreRing size={118} value={hasTodayActivity ? today.activityScore : 0} colors={gradients.activity} strokeWidth={8}>
              <Text style={{ fontSize: 30, fontFamily: fontFamily.light, color: hasTodayActivity ? palette.ink : palette.muted }}>
                {hasTodayActivity ? today.activityScore : '0'}
              </Text>
              <Txt role="caption">Score</Txt>
            </ScoreRing>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Label>Active calories</Label>
              <MetricValue
                variant="hero"
                value={today.activity.activeCal > 0 ? String(today.activity.activeCal) : '0'}
                unit="cal"
              />
              {showGoal ? (
                <>
                  <Txt role="caption">
                    {`${Math.round(goalPct * 100)}% of your ${today.activity.goalCal} cal goal`}
                  </Txt>
                  <ProgressBar
                    progress={goalPct}
                    colors={progressGradients.activity}
                    delay={450}
                    style={{ marginTop: 8 }}
                  />
                </>
              ) : (
                <Txt role="caption">{`Goal ${today.activity.goalCal} cal`}</Txt>
              )}
            </View>
          </View>
          {/* Steps/distance are never measured (see computeActivity in
              scores.ts) — a hardcoded 0, not an invented estimate. */}
          <StatRow>
            <StatBlock value="0" label="Steps" />
            <StatBlock value="0 km" label="Distance" />
          </StatRow>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(500)}>
        <GlassCard contentStyle={{ gap: 16 }}>
          <CardHeading icon="walk" tint="peach">Movement</CardHeading>
          <BarChart
            data={movement}
            height={70}
            colorFor={movementColor}
            delay={250}
            xLabels={rangeAxisLabels(range, anchorMs)}
          />
          <RangeSelector
            options={TIME_RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            style={{ marginTop: 8 }}
          />
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(500)}>
        <GlassCard tint="lavender" contentStyle={{ gap: 16 }}>
          <CardHeading icon="timer-sand" tint="lavender">Inactive time</CardHeading>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <MetricValue
              value={hasTodayActivity ? fmtHoursMinutes(today.activity.inactiveMin) : '0:00'}
              unit="hrs"
            />
            <Txt role="caption">inactivity alerts off</Txt>
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(160).duration(500)}>
        <GlassCard contentStyle={{ gap: 16 }}>
          <CardHeading
            icon="calendar-week"
            tint="peach"
            right={weekAvg != null ? <HeadingAvg value={String(weekAvg)} /> : undefined}>
            Last 7 days
          </CardHeading>
          {weekScores.length >= 2 ? (
            <Sparkline data={weekScores} height={34} color={palette.peach.mid} delay={600} />
          ) : (
            <Txt role="caption">The week builds as you wear your ring each day.</Txt>
          )}
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}
