import {
  AnimatedNumber,
  BackButton,
  CardHeading,
  GlassCard,
  Label,
  Pill,
  RangeSelector,
  Screen,
  ScreenHeader,
  Sparkline,
  StatBlock,
  fontFamily,
  palette,
} from '@kore/ui';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDays, useDataset, useMaturities, useTempAbsSeries, useUnits } from '@/data/hooks';
import { type MetricGroup } from '@/data/maturity';
import { METRICS, type MetricId } from '@/data/metrics';
import {
  bucketSeries,
  fmtClock,
  fmtDate,
  latestNightSample,
  rangeAxisLabels,
  TIME_RANGE_OPTIONS,
  type TimeRange,
} from '@/data/selectors';
import { tempUnit, toDisplayTemp, toDisplayTempDelta, type Units } from '@/data/units';
import { stopLiveHeartRate, streamLiveHeartRate } from '@/ring/sync';
import { useHealthStore, useLiveStore } from '@/store/health';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

// Metric screens map onto the central maturity groups (NOW/TODAY/TREND).
const METRIC_GROUP: Record<MetricId, MetricGroup> = {
  hrv: 'hrv',
  rhr: 'hr',
  temp: 'temp',
  spo2: 'spo2',
};

export default function MetricDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const metric = METRICS[id as MetricId];
  // HRV and resting HR are night-backed metrics: their data domain is the
  // resting state (20:00–12:00), so both the headline and the chart use
  // night-hours samples only — a daytime reading must never pose as "resting".
  const nightBacked = metric?.id === 'hrv' || metric?.id === 'rhr';

  const days = useDays();
  const dataset = useDataset();
  const [range, setRange] = useState<TimeRange>('day');

  // Temp absolute mode: before a personal baseline exists (state 'collecting',
  // 2+ nights needed), the deviation series is all zeros by design — show the
  // real absolute skin temperature instead of a useless flat 0.0.
  const maturities = useMaturities();
  const maturity = metric ? maturities[METRIC_GROUP[metric.id]] : null;
  const tempAbsMode = metric?.id === 'temp' && maturity != null && maturity.state !== 'ready';
  const tempAbsSeries = useTempAbsSeries();
  const tempNights = useHealthStore((s) => s.tempNights);
  const units = useUnits();
  const setUnits = useHealthStore((s) => s.setUnits);

  // A metric has a daily trend only when its series has real points — a
  // DaySummary field can be 0 without data (e.g. SpO2 is never invented), and
  // a flat all-zero line must never pose as a trend.
  const hasSeries = metric ? dataset.series[metric.seriesId].length > 0 : false;
  // Nights with a real deviation: the first recorded night has no baseline
  // yet, so its deviation is 0 by design (sorted ascending in ring.ts).
  const tempBaselineDays = useMemo(
    () => new Set(tempNights.slice(1).map((n) => n.dayStart)),
    [tempNights],
  );
  const daily = useMemo(() => {
    if (tempAbsMode) return tempNights.map((n) => n.meanC);
    if (!metric || !hasSeries) return [];
    // 0 means "not measured" for hrv/rhr/spo2 — those days must not drag the
    // min/avg stats to a fake 0. Temp uses the baseline-backed nights instead.
    if (metric.id === 'temp') {
      return days
        .filter((d) => tempBaselineDays.has(d.dayStart))
        .map((d) => d.tempDeviation);
    }
    return days.map((d) => metric.dailyValue(d)).filter((v) => v > 0);
  }, [days, metric, hasSeries, tempAbsMode, tempNights, tempBaselineDays]);

  // Headline = the LATEST measurement in the metric's own series — the right
  // edge of the chart below it, so number and line always tell the same
  // linear-time story. Night-backed metrics take the latest RESTING-DOMAIN
  // sample (20:00–12:00): never a nightly average (reads stale) and never a
  // daytime reading posing as "resting".
  const seriesNow = tempAbsMode ? tempAbsSeries : dataset.series[metric?.seriesId ?? 'hrv'];
  const currentSample = tempAbsMode
    ? (seriesNow[seriesNow.length - 1] ?? null)
    : nightBacked
      ? latestNightSample(seriesNow)
      : (seriesNow[seriesNow.length - 1] ?? null);
  const current = currentSample?.v ?? null;

  // Range-switched chart: Day = hourly means of today, Week = daily means
  // over 7 days, Month = weekly means over the 30-day window. Buckets with no
  // samples are dropped from the line (their avg is null) — never fabricated.
  // Night-backed metrics (resting HR, HRV) chart NIGHT HOURS ONLY
  // (20:00–12:00): the headline is an overnight resting value, so letting
  // daytime readings into the same chart puts an active-HR spike next to a
  // resting headline and reads as a contradiction.
  const rangeBuckets = useMemo(() => {
    if (!metric) return [];
    const series = tempAbsMode ? tempAbsSeries : dataset.series[metric.seriesId];
    const chartSeries = nightBacked
      ? series.filter((s) => {
          const h = new Date(s.t).getHours();
          return h >= 20 || h < 12;
        })
      : series;
    return bucketSeries(chartSeries, range, Date.now());
  }, [metric, nightBacked, tempAbsMode, tempAbsSeries, dataset, range]);
  const chartPoints = rangeBuckets.filter((b) => b.avg != null);
  const chartData = chartPoints.map((b) => b.avg as number);
  const chartXValues = chartPoints.map((b) =>
    range === 'day'
      ? fmtClock(b.start)
      : range === 'week'
        ? fmtDate(b.start, true)
        : `Week of ${fmtDate(b.start)}`,
  );
  const chartXLabels = rangeAxisLabels(range, Date.now());

  const stats = useMemo(() => {
    if (daily.length === 0) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...daily),
      max: Math.max(...daily),
      avg: daily.reduce((s, v) => s + v, 0) / daily.length,
    };
  }, [daily]);

  // Live HR session state. The session itself lives in the stores: beats land
  // in the non-persisted useLiveStore buffer and progress is read from
  // connectionStatus ('connecting' → 'connected' while streaming). liveSession
  // marks that THIS screen started the stream, so a history sync's status
  // changes never masquerade as a live session here.
  const ringDeviceId = useHealthStore((s) => s.ringDeviceId);
  const connectionStatus = useHealthStore((s) => s.connectionStatus);
  const liveHr = useLiveStore((s) => s.liveHr);
  const [liveSession, setLiveSession] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveBeats = useMemo(() => liveHr.slice(-30).map((s) => s.v), [liveHr]);

  if (!metric) return <Redirect href="/" />;

  const liveConnecting = liveSession && connectionStatus === 'connecting';
  const liveStreaming = liveSession && connectionStatus === 'connected';
  const liveBpm = liveHr.length > 0 ? liveHr[liveHr.length - 1].v : 0;

  const onToggleLive = () => {
    // Early stop: the stream loop exits and the client restores AUTOMATIC
    // mode, exactly as on natural completion.
    if (liveStreaming) {
      stopLiveHeartRate();
      return;
    }
    if (liveSession) return; // still connecting
    // No paired ring → choosing one is the pairing screen's job, not a blind
    // scan from here.
    if (!ringDeviceId) {
      router.push('/pair');
      return;
    }
    setLiveError(null);
    setLiveSession(true);
    void streamLiveHeartRate(60).finally(() => {
      setLiveSession(false);
      // streamLiveHeartRate surfaces failures via syncError; capture it here
      // so the card shows it readably instead of spinning forever. A stale
      // error from an unrelated sync never appears on this card.
      setLiveError(useHealthStore.getState().syncError);
    });
  };

  const rgb = hexToRgb(metric.color);
  // Temp display conversion: the store stays in °C — absolute readings use
  // °F = °C×9/5+32, deviations the Δ rule (×9/5, no offset). Other metrics
  // pass through untouched. Temp keeps 1 decimal in both units/modes.
  const isTemp = metric.id === 'temp';
  const toDisplay = (v: number): number =>
    !isTemp ? v : tempAbsMode ? toDisplayTemp(v, units) : toDisplayTempDelta(v, units);
  const fmt = (v: number) => {
    const d = toDisplay(v);
    const signed = tempAbsMode ? false : metric.signed;
    return `${signed && d >= 0 ? '+' : ''}${d.toFixed(metric.decimals)}`;
  };
  const displayUnit = isTemp ? tempUnit(units) : metric.unit;
  // The static rangeLabel mentions °C — recompute the bound with the Δ rule.
  const rangeLabel = isTemp
    ? `Baseline ± ${toDisplayTempDelta(0.3, units).toFixed(1)} ${tempUnit(units)}`
    : metric.rangeLabel;

  // TREND card: derived/longitudinal content renders only when the group's
  // trend is ready; before that it shows what unlocks it — never a fake
  // zero-line. (metric is non-null past the Redirect above.)
  const trend = maturity!;
  const showTrend = trend.trendReady && daily.length > 0;

  return (
    <Screen aura={metric.seriesId === 'hr' || metric.seriesId === 'spo2' ? 'sleep' : 'readiness'}>
      <ScreenHeader
        title={metric.title}
        left={<BackButton onPress={() => router.back()} />}
        right={<Label size={10} em={0.14}>{fmtDate(Date.now())}</Label>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={20} tint={metric.tint} contentStyle={{ gap: 4 }}>
          <CardHeading
            icon={metric.icon}
            tint={metric.tint}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View
                  style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: metric.color }}
                />
                <Label size={8} em={0.12} color={palette.faint}>
                  {nightBacked ? 'Night' : 'Live'}
                </Label>
              </View>
            }>
            {nightBacked ? 'Latest' : 'Current'}
          </CardHeading>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            {current != null ? (
              <AnimatedNumber
                value={toDisplay(current)}
                decimals={metric.decimals}
                signed={tempAbsMode ? false : metric.signed}
                size={44}
                weight="displayLight"
              />
            ) : (
              <Text style={{ fontSize: 44, fontFamily: fontFamily.displayLight, color: palette.ink }}>
                {(0).toFixed(metric.decimals)}
              </Text>
            )}
            <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.muted }}>
              {displayUnit}
            </Text>
          </View>
          {currentSample != null ? (
            // Time context is explicit, not implied: this value is the latest
            // measurement in the series — say when it was taken.
            <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.faint }}>
              {`${fmtDate(currentSample.t)} · ${fmtClock(currentSample.t)}`}
            </Text>
          ) : null}
          {tempAbsMode ? (
            <Text style={{ fontSize: 10, fontFamily: fontFamily.regular, color: palette.faint, lineHeight: 15 }}>
              Absolute skin temperature — your personal baseline builds over the first nights,
              then this switches to deviation.
            </Text>
          ) : null}
          {nightBacked && current == null ? (
            // A 0 here means "no overnight measurement yet" — say so, or the
            // 0 next to a daytime-HR chart below reads as broken.
            <Text style={{ fontSize: 10, fontFamily: fontFamily.regular, color: palette.faint, lineHeight: 15 }}>
              {maturity?.copy.unlock ??
                'Measured during sleep — wear the ring tonight to get your first reading.'}
            </Text>
          ) : null}
          <RangeSelector
            options={TIME_RANGE_OPTIONS}
            value={range}
            onChange={setRange}
            style={{ marginTop: 12 }}
          />
          {chartData.length >= 1 ? (
            <Sparkline
              data={chartData}
              height={110}
              color={metric.color}
              strokeWidth={2}
              dot="end"
              fillGradient={[`rgba(${rgb},0.22)`, `rgba(${rgb},0)`]}
              delay={250}
              duration={1300}
              interactive
              xLabels={chartXLabels}
              xValues={chartXValues}
              formatValue={fmt}
              yLabels={[fmt(Math.min(...chartData)), fmt(Math.max(...chartData))]}
              style={{ marginTop: 10 }}
            />
          ) : (
            <Text
              style={{
                fontSize: 12,
                fontFamily: fontFamily.regular,
                color: palette.slate,
                lineHeight: 18,
                marginTop: 10,
              }}>
              No samples in this range yet — sync your ring to fill this chart.
            </Text>
          )}
        </GlassCard>
      </Animated.View>

      {metric.seriesId === 'hr' ? (
        <Animated.View entering={FadeInDown.delay(80).duration(500)}>
          <GlassCard radius={28} padding={20} tint={metric.tint} contentStyle={{ gap: 10 }}>
            <CardHeading
              icon="heart"
              tint={metric.tint}
              right={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: liveStreaming ? palette.mint.deep : palette.faint,
                    }}
                  />
                  <Label size={8} em={0.12} color={palette.faint}>
                    {liveStreaming ? 'Streaming' : liveConnecting ? 'Starting' : 'Idle'}
                  </Label>
                </View>
              }>
              Live heart rate
            </CardHeading>
            {liveSession || liveHr.length > 0 ? (
              <>
                {liveHr.length > 0 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                    <AnimatedNumber value={liveBpm} size={44} weight="displayLight" />
                    <Text
                      style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.muted }}>
                      bpm
                    </Text>
                  </View>
                ) : null}
                {liveBeats.length >= 2 ? (
                  <Sparkline
                    data={liveBeats}
                    height={48}
                    color={metric.color}
                    strokeWidth={2}
                    dot="end"
                    fillGradient={[`rgba(${rgb},0.22)`, `rgba(${rgb},0)`]}
                    duration={400}
                  />
                ) : (
                  // No big 0 bpm here — 0 is a reading, not a placeholder.
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: fontFamily.regular,
                      color: palette.faint,
                      lineHeight: 16,
                    }}>
                    {liveConnecting
                      ? 'Connecting to your ring…'
                      : 'Waiting for the first beat — keep the ring snug on your finger.'}
                  </Text>
                )}
              </>
            ) : (
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: fontFamily.regular,
                  color: palette.slate,
                  lineHeight: 18,
                }}>
                Start a 60-second session to watch your heart rate beat by beat — keep the ring on
                your finger.
              </Text>
            )}
            <Pill
              variant={liveStreaming ? 'peach' : 'mint'}
              em={0.16}
              onPress={onToggleLive}
              disabled={liveConnecting}
              style={{ alignSelf: 'flex-start' }}>
              {liveStreaming
                ? 'Stop'
                : liveConnecting
                  ? 'Starting…'
                  : liveHr.length > 0
                    ? 'Restart (60 s)'
                    : 'Start live (60 s)'}
            </Pill>
            {liveError != null && !liveSession ? (
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: fontFamily.regular,
                  color: palette.peach.deep,
                  lineHeight: 16,
                }}>
                {liveError}
              </Text>
            ) : null}
          </GlassCard>
        </Animated.View>
      ) : null}

      <Animated.View entering={FadeInDown.delay(120).duration(500)}>
        <GlassCard radius={28} padding={20} contentStyle={{ gap: 6 }}>
          <CardHeading
            icon="trending-up"
            tint={metric.tint}
            right={
              showTrend ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                  <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.ink }}>
                    {fmt(stats.avg)}
                  </Text>
                  <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.muted }}>
                    avg
                  </Text>
                </View>
              ) : undefined
            }>
            30-Day Trend
          </CardHeading>
          {showTrend ? (
            <>
              <Sparkline data={daily} height={72} color={metric.color} delay={450} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
                <StatBlock value={fmt(stats.min)} label="Low" size={20} align="center" />
                <StatBlock value={fmt(stats.avg)} label="Average" size={20} align="center" />
                <StatBlock value={fmt(stats.max)} label="High" size={20} align="center" />
              </View>
            </>
          ) : (
            <Text
              style={{
                fontSize: 12,
                fontFamily: fontFamily.regular,
                color: palette.slate,
                lineHeight: 18,
                marginTop: 4,
              }}>
              {trend.trendReady
                ? 'No daily trend yet — it builds up as you sync your ring over the coming days.'
                : (trend.copy.unlock ?? trend.copy.none)}
            </Text>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(200).duration(500)}>
        <GlassCard radius={26} padding={20} contentStyle={{ gap: 10 }}>
          <Label size={9} em={0.18}>About</Label>
          <Text
            style={{
              fontSize: 12,
              fontFamily: fontFamily.regular,
              color: palette.slate,
              lineHeight: 19,
            }}>
            {metric.insight}
          </Text>
          <Pill variant="neutral" em={0.08}>{rangeLabel}</Pill>
          {isTemp ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 4,
              }}>
              <Label size={9} em={0.18}>Units</Label>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['imperial', 'metric'] as Units[]).map((u) => (
                  <Pill
                    key={u}
                    variant={units === u ? 'ink' : 'neutral'}
                    em={0.1}
                    onPress={() => setUnits(u)}
                    accessibilityLabel={`Show temperatures in ${tempUnit(u)}`}>
                    {tempUnit(u)}
                  </Pill>
                ))}
              </View>
            </View>
          ) : null}
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}
