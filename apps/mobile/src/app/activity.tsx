import {
  BackButton,
  BarChart,
  CardHeading,
  GlassCard,
  IconBadge,
  Label,
  MetricValue,
  ProgressBar,
  Screen,
  ScoreRing,
  ScreenHeader,
  Sparkline,
  StatBlock,
  fontFamily,
  gradients,
  palette,
  surfaces,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { EmptyDataCard } from '@/components/EmptyDataCard';
import { useDataset, useDays, useMaturities, useToday } from '@/data/hooks';
import { MATURITY_COPY } from '@/data/maturity';
import { fmtDate, fmtHoursMinutes, hourlyMovement, meanOf } from '@/data/selectors';

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

  const movement = useMemo(
    () => (today ? hourlyMovement(dataset, today.dayStart) : new Array(24).fill(0)),
    [dataset, today],
  );

  // Without any movement/calorie data the rings and bars would all be fake
  // zeros — stay an honest empty state until the first daytime sync.
  if (today == null || maturities.activity.state !== 'ready') {
    return (
      <Screen aura="activity">
        <ScreenHeader title="Activity" left={<BackButton onPress={() => router.back()} />} />
        <EmptyDataCard
          icon="fire"
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
  const hasTodayActivity = today.activity.activeCal > 0 || movement.some((v) => v > 0);

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
        right={<Label size={10} em={0.14}>{fmtDate(today.dayStart)}</Label>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={22} tint="peach" contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
          <IconBadge name="fire" tint="peach" style={{ position: 'absolute', top: 16, right: 16 }} />
          <ScoreRing size={118} value={hasTodayActivity ? today.activityScore : 0} colors={gradients.activity} strokeWidth={8}>
            <Text style={{ fontSize: 30, fontFamily: fontFamily.displayLight, color: hasTodayActivity ? palette.ink : palette.muted }}>
              {hasTodayActivity ? today.activityScore : '0'}
            </Text>
            <Label size={8} em={0.18}>Score</Label>
          </ScoreRing>
          <View style={{ gap: 12 }}>
            {/* Steps/KM are never measured (see computeActivity in scores.ts)
                — a hardcoded 0, not an invented estimate. */}
            <StatBlock value="0" label="Steps" />
            <StatBlock
              value={today.activity.activeCal > 0 ? String(today.activity.activeCal) : '0'}
              label="Active Cal"
            />
            <StatBlock value="0" label="KM Equiv" />
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(500)}>
        <GlassCard radius={28} padding={20}>
          <CardHeading icon="walk" tint="peach">Movement</CardHeading>
          <BarChart
            data={movement}
            height={70}
            colorFor={movementColor}
            delay={250}
            xLabels={['12 AM', '6 AM', '12 PM', '6 PM', '12 AM']}
            style={{ marginTop: 12 }}
          />
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        <GlassCard radius={24} padding={16} tint="mint" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="target" tint="mint">Goal</CardHeading>
          {showGoal ? (
            <>
              <MetricValue value={String(Math.round(goalPct * 100))} unit="%" />
              <ProgressBar progress={goalPct} colors={gradients.activity} delay={450} style={{ marginTop: 8 }} />
              <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.faint, marginTop: 2 }}>
                {today.activity.activeCal} / {today.activity.goalCal} cal
              </Text>
            </>
          ) : (
            <MetricValue value="0" unit="%" />
          )}
        </GlassCard>
        <GlassCard radius={24} padding={16} tint="lavender" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="timer-sand" tint="lavender">Inactive</CardHeading>
          <MetricValue
            value={hasTodayActivity ? fmtHoursMinutes(today.activity.inactiveMin) : '0:00'}
            unit="hrs"
          />
          {hasTodayActivity ? (
            <ProgressBar
              progress={today.activity.inactiveMin / 300}
              colors={palette.ghost}
              delay={520}
              style={{ marginTop: 8 }}
            />
          ) : null}
          <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.faint, marginTop: 2 }}>
            alerts off
          </Text>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(240).duration(500)}>
        <GlassCard
          radius={24}
          padding={{ horizontal: 20, vertical: 16 }}
          contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <Label size={9} em={0.18}>7 Days</Label>
          <Sparkline
            data={weekScores}
            height={34}
            color={palette.peach.mid}
            delay={600}
            style={{ flex: 1 }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.ink }}>
              {weekAvg ?? '0'}
            </Text>
            <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.muted }}>
              avg
            </Text>
          </View>
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}
