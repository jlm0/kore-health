import {
  BackButton,
  BarChart,
  GlassCard,
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
import { useDataset, useDays, useToday } from '@/data/hooks';
import { fmtDate, fmtHoursMinutes, hourlyMovement } from '@/data/selectors';

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

  const movement = useMemo(() => hourlyMovement(dataset, today.dayStart), [dataset, today.dayStart]);
  const week = days.slice(-7);
  const weekScores = week.map((d) => d.activityScore);
  const weekAvg = Math.round(weekScores.reduce((s, v) => s + v, 0) / weekScores.length);

  const goalPct = Math.min(1, today.activity.activeCal / today.activity.goalCal);

  return (
    <Screen aura="activity">
      <ScreenHeader
        title="Activity"
        left={<BackButton onPress={() => router.back()} />}
        right={<Label size={10} em={0.14}>{fmtDate(today.dayStart)}</Label>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={22} contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
          <ScoreRing size={118} value={today.activityScore} colors={gradients.activity} strokeWidth={8}>
            <Text style={{ fontSize: 30, fontFamily: fontFamily.light, color: palette.ink }}>
              {today.activityScore}
            </Text>
            <Label size={8} em={0.18}>Score</Label>
          </ScoreRing>
          <View style={{ gap: 12 }}>
            <StatBlock value={today.activity.steps.toLocaleString('en-US')} label="Steps" />
            <StatBlock value={String(today.activity.activeCal)} label="Active Cal" />
            <StatBlock value={today.activity.kmEquiv.toFixed(1)} label="KM Equiv" />
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(500)}>
        <GlassCard radius={28} padding={20}>
          <Label size={9} em={0.18}>Movement</Label>
          <BarChart
            data={movement}
            height={70}
            colorFor={movementColor}
            delay={250}
            style={{ marginTop: 12 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            {['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'].map((t, i) => (
              <Text key={i} style={{ fontSize: 8, fontFamily: fontFamily.regular, color: palette.faint }}>
                {t}
              </Text>
            ))}
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        <GlassCard radius={24} padding={16} style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <Label size={9} em={0.18}>Goal</Label>
          <MetricValue value={String(Math.round(goalPct * 100))} unit="%" />
          <ProgressBar progress={goalPct} colors={gradients.activity} delay={450} style={{ marginTop: 8 }} />
          <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.faint, marginTop: 2 }}>
            {today.activity.activeCal} / {today.activity.goalCal} cal
          </Text>
        </GlassCard>
        <GlassCard radius={24} padding={16} style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <Label size={9} em={0.18}>Inactive</Label>
          <MetricValue value={fmtHoursMinutes(today.activity.inactiveMin)} unit="hrs" />
          <ProgressBar
            progress={today.activity.inactiveMin / 300}
            colors={palette.ghost}
            delay={520}
            style={{ marginTop: 8 }}
          />
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
              {weekAvg}
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
