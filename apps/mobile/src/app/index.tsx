import {
  AnimatedNumber,
  Chevron,
  DotTrend,
  GlassCard,
  GlassCircle,
  Label,
  MetricValue,
  Pill,
  ProgressBar,
  RingIcon,
  Screen,
  ScoreRing,
  ScreenHeader,
  Sparkline,
  fontFamily,
  gradients,
  palette,
  spacing,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDays, useSeriesWindow, useToday } from '@/data/hooks';
import { fmtDate } from '@/data/selectors';

function readinessStatus(score: number): string {
  if (score >= 85) return 'Optimal';
  if (score >= 70) return 'Good';
  return 'Recover';
}

export default function HomeScreen() {
  const router = useRouter();
  const today = useToday();
  const days = useDays();
  const hrv24 = useSeriesWindow('hrv', 24, 40);
  const hr24 = useSeriesWindow('hr', 24, 40);
  const temp7 = days.slice(-7).map((d) => d.tempDeviation);

  return (
    <Screen aura="home" gap={spacing.gridGap}>
      <ScreenHeader
        left={<Label size={10} em={0.16}>{fmtDate(Date.now(), true)}</Label>}
        right={
          <GlassCircle size={32} onPress={() => router.push('/trends')}>
            <RingIcon />
          </GlassCircle>
        }
      />

      <Animated.View entering={FadeInDown.duration(500)}>
        <GlassCard
          radius={28}
          padding={16}
          chevron
          onPress={() => router.push('/readiness')}
          contentStyle={{ alignItems: 'center', gap: 8 }}>
          <ScoreRing size={146} value={today.readiness} colors={gradients.readiness} strokeWidth={10}>
            <AnimatedNumber value={today.readiness} size={44} weight="extraLight" />
            <Label size={9} em={0.2}>Readiness</Label>
          </ScoreRing>
          <Pill variant="mint" em={0.18}>{readinessStatus(today.readiness)}</Pill>
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(80).duration(500)}
        style={{ flexDirection: 'row', gap: spacing.cardGap }}>
        <GlassCard
          radius={26}
          padding={14}
          chevron
          chevronOffset={{ top: 18, right: 16 }}
          onPress={() => router.push('/sleep')}
          style={{ flex: 1 }}
          contentStyle={{ alignItems: 'center', gap: 6 }}>
          <ScoreRing size={92} value={today.sleepScore} colors={gradients.sleep} strokeWidth={8} delay={150}>
            <Text style={{ fontSize: 28, fontFamily: fontFamily.light, color: palette.ink }}>
              {today.sleepScore}
            </Text>
          </ScoreRing>
          <Label size={9} em={0.2}>Sleep</Label>
        </GlassCard>
        <GlassCard
          radius={26}
          padding={14}
          chevron
          chevronOffset={{ top: 18, right: 16 }}
          onPress={() => router.push('/activity')}
          style={{ flex: 1 }}
          contentStyle={{ alignItems: 'center', gap: 6 }}>
          <ScoreRing size={92} value={today.activityScore} colors={gradients.activity} strokeWidth={8} delay={250}>
            <Text style={{ fontSize: 28, fontFamily: fontFamily.light, color: palette.ink }}>
              {today.activityScore}
            </Text>
          </ScoreRing>
          <Label size={9} em={0.2}>Activity</Label>
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160).duration(500)}
        style={{ flexDirection: 'row', gap: spacing.gridGap }}>
        <GlassCard
          radius={24}
          padding={13}
          onPress={() => router.push('/metric/hrv')}
          style={{ flex: 1 }}
          contentStyle={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label size={9} em={0.18}>HRV</Label>
            <Chevron size={7} />
          </View>
          <MetricValue value={String(today.hrvAvg)} unit="ms" />
          <Sparkline data={hrv24} height={22} color={palette.mint.base} delay={350} />
        </GlassCard>
        <GlassCard
          radius={24}
          padding={13}
          onPress={() => router.push('/metric/rhr')}
          style={{ flex: 1 }}
          contentStyle={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label size={9} em={0.18}>Resting HR</Label>
            <Chevron size={7} />
          </View>
          <MetricValue value={String(today.restingHr)} unit="bpm" />
          <Sparkline data={hr24} height={22} color={palette.indigo.base} delay={420} />
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(240).duration(500)}
        style={{ flexDirection: 'row', gap: spacing.gridGap }}>
        <GlassCard
          radius={24}
          padding={13}
          onPress={() => router.push('/metric/temp')}
          style={{ flex: 1 }}
          contentStyle={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label size={9} em={0.18}>Body Temp</Label>
            <Chevron size={7} />
          </View>
          <MetricValue
            value={`${today.tempDeviation >= 0 ? '+' : ''}${today.tempDeviation.toFixed(1)}`}
            unit="°C"
          />
          <DotTrend data={temp7} height={22} delay={500} />
        </GlassCard>
        <GlassCard
          radius={24}
          padding={13}
          onPress={() => router.push('/metric/spo2')}
          style={{ flex: 1 }}
          contentStyle={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label size={9} em={0.18}>SpO₂</Label>
            <Chevron size={7} />
          </View>
          <MetricValue value={String(Math.round(today.spo2))} unit="%" />
          <ProgressBar
            progress={today.spo2 / 100}
            colors={gradients.spo2}
            delay={550}
            style={{ marginTop: 8 }}
          />
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}
