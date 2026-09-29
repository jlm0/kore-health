import {
  BackButton,
  CardHeading,
  GlassCard,
  HeadingAvg,
  HeatmapGrid,
  MetricValue,
  Pill,
  Screen,
  ScreenHeader,
  Sparkline,
  Txt,
  brandInk,
  palette,
  type CardTint,
  type IconBadgeName,
  type IconTint,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { EmptyDataCard } from '@/components/EmptyDataCard';
import { useDataset, useDays, useMaturities, useUnits } from '@/data/hooks';
import { MATURITY_COPY } from '@/data/maturity';
import {
  avgPositive,
  dailySeriesAverages,
  fmtDate,
  fmtDuration,
  hasNightData,
  meanOf,
  normalize,
} from '@/data/selectors';
import { tempUnit, toDisplayTemp } from '@/data/units';
import { useHealthStore } from '@/store/health';

function GroupHeading({ children, first = false }: { children: string; first?: boolean }) {
  return (
    <Txt role="label" style={{ marginTop: first ? 0 : 16, marginBottom: 4, paddingHorizontal: 12 }}>
      {children}
    </Txt>
  );
}

interface TrendCardProps {
  title: string;
  icon: IconBadgeName;
  iconTint: IconTint;
  tint?: CardTint;
  avg?: { value: string; unit: string } | null;
  delay: number;
  children: React.ReactNode;
}

function TrendCard({ title, icon, iconTint, tint, avg, delay, children }: TrendCardProps) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(500)}>
      <GlassCard tint={tint} contentStyle={{ gap: 16 }}>
        <CardHeading
          icon={icon}
          tint={iconTint}
          right={avg ? <HeadingAvg value={avg.value} unit={avg.unit} /> : undefined}>
          {title}
        </CardHeading>
        {children}
      </GlassCard>
    </Animated.View>
  );
}

