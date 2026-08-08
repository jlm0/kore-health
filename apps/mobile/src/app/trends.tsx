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
import { EmptyDataCard } from '@/components/EmptyDataCard';
import { useDataset, useDays, useMaturities, useUnits } from '@/data/hooks';
import { MATURITY_COPY } from '@/data/maturity';
import {
  avgPositive,
  dailySeriesAverages,
  fmtDate,
  fmtHoursMinutes,
  hasNightData,
  meanOf,
  normalize,
} from '@/data/selectors';
import { tempUnit, toDisplayTemp } from '@/data/units';
import { useHealthStore } from '@/store/health';

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

// A trend that isn't ready renders a numeric 0 + its unlock requirement —
// never a dash, never an invented number.
function TrendRequirement({ text }: { text: string }) {
  return (
    <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.faint, lineHeight: 13 }}>
      {text}
    </Text>
  );
}

export default function TrendsScreen() {
  const router = useRouter();
  const days = useDays();
  const dataset = useDataset();
  const maturities = useMaturities();
  const units = useUnits();
  const tempAbsSeries = useHealthStore((s) => s.tempAbsSeries);

  const last28 = days.slice(-28);
  const heatValues = useMemo(() => normalize(last28.map((d) => d.readiness)), [last28]);
  const dayLetters = useMemo(
    () => last28.slice(0, 7).map((d) => 'SMTWTFS'[new Date(d.dayStart).getDay()]),
    [last28],
  );

  // Axis labels for the trend sparklines: first/last date for long series,
  // weekday letters for 7-day windows.
  const rangeLabels = (list: readonly { dayStart: number }[]): string[] | undefined =>
    list.length >= 2
      ? [fmtDate(list[0].dayStart), fmtDate(list[list.length - 1].dayStart)]
      : undefined;
  const weekLetters = (list: readonly { dayStart: number }[]): string[] =>
    list.map((d) => 'SMTWTFS'[new Date(d.dayStart).getDay()]);

  if (days.length === 0) {
    return (
      <Screen aura="trends">
        <ScreenHeader title="Trends" left={<BackButton onPress={() => router.back()} />} />
        <EmptyDataCard
          icon="calendar-month"
          tint="lavender"
          title="No trends yet"
          message="Trends appear after a few days of ring syncs."
        />
      </Screen>
    );
  }

  // Every average skips days where the value is 0-because-unmeasured (or a
  // neutral-fallback readiness score) — averaging those in would fabricate a
  // number. The trendReady gates below guarantee the filtered lists are
  // non-empty, but the helpers still return null rather than a fake 0.
  const sleepDays = days.filter((d) => d.sleep.durationMin > 0);
  const sleepScores = sleepDays.map((d) => d.sleepScore);
  const sleepAvg = meanOf(sleepScores);

  const hrvDaily = days.map((d) => d.hrvAvg);
  const rhrDaily = days.map((d) => d.restingHr);
  const hrvRecent = avgPositive(hrvDaily.slice(-7));
  const rhrRecent = avgPositive(rhrDaily.slice(-7));
  // A prior week only counts if it has real values — never compare against an
  // empty/all-zero slice's fake 0.
  const hrvPrior = avgPositive(hrvDaily.slice(-14, -7));
  const rhrPrior = avgPositive(rhrDaily.slice(-14, -7));

  const readinessAvg = meanOf(days.filter(hasNightData).map((d) => d.readiness));
  const sleepDurAvg = meanOf(sleepDays.map((d) => d.sleep.durationMin));
  const hrvAvg30 = avgPositive(hrvDaily);

  // Immediate-data cards: real measured values from day 1, no night required.
  // Activity — raw active calories, real as soon as any movement exists.
  const activityCal7 = days.slice(-7).map((d) => d.activity.activeCal);
  const activityAvg = avgPositive(activityCal7);
  // Daytime HR — daily averages of the measured HR series.
  const hrDaily = dailySeriesAverages(dataset.series.hr);
  const hrDaily7 = hrDaily.slice(-7).map((d) => d.avg);
  const hrRecent = avgPositive(hrDaily7);
  // Temperature — daily averages of the absolute skin-temp series (°C in the
  // store, converted only for display).
  const tempDaily = dailySeriesAverages(tempAbsSeries);
  const tempDaily7 = tempDaily.slice(-7);
  const tempSpark = tempDaily7.map((d) => toDisplayTemp(d.avg, units));
  const tempRecent =
    tempDaily7.length > 0
      ? toDisplayTemp(tempDaily7.reduce((s, d) => s + d.avg, 0) / tempDaily7.length, units)
      : null;

  return (
    <Screen aura="trends">
      <ScreenHeader
        title="Trends"
        left={<BackButton onPress={() => router.back()} />}
        right={<Pill variant="mint" em={0.14} paddingH={10}>{`${days.length} d`}</Pill>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={20} tint="lavender">
          <CardHeading icon="calendar-month" tint="lavender">Readiness</CardHeading>
          {maturities.readiness.trendReady ? (
            <HeatmapGrid
              values={heatValues}
              dayLabels={dayLetters}
              delay={150}
              style={{ marginTop: 14 }}
            />
          ) : (
            <View style={{ marginTop: 14, gap: 4 }}>
              <Text style={{ fontSize: 20, fontFamily: fontFamily.displayLight, color: palette.muted }}>0</Text>
              <TrendRequirement text={MATURITY_COPY.readiness.none} />
            </View>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(500)}>
        <GlassCard radius={28} padding={20}>
          <CardHeading
            icon="sleep"
            tint="indigo"
            right={
              maturities.sleep.trendReady ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                  <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.ink }}>
                    {sleepAvg ?? '0'}
                  </Text>
                  <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.muted }}>
                    avg
                  </Text>
                </View>
              ) : undefined
            }>
            Sleep Score
          </CardHeading>
          {maturities.sleep.trendReady ? (
            <Sparkline
              data={sleepScores}
              height={64}
              color={palette.indigo.base}
              fillGradient={['rgba(126,150,224,0.25)', 'rgba(126,150,224,0)']}
              delay={300}
              xLabels={rangeLabels(sleepDays)}
              style={{ marginTop: 10 }}
            />
          ) : (
            <View style={{ marginTop: 10, gap: 4 }}>
              <Text style={{ fontSize: 20, fontFamily: fontFamily.displayLight, color: palette.muted }}>0</Text>
              <TrendRequirement text={MATURITY_COPY.sleep.unlock!} />
            </View>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(120).duration(500)}>
        <GlassCard radius={28} padding={20} tint="peach">
          <CardHeading
            icon="fire"
            tint="peach"
            right={
              maturities.activity.state === 'ready' ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
                  <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.ink }}>
                    {activityAvg ?? '0'}
                  </Text>
                  <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.muted }}>
                    cal avg
                  </Text>
                </View>
              ) : undefined
            }>
            Activity
          </CardHeading>
          {maturities.activity.state === 'ready' ? (
            <Sparkline
              data={activityCal7}
              height={64}
              color={palette.peach.light}
              fillGradient={['rgba(239,181,140,0.25)', 'rgba(239,181,140,0)']}
              delay={380}
              xLabels={weekLetters(days.slice(-7))}
              style={{ marginTop: 10 }}
            />
          ) : (
            <View style={{ marginTop: 10, gap: 4 }}>
              <Text style={{ fontSize: 20, fontFamily: fontFamily.displayLight, color: palette.muted }}>0</Text>
              <TrendRequirement text={MATURITY_COPY.activity.empty} />
            </View>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        <GlassCard radius={24} padding={16} tint="mint" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart-pulse" tint="mint">HRV</CardHeading>
          {maturities.hrv.trendReady ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <MetricValue value={hrvRecent != null ? String(hrvRecent) : '0'} size={24} />
                {hrvRecent != null && hrvPrior != null ? (
                  <TrendDelta delta={hrvRecent - hrvPrior} improving={hrvRecent >= hrvPrior} />
                ) : null}
              </View>
              <Sparkline
                data={hrvDaily}
                height={36}
                color={palette.mint.base}
                delay={450}
                xLabels={rangeLabels(days)}
              />
            </>
          ) : (
            <>
              <MetricValue value="0" size={24} />
              <TrendRequirement text={MATURITY_COPY.hrv.none} />
            </>
          )}
        </GlassCard>
        <GlassCard radius={24} padding={16} tint="indigo" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart" tint="indigo">Resting HR</CardHeading>
          {maturities.hr.trendReady ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <MetricValue value={rhrRecent != null ? String(rhrRecent) : '0'} size={24} />
                {rhrRecent != null && rhrPrior != null ? (
                  <TrendDelta delta={rhrRecent - rhrPrior} improving={rhrRecent <= rhrPrior} />
                ) : null}
              </View>
              <Sparkline
                data={rhrDaily}
                height={36}
                color={palette.indigo.base}
                delay={520}
                xLabels={rangeLabels(days)}
              />
            </>
          ) : (
            <>
              <MetricValue value="0" size={24} />
              <TrendRequirement text={MATURITY_COPY.hr.unlock!} />
            </>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(200).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        <GlassCard radius={24} padding={16} tint="indigo" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart" tint="indigo">Daytime HR</CardHeading>
          {hrDaily.length > 0 ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <MetricValue value={hrRecent != null ? String(hrRecent) : '0'} size={24} />
                <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.muted }}>
                  bpm
                </Text>
              </View>
              <Sparkline
                data={hrDaily7}
                height={36}
                color={palette.indigo.base}
                delay={590}
                xLabels={weekLetters(hrDaily.slice(-7))}
              />
            </>
          ) : (
            <>
              <MetricValue value="0" size={24} />
              <TrendRequirement text={MATURITY_COPY.hr.empty} />
            </>
          )}
        </GlassCard>
        <GlassCard radius={24} padding={16} tint="lavender" style={{ flex: 1 }} contentStyle={{ gap: 6 }}>
          <CardHeading icon="thermometer" tint="lavender">Temperature</CardHeading>
          {tempDaily.length > 0 ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <MetricValue
                  value={tempRecent != null ? tempRecent.toFixed(1) : '0.0'}
                  unit={tempUnit(units)}
                  size={24}
                />
              </View>
              <Sparkline
                data={tempSpark}
                height={36}
                color={palette.lavender.base}
                delay={660}
                xLabels={weekLetters(tempDaily7)}
              />
            </>
          ) : (
            <>
              <MetricValue value="0.0" unit={tempUnit(units)} size={24} />
              <TrendRequirement text={MATURITY_COPY.temp.empty} />
            </>
          )}
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(240).duration(500)}
        style={{ flexDirection: 'row', gap: 13 }}>
        {[
          { value: maturities.readiness.trendReady && readinessAvg != null ? String(readinessAvg) : '0', label: 'Readiness' },
          { value: maturities.sleep.trendReady && sleepDurAvg != null ? fmtHoursMinutes(sleepDurAvg) : '0:00', label: 'Sleep' },
          { value: maturities.hrv.trendReady && hrvAvg30 != null ? String(hrvAvg30) : '0', label: 'HRV' },
          { value: maturities.activity.state === 'ready' && activityAvg != null ? String(activityAvg) : '0', label: 'Activity' },
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
