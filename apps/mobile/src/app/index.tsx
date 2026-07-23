import {
  AnimatedNumber,
  CardHeading,
  Chevron,
  DotTrend,
  GlassCard,
  GlassCircle,
  IconBadge,
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
import { useDays, useToday } from '@/data/hooks';
import { fmtDate } from '@/data/selectors';

function readinessStatus(score: number): string {
  if (score >= 85) return 'Optimal';
  if (score >= 70) return 'Good';
  return 'Recover';
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const router = useRouter();
  const today = useToday();
  const days = useDays();
  const hrv14 = days.slice(-14).map((d) => d.hrvAvg);
  const rhr14 = days.slice(-14).map((d) => d.restingHr);
  const temp7 = days.slice(-7).map((d) => d.tempDeviation);

  return (
    <Screen aura="home" gap={spacing.gridGap}>
      <ScreenHeader
        left={
          <View style={{ gap: 3 }}>
            <Text style={{ fontSize: 22, fontFamily: fontFamily.displayItalic, color: palette.ink }}>
              {greeting()}
            </Text>
            <Label size={9} em={0.16}>{fmtDate(Date.now(), true)}</Label>
          </View>
        }
        right={
          <GlassCircle size={32} onPress={() => router.push('/trends')}>
            <RingIcon />
          </GlassCircle>
        }
      />

      <Animated.View entering={FadeInDown.delay(40).duration(500)}>
        <GlassCard
          radius={28}
          padding={16}
          tint="mint"
          chevron
          onPress={() => router.push('/readiness')}
          contentStyle={{ alignItems: 'center', gap: 8 }}>
          <IconBadge
            name="lightning-bolt"
            tint="mint"
            style={{ position: 'absolute', top: 16, left: 16 }}
          />
          <ScoreRing size={146} value={today.readiness} colors={gradients.readiness} strokeWidth={10}>
            <AnimatedNumber value={today.readiness} size={44} weight="displayLight" />
            <Label size={9} em={0.2}>Readiness</Label>
          </ScoreRing>
          <Pill variant="mint" em={0.18} style={{ alignSelf: 'center' }}>
            {readinessStatus(today.readiness)}
          </Pill>
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(80).duration(500)}
        style={{ flexDirection: 'row', gap: spacing.cardGap }}>
        <GlassCard
          radius={26}
          padding={14}
          tint="indigo"
          chevron
          chevronOffset={{ top: 18, right: 16 }}
          onPress={() => router.push('/sleep')}
          style={{ flex: 1 }}
          contentStyle={{ alignItems: 'center', gap: 7 }}>
          <ScoreRing size={92} value={today.sleepScore} colors={gradients.sleep} strokeWidth={8} delay={150}>
            <Text style={{ fontSize: 28, fontFamily: fontFamily.displayLight, color: palette.ink }}>
              {today.sleepScore}
            </Text>
          </ScoreRing>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <IconBadge name="sleep" tint="indigo" size={18} />
            <Label size={9} em={0.2}>Sleep</Label>
          </View>
        </GlassCard>
        <GlassCard
          radius={26}
          padding={14}
          tint="peach"
          chevron
          chevronOffset={{ top: 18, right: 16 }}
          onPress={() => router.push('/activity')}
          style={{ flex: 1 }}
          contentStyle={{ alignItems: 'center', gap: 7 }}>
          <ScoreRing size={92} value={today.activityScore} colors={gradients.activity} strokeWidth={8} delay={250}>
            <Text style={{ fontSize: 28, fontFamily: fontFamily.displayLight, color: palette.ink }}>
              {today.activityScore}
            </Text>
          </ScoreRing>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <IconBadge name="fire" tint="peach" size={18} />
            <Label size={9} em={0.2}>Activity</Label>
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(160).duration(500)}
        style={{ flexDirection: 'row', gap: spacing.gridGap }}>
        <GlassCard
          radius={24}
          padding={13}
          tint="mint"
          onPress={() => router.push('/metric/hrv')}
          style={{ flex: 1 }}
          contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart-pulse" tint="mint" right={<Chevron size={7} />}>
            HRV
          </CardHeading>
          <MetricValue value={String(today.hrvAvg)} unit="ms" />
          <Sparkline data={hrv14} height={22} color={palette.mint.base} delay={350} />
        </GlassCard>
        <GlassCard
          radius={24}
          padding={13}
          tint="indigo"
          onPress={() => router.push('/metric/rhr')}
          style={{ flex: 1 }}
          contentStyle={{ gap: 6 }}>
          <CardHeading icon="heart" tint="indigo" right={<Chevron size={7} />}>
            Resting HR
          </CardHeading>
          <MetricValue value={String(today.restingHr)} unit="bpm" />
          <Sparkline data={rhr14} height={22} color={palette.indigo.base} delay={420} />
        </GlassCard>
      </Animated.View>

      <Animated.View
        entering={FadeInDown.delay(240).duration(500)}
        style={{ flexDirection: 'row', gap: spacing.gridGap }}>
        <GlassCard
          radius={24}
          padding={13}
          tint="lavender"
          onPress={() => router.push('/metric/temp')}
          style={{ flex: 1 }}
          contentStyle={{ gap: 6 }}>
          <CardHeading icon="thermometer" tint="lavender" right={<Chevron size={7} />}>
            Body Temp
          </CardHeading>
          <MetricValue
            value={`${today.tempDeviation >= 0 ? '+' : ''}${today.tempDeviation.toFixed(1)}`}
            unit="°C"
          />
          <DotTrend data={temp7} height={22} delay={500} />
        </GlassCard>
        <GlassCard
          radius={24}
          padding={13}
          tint="peach"
          onPress={() => router.push('/metric/spo2')}
          style={{ flex: 1 }}
          contentStyle={{ gap: 6 }}>
          <CardHeading icon="lungs" tint="peach" right={<Chevron size={7} />}>
            SpO2
          </CardHeading>
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
