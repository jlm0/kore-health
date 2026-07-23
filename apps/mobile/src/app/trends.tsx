import {
  BackButton,
  CardHeading,
  GlassCard,
  HeatmapGrid,
  Label,
  MetricValue,
  Pill,
  Screen,
  ScreenHeader,
  Sparkline,
  fontFamily,
  palette,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDays } from '@/data/hooks';
import { fmtHoursMinutes, normalize } from '@/data/selectors';

function TrendDelta({ delta, improving }: { delta: number; improving: boolean }) {
  return (
    <Text
      style={{
        fontSize: 10,
        fontFamily: fontFamily.regular,
        color: improving ? palette.mint.deep : palette.peach.deep,
      }}>
      {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}
    </Text>
  );
}

export default function TrendsScreen() {
  const router = useRouter();
  const days = useDays();

  const last28 = days.slice(-28);
  const heatValues = useMemo(() => normalize(last28.map((d) => d.readiness)), [last28]);
  const dayLetters = useMemo(
    () => last28.slice(0, 7).map((d) => 'SMTWTFS'[new Date(d.dayStart).getDay()]),
    [last28],
  );

  const sleepScores = days.map((d) => d.sleepScore);
  const sleepAvg = Math.round(sleepScores.reduce((s, v) => s + v, 0) / sleepScores.length);

  const hrvDaily = days.map((d) => d.hrvAvg);
  const rhrDaily = days.map((d) => d.restingHr);
  const avgOf = (xs: number[]) => Math.round(xs.reduce((s, v) => s + v, 0) / xs.length);
  const hrvRecent = avgOf(hrvDaily.slice(-7));
  const hrvPrior = avgOf(hrvDaily.slice(-14, -7));
  const rhrRecent = avgOf(rhrDaily.slice(-7));
  const rhrPrior = avgOf(rhrDaily.slice(-14, -7));

  const readinessAvg = avgOf(days.map((d) => d.readiness));
  const sleepDurAvg = Math.round(days.reduce((s, d) => s + d.sleep.durationMin, 0) / days.length);
  const hrvAvg30 = avgOf(hrvDaily);

  return (
    <Screen aura="trends">
      <ScreenHeader
        title="Trends"
        left={<BackButton onPress={() => router.back()} />}
        right={<Pill variant="mint" em={0.14} paddingH={10}>30 d</Pill>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={20} tint="lavender">
          <CardHeading icon="calendar-month" tint="lavender">Readiness</CardHeading>
          <HeatmapGrid
            values={heatValues}
            dayLabels={dayLetters}
            delay={150}
            style={{ marginTop: 14 }}
          />
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(500)}>
        <GlassCard radius={28} padding={20}>
          <CardHeading
            icon="sleep"
            tint="indigo"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.ink }}>
                  {sleepAvg}
                </Text>
                <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.muted }}>
                  avg
                </Text>
              </View>
            }>
            Sleep Score
          </CardHeading>
          <Sparkline
            data={sleepScores}
            height={64}
            color={palette.indigo.base}
            fillGradient={['rgba(126,150,224,0.25)', 'rgba(126,150,224,0)']}
            delay={300}
            style={{ marginTop: 10 }}
          />
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        <GlassCard radius={24} padding={16} tint="mint" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart-pulse" tint="mint">HRV</CardHeading>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <MetricValue value={String(hrvRecent)} size={24} />
            <TrendDelta delta={hrvRecent - hrvPrior} improving={hrvRecent >= hrvPrior} />
          </View>
          <Sparkline data={hrvDaily} height={36} color={palette.mint.base} delay={450} />
        </GlassCard>
        <GlassCard radius={24} padding={16} tint="indigo" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart" tint="indigo">Resting HR</CardHeading>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <MetricValue value={String(rhrRecent)} size={24} />
            <TrendDelta delta={rhrRecent - rhrPrior} improving={rhrRecent <= rhrPrior} />
          </View>
          <Sparkline data={rhrDaily} height={36} color={palette.indigo.base} delay={520} />
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(240).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        {[
          { value: String(readinessAvg), label: 'Readiness' },
          { value: fmtHoursMinutes(sleepDurAvg), label: 'Sleep' },
          { value: String(hrvAvg30), label: 'HRV' },
        ].map((s) => (
          <GlassCard
            key={s.label}
            radius={22}
            padding={14}
            style={{ flex: 1 }}
            contentStyle={{ alignItems: 'center', gap: 3 }}>
            <Text style={{ fontSize: 20, fontFamily: fontFamily.displayLight, color: palette.ink }}>
              {s.value}
            </Text>
            <Label size={8} em={0.14} color={palette.faint}>
              {s.label}
            </Label>
          </GlassCard>
        ))}
      </Animated.View>
    </Screen>
  );
}
