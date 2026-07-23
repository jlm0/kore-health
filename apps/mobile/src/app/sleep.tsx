import {
  BackButton,
  CardHeading,
  GlassCard,
  Hypnogram,
  IconBadge,
  Label,
  MetricValue,
  Pill,
  Screen,
  ScoreRing,
  ScreenHeader,
  Sparkline,
  StageBar,
  fontFamily,
  gradients,
  palette,
  stageColors,
  type HypnogramSegment,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDataset, useToday } from '@/data/hooks';
import { downsample, fmtClock, fmtDate, fmtDuration, fmtHoursMinutes, windowSamples } from '@/data/selectors';

const STAGE_ROWS = ['Awake', 'REM', 'Light', 'Deep'];

export default function SleepScreen() {
  const router = useRouter();
  const today = useToday();
  const dataset = useDataset();
  const sleep = today.sleep;

  const hypnoSegments: HypnogramSegment[] = useMemo(() => {
    const span = sleep.end - sleep.start;
    return sleep.stages.map((s) => ({
      stage: s.stage,
      startFrac: (s.start - sleep.start) / span,
      endFrac: (s.end - sleep.start) / span,
    }));
  }, [sleep]);

  const nightHr = useMemo(
    () => downsample(windowSamples(dataset.series.hr, sleep.start, sleep.end).map((s) => s.v), 36),
    [dataset, sleep],
  );
  const nightHrv = useMemo(
    () => downsample(windowSamples(dataset.series.hrv, sleep.start, sleep.end).map((s) => s.v), 36),
    [dataset, sleep],
  );

  const timeLabels = useMemo(() => {
    const labels: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = sleep.start + ((sleep.end - sleep.start) * i) / 4;
      const d = new Date(t);
      let h = d.getHours() % 12 || 12;
      labels.push(`${h} ${d.getHours() >= 12 ? 'PM' : 'AM'}`);
    }
    return labels;
  }, [sleep]);

  const dur = fmtDuration(sleep.durationMin);

  const stageSegments = [
    { weight: sleep.deepMin, color: stageColors.deep },
    { weight: sleep.remMin, color: stageColors.rem },
    { weight: sleep.lightMin, color: stageColors.light },
    { weight: sleep.awakeMin, color: stageColors.awake },
  ];

  const legend = [
    { color: stageColors.deep, time: fmtHoursMinutes(sleep.deepMin), label: 'Deep' },
    { color: stageColors.rem, time: fmtHoursMinutes(sleep.remMin), label: 'REM' },
    { color: stageColors.light, time: fmtHoursMinutes(sleep.lightMin), label: 'Light' },
    { color: stageColors.awake, time: fmtHoursMinutes(sleep.awakeMin), label: 'Awake' },
  ];

  return (
    <Screen aura="sleep">
      <ScreenHeader
        title="Sleep"
        left={<BackButton onPress={() => router.back()} />}
        right={<Label size={10} em={0.14}>{fmtDate(today.dayStart)}</Label>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={18} tint="indigo" contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <IconBadge name="sleep" tint="indigo" style={{ position: 'absolute', top: 14, right: 14 }} />
          <ScoreRing size={92} value={today.sleepScore} colors={gradients.sleep} strokeWidth={8}>
            <Text style={{ fontSize: 28, fontFamily: fontFamily.displayLight, color: palette.ink }}>
              {today.sleepScore}
            </Text>
          </ScoreRing>
          <View style={{ gap: 5, flex: 1 }}>
            <Text style={{ fontSize: 36, fontFamily: fontFamily.displayLight, color: palette.ink, lineHeight: 46 }}>
              {dur.h}
              <Text style={{ fontSize: 16, color: palette.muted }}>h</Text> {dur.m}
              <Text style={{ fontSize: 16, color: palette.muted }}>m</Text>
            </Text>
            <Text
              style={{
                fontSize: 10,
                fontFamily: fontFamily.regular,
                letterSpacing: 1,
                color: palette.muted,
              }}>
              {fmtClock(sleep.start)} — {fmtClock(sleep.end)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Pill variant="indigo" em={0.06} paddingH={8}>{`${sleep.efficiency}% eff`}</Pill>
              <Pill variant="neutral" em={0.06} paddingH={8}>{`${sleep.latencyMin}m latency`}</Pill>
            </View>
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(500)}>
        <GlassCard radius={28} padding={20}>
          <CardHeading icon="chart-timeline-variant" tint="lavender">Stages</CardHeading>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <View style={{ height: 100, justifyContent: 'space-between', paddingVertical: 2 }}>
              {STAGE_ROWS.map((r) => (
                <Label key={r} size={8} em={0.08} color={palette.faint}>
                  {r}
                </Label>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Hypnogram segments={hypnoSegments} height={104} delay={250} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                {timeLabels.map((t, i) => (
                  <Text key={i} style={{ fontSize: 8, fontFamily: fontFamily.regular, color: palette.faint }}>
                    {t}
                  </Text>
                ))}
              </View>
            </View>
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(160).duration(500)}>
        <GlassCard radius={26} padding={{ horizontal: 20, vertical: 18 }} contentStyle={{ gap: 14 }}>
          <StageBar segments={stageSegments} delay={400} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {legend.map((l) => (
              <View key={l.label} style={{ gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: l.color }} />
                  <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.ink }}>
                    {l.time}
                  </Text>
                </View>
                <Label size={8} em={0.14} color={palette.faint}>
                  {l.label}
                </Label>
              </View>
            ))}
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(240).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        <GlassCard radius={24} padding={16} tint="indigo" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart" tint="indigo">Heart Rate</CardHeading>
          <MetricValue value={String(sleep.lowestHr)} unit="low" />
          <Sparkline
            data={nightHr}
            height={44}
            color={palette.indigo.base}
            dot="min"
            dotColor={palette.indigo.deep}
            delay={500}
          />
        </GlassCard>
        <GlassCard radius={24} padding={16} tint="mint" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart-pulse" tint="mint">HRV</CardHeading>
          <MetricValue value={String(sleep.peakHrv)} unit="peak" />
          <Sparkline
            data={nightHrv}
            height={44}
            color={palette.mint.base}
            dot="max"
            dotColor={palette.mint.deep}
            delay={560}
          />
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}