// A trend that isn't ready renders a numeric 0 + its unlock requirement —
// never a dash, never an invented number.
function TrendRequirement({ text, unit }: { text: string; unit?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <MetricValue value="0" unit={unit} color={palette.muted} />
      <Txt role="caption">{text}</Txt>
    </View>
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

  // Axis labels: first/last date for long series, weekday letters for 7-day
  // windows.
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
          art="trends"
          tint="lavender"
          title="No trends yet"
          message="Trends appear after a few days of ring syncs."
        />
      </Screen>
    );
  }

  // Every average skips days where the value is 0-because-unmeasured (or a
  // neutral-fallback readiness score) — averaging those in would fabricate a
  // number.
  const sleepDays = days.filter((d) => d.sleep.durationMin > 0);
  const sleepScores = sleepDays.map((d) => d.sleepScore);
  const sleepAvg = meanOf(sleepScores);
  const sleepDurAvg = meanOf(sleepDays.map((d) => d.sleep.durationMin));

  const hrvDaily = days.map((d) => d.hrvAvg);
  const rhrDaily = days.map((d) => d.restingHr);
  const hrvRecent = avgPositive(hrvDaily.slice(-7));
  const rhrRecent = avgPositive(rhrDaily.slice(-7));

  const readinessAvg = meanOf(days.filter(hasNightData).map((d) => d.readiness));

  // Immediate-data cards: real measured values from day 1, no night required.
  const activityCal7 = days.slice(-7).map((d) => d.activity.activeCal);
  const activityAvg = avgPositive(activityCal7);
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

  const sleepDur = sleepDurAvg != null ? fmtDuration(sleepDurAvg) : null;

  return (
    <Screen aura="trends">
      <ScreenHeader
        title="Trends"
        left={<BackButton onPress={() => router.back()} />}
        right={<Pill variant="mint" paddingH={10}>{`${days.length} d`}</Pill>}
      />

      <View style={{ gap: 6 }}>
        <GroupHeading first>Scores</GroupHeading>
        <TrendCard
          title="Readiness"
          icon="lightning-bolt"
          iconTint="mint"
          avg={maturities.readiness.trendReady && readinessAvg != null ? { value: String(readinessAvg), unit: 'avg' } : null}
          delay={40}>
          {maturities.readiness.trendReady ? (
            <HeatmapGrid values={heatValues} dayLabels={dayLetters} delay={150} />
          ) : (
            <TrendRequirement text={MATURITY_COPY.readiness.none} />
          )}
        </TrendCard>
        <TrendCard
          title="Sleep score"
          icon="sleep"
          iconTint="indigo"
          tint="indigo"
          avg={maturities.sleep.trendReady && sleepAvg != null ? { value: String(sleepAvg), unit: 'avg' } : null}
          delay={80}>
          {maturities.sleep.trendReady ? (
            <>
              <Sparkline
                data={sleepScores}
                height={64}
                color={brandInk.indigo}
                delay={300}
                xLabels={rangeLabels(sleepDays)}
              />
              {sleepDur ? <Txt role="caption">{`Average time asleep ${sleepDur.h}h ${sleepDur.m}m`}</Txt> : null}
            </>
          ) : (
            <TrendRequirement text={MATURITY_COPY.sleep.unlock!} />
          )}
        </TrendCard>
        <TrendCard
          title="Activity"
          icon="fire"
          iconTint="peach"
          tint="peach"
          avg={maturities.activity.state === 'ready' && activityAvg != null ? { value: String(activityAvg), unit: 'cal avg' } : null}
          delay={120}>
          {maturities.activity.state === 'ready' ? (
            <Sparkline
              data={activityCal7}
              height={64}
              color={brandInk.peach}
              delay={380}
              xLabels={weekLetters(days.slice(-7))}
            />
          ) : (
            <TrendRequirement text={MATURITY_COPY.activity.empty} unit="cal" />
          )}
        </TrendCard>
      </View>

      <View style={{ gap: 6 }}>
        <GroupHeading>Body</GroupHeading>
        <TrendCard
          title="HRV"
          icon="heart-pulse"
          iconTint="mint"
          tint="mint"
          avg={maturities.hrv.trendReady && hrvRecent != null ? { value: String(hrvRecent), unit: 'ms' } : null}
          delay={160}>
          {maturities.hrv.trendReady ? (
            <Sparkline data={hrvDaily} height={56} color={brandInk.mint} delay={450} xLabels={rangeLabels(days)} />
          ) : (
            <TrendRequirement text={MATURITY_COPY.hrv.none} unit="ms" />
          )}
        </TrendCard>
        <TrendCard
          title="Resting HR"
          icon="heart"
          iconTint="indigo"
          avg={maturities.hr.trendReady && rhrRecent != null ? { value: String(rhrRecent), unit: 'bpm' } : null}
          delay={200}>
          {maturities.hr.trendReady ? (
            <Sparkline data={rhrDaily} height={56} color={palette.indigo.base} delay={520} xLabels={rangeLabels(days)} />
          ) : (
            <TrendRequirement text={MATURITY_COPY.hr.unlock!} unit="bpm" />
          )}
        </TrendCard>
        <TrendCard
          title="Daytime HR"
          icon="heart-outline"
          iconTint="indigo"
          tint="indigo"
          avg={hrRecent != null ? { value: String(hrRecent), unit: 'bpm' } : null}
          delay={240}>
          {hrDaily.length > 0 ? (
            <Sparkline
              data={hrDaily7}
              height={56}
              color={brandInk.indigo}
              delay={590}
              xLabels={weekLetters(hrDaily.slice(-7))}
            />
          ) : (
            <TrendRequirement text={MATURITY_COPY.hr.empty} unit="bpm" />
          )}
        </TrendCard>
        <TrendCard
          title="Temperature"
          icon="thermometer"
          iconTint="lavender"
          tint="lavender"
          avg={tempRecent != null ? { value: tempRecent.toFixed(1), unit: tempUnit(units) } : null}
          delay={280}>
          {tempDaily.length > 0 ? (
            <Sparkline
              data={tempSpark}
              height={56}
              color={brandInk.lavender}
              delay={660}
              xLabels={weekLetters(tempDaily7)}
            />
          ) : (
            <TrendRequirement text={MATURITY_COPY.temp.empty} unit={tempUnit(units)} />
          )}
        </TrendCard>
      </View>
    </Screen>
  );
}
