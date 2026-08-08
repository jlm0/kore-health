import {
  AnimatedNumber,
  BackButton,
  CardHeading,
  ContributorRow,
  GlassCard,
  IconBadge,
  Label,
  Pill,
  Screen,
  ScoreRing,
  ScreenHeader,
  fontFamily,
  gradients,
  palette,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { EmptyDataCard } from '@/components/EmptyDataCard';
import { useDays, useMaturities, useToday } from '@/data/hooks';
import { MATURITY_COPY } from '@/data/maturity';
import { fmtDate, hasNightData, meanOf } from '@/data/selectors';

const CONTRIBUTORS: { key: keyof NonNullable<ReturnType<typeof useToday>>['contributors']; label: string }[] = [
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
  const maturities = useMaturities();

  // Readiness is TREND-only: without night data the score is neutral-fallback
  // filler, so the whole screen stays an honest empty state until then.
  if (today == null || maturities.readiness.state !== 'ready') {
    return (
      <Screen aura="readiness">
        <ScreenHeader title="Readiness" left={<BackButton onPress={() => router.back()} />} />
        <EmptyDataCard
          icon="lightning-bolt"
          tint="mint"
          title={today == null ? 'No data yet' : MATURITY_COPY.readiness.none}
          message={
            today == null
              ? 'Sync your ring from the Home tab to see your readiness.'
              : MATURITY_COPY.readiness.empty
          }
        />
      </Screen>
    );
  }

  // The 7-day average only counts night-backed days — dataless days carry a
  // neutral-fallback score that was never shown anywhere. With no real prior
  // nights there is no average, so the delta pill hides instead of showing +0.
  const prev7 = days.slice(-8, -1).filter(hasNightData);
  const avg7 = meanOf(prev7.map((d) => d.readiness));
  const delta = avg7 != null ? today.readiness - avg7 : null;

  return (
    <Screen aura="readiness">
      <ScreenHeader
        title="Readiness"
        left={<BackButton onPress={() => router.back()} />}
        right={<Label size={10} em={0.14}>{fmtDate(today.dayStart)}</Label>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={24} tint="mint" contentStyle={{ alignItems: 'center', gap: 10 }}>
          <IconBadge name="lightning-bolt" tint="mint" style={{ position: 'absolute', top: 16, left: 16 }} />
          <ScoreRing size={170} value={today.readiness} colors={gradients.readiness} strokeWidth={10}>
            <AnimatedNumber value={today.readiness} size={48} weight="displayLight" />
            <Label size={9} em={0.2}>Today</Label>
          </ScoreRing>
          {delta != null ? (
            <Pill variant="mint" em={0.18} style={{ alignSelf: 'center' }}>
              {`${delta >= 0 ? '+' : ''}${delta} vs 7-day avg`}
            </Pill>
          ) : null}
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
    </Screen>
  );
}
