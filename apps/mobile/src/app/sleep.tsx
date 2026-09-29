import {
  BackButton,
  CardHeading,
  GlassCard,
  HeaderMeta,
  Hypnogram,
  Label,
  MetricValue,
  Screen,
  ScoreRing,
  ScreenHeader,
  Sparkline,
  StageBar,
  StatBlock,
  StatRow,
  Txt,
  brandInk,
  fontFamily,
  gradients,
  palette,
  stageColors,
  type,
  type HypnogramSegment,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { EmptyDataCard } from '@/components/EmptyDataCard';
import { useDataset, useToday } from '@/data/hooks';
import { MATURITY_COPY } from '@/data/maturity';
import { downsample, fmtClock, fmtDate, fmtDuration, windowSamples } from '@/data/selectors';

const STAGE_ROWS = ['Awake', 'REM', 'Light', 'Deep'];

function fmtStage(minutes: number): string {
  const { h, m } = fmtDuration(minutes);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function hourLabel(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours() % 12 || 12;
  return `${h} ${d.getHours() >= 12 ? 'PM' : 'AM'}`;
}

export default function SleepScreen() {
  const router = useRouter();
  const today = useToday();
  const dataset = useDataset();
  const sleep = today?.sleep ?? null;
  // A window under 30 min (or with no detected asleep epochs) yields an empty
  // summary whose start/end are set but every value is 0 — that is not a
  // tracked night, so durationMin > 0 is part of the gate.
  const hasSleep = sleep != null && sleep.start > 0 && sleep.end > sleep.start && sleep.durationMin > 0;

  const hypnoSegments: HypnogramSegment[] = useMemo(() => {
    if (!hasSleep) return [];
    const span = sleep.end - sleep.start;
    return sleep.stages.map((s) => ({
      stage: s.stage,
      startFrac: (s.start - sleep.start) / span,
      endFrac: (s.end - sleep.start) / span,
    }));
  }, [sleep, hasSleep]);

  // Staging exists only when the night had usable HR (see computeSleep); a
  // duration-only night shows no hypnogram or stage breakdown at all.
  const hasStages = hypnoSegments.length > 0;

  const nightHr = useMemo(
    () =>
      hasSleep
        ? downsample(windowSamples(dataset.series.hr, sleep.start, sleep.end).map((s) => s.v), 36)
        : [],
    [dataset, sleep, hasSleep],
  );
  const nightHrv = useMemo(
    () =>
      hasSleep
        ? downsample(windowSamples(dataset.series.hrv, sleep.start, sleep.end).map((s) => s.v), 36)
        : [],
    [dataset, sleep, hasSleep],
  );

  const timeLabels = useMemo(() => {
    if (!hasSleep) return [];
    return [0, 0.5, 1].map((f) => hourLabel(sleep.start + (sleep.end - sleep.start) * f));
  }, [sleep, hasSleep]);

  if (today == null || !hasSleep) {
    return (
      <Screen aura="sleep">
        <ScreenHeader
          title="Sleep"
          left={<BackButton onPress={() => router.back()} />}
          right={today ? <HeaderMeta>{fmtDate(today.dayStart)}</HeaderMeta> : undefined}
        />
        <EmptyDataCard
          art="sleep"
          tint="indigo"
          title="No sleep tracked"
          message={MATURITY_COPY.sleep.empty}
        />
      </Screen>
    );
  }

  const dur = fmtDuration(sleep.durationMin);

  // One clock label per sparkline point, spanning the sleep window (used for
  // scrub tooltips). Points are evenly spaced after downsampling.
  const nightXValues = (n: number): string[] =>
    Array.from({ length: n }, (_, i) =>
      fmtClock(sleep.start + ((sleep.end - sleep.start) * i) / Math.max(1, n - 1)),
    );

  const stageSegments = [
    { weight: sleep.deepMin, color: stageColors.deep },
    { weight: sleep.remMin, color: stageColors.rem },
    { weight: sleep.lightMin, color: stageColors.light },
    { weight: sleep.awakeMin, color: stageColors.awake },
  ];

  const stageTotal = sleep.deepMin + sleep.remMin + sleep.lightMin + sleep.awakeMin;
  const pct = (min: number) => (stageTotal > 0 ? `${Math.round((min / stageTotal) * 100)}%` : '0%');
  const legend = [
    { color: stageColors.deep, time: fmtStage(sleep.deepMin), share: pct(sleep.deepMin), label: 'Deep' },
    { color: stageColors.rem, time: fmtStage(sleep.remMin), share: pct(sleep.remMin), label: 'REM' },
    { color: stageColors.light, time: fmtStage(sleep.lightMin), share: pct(sleep.lightMin), label: 'Light' },
    { color: stageColors.awake, time: fmtStage(sleep.awakeMin), share: pct(sleep.awakeMin), label: 'Awake' },
  ];

  return (
    <Screen aura="sleep">
      <ScreenHeader
        title="Sleep"
        left={<BackButton onPress={() => router.back()} />}
        right={<HeaderMeta>{fmtDate(today.dayStart)}</HeaderMeta>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard tint="indigo" contentStyle={{ gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 24 }}>
            <ScoreRing size={118} value={today.sleepScore} colors={gradients.sleep} strokeWidth={8}>
              <Text style={{ fontSize: 30, fontFamily: fontFamily.light, color: palette.ink }}>
                {today.sleepScore}
              </Text>
              <Txt role="caption">Score</Txt>
            </ScoreRing>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Label>Time asleep</Label>
              <Text style={{ fontSize: 40, fontFamily: fontFamily.light, color: palette.ink, lineHeight: 44, letterSpacing: -1.2 }}>
                {dur.h}
                <Text style={[type.body, { color: palette.muted }]}>h</Text> {dur.m}
                <Text style={[type.body, { color: palette.muted }]}>m</Text>
              </Text>
              <Txt role="caption">{`${fmtClock(sleep.start)} – ${fmtClock(sleep.end)}`}</Txt>
            </View>
          </View>
          <StatRow>
            <StatBlock value={`${sleep.efficiency}%`} label="Efficiency" />
            <StatBlock value={`${sleep.latencyMin}m`} label="Time to fall asleep" />
          </StatRow>
        </GlassCard>
      </Animated.View>

      {hasStages && (
        <Animated.View entering={FadeInDown.delay(80).duration(500)}>
          <GlassCard contentStyle={{ gap: 16 }}>
            <CardHeading icon="chart-bar-stacked" tint="indigo">Stages</CardHeading>
            <StageBar segments={stageSegments} delay={300} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16, columnGap: 24 }}>
              {legend.map((l) => (
                <View key={l.label} style={{ width: '44%', gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: l.color }} />
                    <Txt role="caption">{l.label}</Txt>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                    <Text style={{ fontSize: 20, fontFamily: fontFamily.light, color: palette.ink, letterSpacing: -0.4 }}>
                      {l.time}
                    </Text>
                    <Txt role="caption">{l.share}</Txt>
                  </View>
                </View>
              ))}
            </View>
          </GlassCard>
        </Animated.View>
      )}

      {hasStages && (
        <Animated.View entering={FadeInDown.delay(120).duration(500)}>
          <GlassCard contentStyle={{ gap: 16 }}>
            <CardHeading icon="chart-timeline-variant" tint="lavender">Timeline</CardHeading>
            <Txt role="caption" style={{ marginTop: -8 }}>
              Estimated from heart rate & movement
            </Txt>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ height: 104, justifyContent: 'space-between', paddingVertical: 2 }}>
                {STAGE_ROWS.map((r) => (
                  <Txt key={r} role="micro">
                    {r}
                  </Txt>
                ))}
              </View>
              <View style={{ flex: 1 }}>
                <Hypnogram segments={hypnoSegments} height={104} delay={250} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                  {timeLabels.map((t, i) => (
                    <Txt key={i} role="micro">
                      {t}
                    </Txt>
                  ))}
                </View>
              </View>
            </View>
          </GlassCard>
        </Animated.View>
      )}

      <Animated.View entering={FadeInDown.delay(160).duration(500)}>
        <GlassCard tint="indigo" contentStyle={{ gap: 16 }}>
          <CardHeading icon="heart" tint="indigo">Heart rate</CardHeading>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <MetricValue value={sleep.lowestHr > 0 ? String(sleep.lowestHr) : '0'} unit="bpm" />
            <Txt role="caption">lowest overnight</Txt>
          </View>
          {nightHr.length >= 2 ? (
            <Sparkline
              data={nightHr}
              height={44}
              color={brandInk.indigo}
              dot="min"
              delay={500}
              interactive
              xLabels={timeLabels}
              xValues={nightXValues(nightHr.length)}
              formatValue={(v) => `${Math.round(v)} bpm`}
            />
          ) : null}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(500)}>
        <GlassCard tint="mint" contentStyle={{ gap: 16 }}>
          <CardHeading icon="heart-pulse" tint="mint">HRV</CardHeading>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <MetricValue value={sleep.peakHrv > 0 ? String(sleep.peakHrv) : '0'} unit="ms" />
            <Txt role="caption">highest overnight</Txt>
          </View>
          {nightHrv.length >= 2 ? (
            <Sparkline
              data={nightHrv}
              height={44}
              color={brandInk.mint}
              dot="max"
              delay={560}
              interactive
              xLabels={timeLabels}
              xValues={nightXValues(nightHrv.length)}
              formatValue={(v) => `${Math.round(v)} ms`}
            />
          ) : null}
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}
