import {
  AnimatedNumber,
  BackButton,
  GlassCard,
  Label,
  Pill,
  Screen,
  ScreenHeader,
  Sparkline,
  StatBlock,
  fontFamily,
  palette,
} from '@kore/ui';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDays, useLatestSample, useSeriesWindow } from '@/data/hooks';
import { METRICS, type MetricId } from '@/data/metrics';
import { fmtDate } from '@/data/selectors';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export default function MetricDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const metric = METRICS[id as MetricId];

  const days = useDays();
  const latest = useLatestSample(metric?.seriesId ?? 'hrv');
  const day24 = useSeriesWindow(metric?.seriesId ?? 'hrv', 24, 56);

  const daily = useMemo(
    () => (metric ? days.map((d) => metric.dailyValue(d)) : []),
    [days, metric],
  );

  const stats = useMemo(() => {
    if (daily.length === 0) return { min: 0, max: 0, avg: 0 };
    return {
      min: Math.min(...daily),
      max: Math.max(...daily),
      avg: daily.reduce((s, v) => s + v, 0) / daily.length,
    };
  }, [daily]);

  if (!metric) return <Redirect href="/" />;

  const rgb = hexToRgb(metric.color);
  const fmt = (v: number) => {
    const rounded = Number(v.toFixed(metric.decimals)) + 0;
    return `${metric.signed && rounded >= 0 ? '+' : ''}${rounded.toFixed(metric.decimals)}`;
  };

  return (
    <Screen aura={metric.seriesId === 'hr' || metric.seriesId === 'spo2' ? 'sleep' : 'readiness'}>
      <ScreenHeader
        title={metric.title}
        left={<BackButton onPress={() => router.back()} />}
        right={<Label size={10} em={0.14}>{fmtDate(Date.now())}</Label>}
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard radius={28} padding={20} contentStyle={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Label size={9} em={0.18}>Current</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View
                style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: metric.color }}
              />
              <Label size={8} em={0.12} color={palette.faint}>Live</Label>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <AnimatedNumber
              value={latest}
              decimals={metric.decimals}
              signed={metric.signed}
              size={44}
              weight="extraLight"
            />
            <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.muted }}>
              {metric.unit}
            </Text>
          </View>
          <Sparkline
            data={day24}
            height={110}
            color={metric.color}
            strokeWidth={2}
            dot="end"
            fillGradient={[`rgba(${rgb},0.22)`, `rgba(${rgb},0)`]}
            delay={250}
            duration={1300}
            style={{ marginTop: 10 }}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            {['-24h', '-18h', '-12h', '-6h', 'Now'].map((t) => (
              <Text key={t} style={{ fontSize: 8, fontFamily: fontFamily.regular, color: palette.faint }}>
                {t}
              </Text>
            ))}
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).duration(500)}>
        <GlassCard radius={28} padding={20} contentStyle={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Label size={9} em={0.18}>30-Day Trend</Label>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
              <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.ink }}>
                {fmt(stats.avg)}
              </Text>
              <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.muted }}>
                avg
              </Text>
            </View>
          </View>
          <Sparkline data={daily} height={72} color={metric.color} delay={450} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
            <StatBlock value={fmt(stats.min)} label="Low" size={20} align="center" />
            <StatBlock value={fmt(stats.avg)} label="Average" size={20} align="center" />
            <StatBlock value={fmt(stats.max)} label="High" size={20} align="center" />
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(160).duration(500)}>
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
          <Pill variant="neutral" em={0.08}>{metric.rangeLabel}</Pill>
        </GlassCard>
      </Animated.View>
    </Screen>
  );
}
