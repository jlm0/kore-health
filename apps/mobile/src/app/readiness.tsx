import {
  AnimatedNumber,
  BackButton,
  CardHeading,
  ContributorRow,
  DotTrend,
  GlassCard,
  IconBadge,
  Label,
  MetricValue,
  Pill,
  Screen,
  ScoreRing,
  ScreenHeader,
  Sparkline,
  gradients,
  palette,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDays, useToday } from '@/data/hooks';
import { fmtDate } from '@/data/selectors';

const CONTRIBUTORS: { key: keyof ReturnType<typeof useToday>['contributors']; label: string }[] = [
  { key: 'hrvBalance', label: 'HRV Balance' },
  { key: 'bodyTemp', label: 'Body Temp' },
  { key: 'sleep', label: 'Sleep' },
  { key: 'restingHr', label: 'Resting HR' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'activityBalance', label: 'Activity Bal' },
];

export default function ReadinessScreen() {
  const router = useRouter();
  const today = useToday();
  const days = useDays();

  const prev7 = days.slice(-8, -1);
  const avg7 = Math.round(prev7.reduce((s, d) => s + d.readiness, 0) / prev7.length);
  const delta = today.readiness - avg7;

  const temp7 = days.slice(-7).map((d) => d.tempDeviation);
  const rhr7 = days.slice(-7).map((d) => d.restingHr);

  return (
    <Screen aura="readiness">
      <ScreenHeader
        title="Readiness"
        left={<BackButton onPress={() => router.back()} />}
        right={<Label size={10} em={0.14}>{fmtDate(today.dayStart)}</Label>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={24} tint="mint" contentStyle={{ alignItems: 'center', gap: 10 }}>
          <IconBadge name="lightning-bolt" tint="mint" style={{ position: 'absolute', top: 0, left: 0 }} />
          <ScoreRing size={170} value={today.readiness} colors={gradients.readiness} strokeWidth={10}>
            <AnimatedNumber value={today.readiness} size={48} weight="displayLight" />
            <Label size={9} em={0.2}>Today</Label>
          </ScoreRing>
          <Pill variant="mint" em={0.18} style={{ alignSelf: 'center' }}>
            {`${delta >= 0 ? '+' : ''}${delta} vs 7-day avg`}
          </Pill>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(500)}>
        <GlassCard radius={28} padding={20} contentStyle={{ gap: 12 }}>
          <CardHeading icon="tune-variant" tint="mint">Contributors</CardHeading>
          {CONTRIBUTORS.map((c, i) => (
            <ContributorRow
              key={c.key}
              label={c.label}
              progress={today.contributors[c.key]}
              warn={today.contributors[c.key] < 0.75}
              delay={250 + i * 90}
            />
          ))}
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        <GlassCard radius={24} padding={16} tint="lavender" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="thermometer" tint="lavender">Temp Trend</CardHeading>
          <MetricValue
            value={`${today.tempDeviation >= 0 ? '+' : ''}${today.tempDeviation.toFixed(1)}`}
            unit="°C"
          />
          <DotTrend data={temp7} height={40} delay={500} />
        </GlassCard>
        <GlassCard radius={24} padding={16} tint="indigo" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart" tint="indigo">Resting HR</CardHeading>
          <MetricValue value={String(today.restingHr)} unit="bpm" />
          <Sparkline data={rhr7} height={40} color={palette.indigo.base} delay={560} />
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}
