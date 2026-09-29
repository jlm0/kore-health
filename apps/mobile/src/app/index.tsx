import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  AnimatedNumber,
  Button,
  Chevron,
  GlassCard,
  GlassCircle,
  IconBadge,
  Illustration,
  Label,
  MetricValue,
  Pill,
  RingIcon,
  Screen,
  ScoreRing,
  Txt,
  fontFamily,
  gradients,
  haptics,
  palette,
  spacing,
  surfaces,
  type,
  type IconBadgeName,
  type IconTint,
} from '@kore/ui';
import { useRouter, type Href } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDays, useDataset, useLatestSample, useMaturities, useToday, useUnits } from '@/data/hooks';
import {
  avgPositive,
  fmtDate,
  fmtDuration,
  hasTempBaselineForDay,
  samplesWithinSleepWindows,
} from '@/data/selectors';
import type { DaySummary } from '@/data/types';
import { tempUnit, toDisplayTemp, toDisplayTempDelta } from '@/data/units';
import { syncRing } from '@/ring/sync';
import { useHealthStore } from '@/store/health';

function readinessStatus(score: number): string {
  if (score >= 85) return 'Optimal';
  if (score >= 70) return 'Good';
  return 'Recover';
}

function readinessClause(score: number): string {
  if (score >= 85) return 'readiness is optimal';
  if (score >= 70) return 'readiness is good';
  return 'take it easy today';
}

// One grounded sentence under the readiness ring: last night's HRV against
// the prior week's measured nights. No prior week → no sentence.
function readinessInsight(today: DaySummary, days: readonly DaySummary[]): string | null {
  if (today.hrvAvg <= 0) return null;
  const prior = avgPositive(days.slice(-8, -1).map((d) => d.hrvAvg));
  if (prior == null) return null;
  const ratio = today.hrvAvg / prior;
  if (ratio < 0.95) {
    return `HRV is a little under your ${prior} ms average. A steady day will help you recover.`;
  }
  if (ratio > 1.05) {
    return `HRV is above your ${prior} ms average — a good day to push a little.`;
  }
  return `HRV is right on your ${prior} ms average.`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function relTime(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Keep the failure inline in the header: first clause of the error, capped.
// The full message stays on the connect card below.
function shortReason(error: string): string {
  const first = error.split(' — ')[0].trim();
  return first.length > 40 ? `${first.slice(0, 37)}…` : first;
}

interface VitalRowProps {
  icon: IconBadgeName;
  tint: IconTint;
  name: string;
  sub: string;
  value: string;
  unit: string;
  href: Href;
  first?: boolean;
}

function VitalRow({ icon, tint, name, sub, value, unit, href, first = false }: VitalRowProps) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        router.push(href);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${name}: ${value} ${unit}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: surfaces.hairline,
        opacity: pressed ? 0.6 : 1,
      })}>
      <IconBadge name={icon} tint={tint} size={26} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={[type.body, { fontFamily: fontFamily.medium, color: palette.ink }]}>
          {name}
        </Text>
        <Txt role="micro" numberOfLines={1}>
          {sub}
        </Txt>
      </View>
      <MetricValue value={value} unit={unit} size={22} />
      <Chevron size={7} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const today = useToday();
  const days = useDays();
  const dataset = useDataset();
  const connectionStatus = useHealthStore((s) => s.connectionStatus);
  const syncError = useHealthStore((s) => s.syncError);
  const lastSyncAt = useHealthStore((s) => s.lastSyncAt);
  const ringDeviceId = useHealthStore((s) => s.ringDeviceId);

  const busy = connectionStatus === 'connecting' || connectionStatus === 'connected' || connectionStatus === 'syncing';
  // Dedicated sync button (header) — no paired ring → choosing one is the
  // pairing screen's job, not a blind scan-and-grab sync.
  const onSync = () => {
    if (busy) return;
    if (!ringDeviceId) {
      router.push('/pair');
      return;
    }
    haptics.confirm();
    void syncRing();
  };
  // Bluetooth icon = ring management (pair, paired info, forget). Always
  // reachable — otherwise a stale saved id traps the user in failing syncs.
  const onManageRing = () => {
    if (busy) return;
    router.push('/pair');
  };

  // Status element: always visible without tapping, reflects sync health —
  // never "Connected" (we don't hold a persistent link; connect → sync →
  // disconnect by design).
  const statusText = !ringDeviceId
    ? 'Not connected'
    : busy
      ? connectionStatus === 'syncing'
        ? 'Syncing…'
        : 'Connecting…'
      : syncError
        ? `Sync failed — ${shortReason(syncError)}`
        : lastSyncAt
          ? `Synced ${relTime(lastSyncAt)}`
          : 'Not synced yet';
  const statusColor = !ringDeviceId
    ? palette.faint
    : busy
      ? palette.mint.base
      : syncError
        ? palette.destructive
        : lastSyncAt
          ? palette.success
          : palette.faint;
  // "Current" SpO2: the freshest of live/latest-vitals/last synced sample —
  // null when the ring has never reported one (SpO2 is never invented).
  const spo2Current = useLatestSample('spo2');

  // Card headlines: the LATEST measurement in each series. HRV/RHR use the
  // freshest sample INSIDE A DETECTED SLEEP WINDOW: resting means "measured
  // while you slept", never a daytime reading whatever the clock says. Each
  // row stamps when its value was measured.
  const hrvSleep = samplesWithinSleepWindows(dataset.series.hrv, days);
  const rhrSleep = samplesWithinSleepWindows(dataset.series.hr, days);
  const hrvSample = hrvSleep.length > 0 ? hrvSleep[hrvSleep.length - 1] : null;
  const rhrSample = rhrSleep.length > 0 ? rhrSleep[rhrSleep.length - 1] : null;

  // Data-presence gates come from the central maturity model (NOW/TODAY/TREND).
  // Absent values render as numeric 0 (never an invented number) with the
  // group's unlock copy beside them.
  const mat = useMaturities();
  const hasNight = mat.readiness.state === 'ready';
  const hasSleep = today != null && today.sleep.durationMin > 0;
  const hasActivity = mat.activity.state === 'ready';

  // Temp: until a personal baseline exists, deviation is 0 by design — show
  // the real absolute skin temperature instead of "+0.0". Even when ready,
  // tonight may have no baseline-backed reading: fall back to absolute then.
  const tempAbsSeries = useHealthStore((s) => s.tempAbsSeries);
  const tempNights = useHealthStore((s) => s.tempNights);
  const tempLatestAbs = tempAbsSeries.length > 0 ? tempAbsSeries[tempAbsSeries.length - 1].v : null;
  const tempDeviation =
    today != null && hasTempBaselineForDay(tempNights, today.dayStart)
      ? today.tempDeviation
      : null;
  const units = useUnits();
  const tempDisplay =
    tempDeviation != null
      ? toDisplayTempDelta(tempDeviation, units)
      : tempLatestAbs != null
        ? toDisplayTemp(tempLatestAbs, units)
        : null;
  const tempValue =
    tempDisplay != null
      ? tempDeviation != null
        ? `${tempDisplay >= 0 ? '+' : ''}${tempDisplay.toFixed(1)}`
        : tempDisplay.toFixed(1)
      : '0.0';

  const insight = today != null && hasNight ? readinessInsight(today, days) : null;
  const sleepDur = today != null ? fmtDuration(today.sleep.durationMin) : null;

  const greetingStrong =
    today == null
      ? ringDeviceId
        ? 'let’s sync your ring'
        : 'let’s connect your ring'
      : hasNight
        ? readinessClause(today.readiness)
        : 'here’s today so far';

  return (
    <Screen aura="home" gap={spacing.gridGap}>
      <View style={{ paddingHorizontal: 12, paddingBottom: 20 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}>
          <View
            accessibilityLabel={`Ring status: ${statusText}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
            <Txt
              role="caption"
              numberOfLines={1}
              color={syncError && !busy ? palette.destructive : palette.muted}
              style={{ flexShrink: 1 }}>
              {statusText}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <GlassCircle onPress={onSync} accessibilityLabel={ringDeviceId ? 'Sync ring now' : 'Connect ring'}>
              <MaterialCommunityIcons name="sync" size={16} color={busy ? palette.mint.base : palette.slate} />
            </GlassCircle>
            <GlassCircle onPress={onManageRing} accessibilityLabel="Manage ring">
              <MaterialCommunityIcons
                name="bluetooth-connect"
                size={16}
                color={lastSyncAt ? palette.mint.base : palette.slate}
              />
            </GlassCircle>
          </View>
        </View>
        <Label style={{ marginBottom: 4 }}>{fmtDate(Date.now(), true)}</Label>
        <Text accessibilityRole="header" style={[type.display, { color: palette.ink, maxWidth: 320 }]}>
          {`${greeting()}, `}
          <Text style={{ fontFamily: fontFamily.semiBold }}>{greetingStrong}</Text>
        </Text>
      </View>

      {today == null ? (
        <Animated.View entering={FadeInDown.delay(40).duration(500)} style={{ flex: 1, minHeight: 520 }}>
          <GlassCard
            tint="mint"
            padding={{ horizontal: 24, top: 32, bottom: 24 }}
            style={{ flex: 1 }}
            contentStyle={{ flex: 1, alignItems: 'center', gap: 24 }}>
            <View style={{ flex: 1, justifyContent: 'flex-end', alignSelf: 'stretch' }}>
              <Illustration name="connect" />
            </View>
            <View style={{ maxWidth: 280, gap: 8 }}>
              <Txt role="title" align="center" style={{ fontSize: 22, lineHeight: 28 }}>
                {ringDeviceId ? 'Ready to sync' : 'Three quick steps to pair'}
              </Txt>
              <Txt role="body" align="center">
                {ringDeviceId
                  ? 'Keep your ring nearby — Kore imports your nights, heart rate and temperature.'
                  : 'Kore talks to your Oura ring directly over Bluetooth. We’ll help you free it from the Oura app and find it nearby.'}
              </Txt>
              {syncError && !busy ? (
                <Txt role="caption" align="center" color={palette.destructive}>
                  {syncError}
                </Txt>
              ) : null}
            </View>
            <View style={{ flex: 1, justifyContent: 'flex-end', alignSelf: 'stretch' }}>
              <Button
                size="lg"
                haptic={ringDeviceId ? 'confirm' : 'tap'}
                loading={busy}
                onPress={ringDeviceId ? onSync : () => router.push('/pair')}>
                {ringDeviceId ? 'Sync now' : 'Set up my ring'}
              </Button>
            </View>
          </GlassCard>
        </Animated.View>
      ) : (
        <>
          <Animated.View entering={FadeInDown.delay(40).duration(500)}>
            <GlassCard
              tint="mint"
              padding={{ horizontal: 24, top: 32, bottom: 24 }}
              chevron
              onPress={() => router.push('/readiness')}
              accessibilityLabel="Readiness details"
              contentStyle={{ alignItems: 'center', gap: 12 }}>
              <IconBadge name="lightning-bolt" tint="mint" style={{ position: 'absolute', top: 20, left: 20 }} />
              <ScoreRing size={188} value={hasNight ? today.readiness : 0} colors={gradients.readiness} strokeWidth={11}>
                {hasNight ? (
                  <AnimatedNumber value={today.readiness} size={68} weight="light" />
                ) : (
                  <Text style={{ fontSize: 34, fontFamily: fontFamily.light, color: palette.muted }}>0</Text>
                )}
                <Label>Readiness</Label>
              </ScoreRing>
              <Pill variant="mint" style={{ alignSelf: 'center' }}>
                {hasNight ? readinessStatus(today.readiness) : mat.readiness.copy.none}
              </Pill>
              {insight ? (
                <Txt role="body" align="center" style={{ maxWidth: 280 }}>
                  {insight}
                </Txt>
              ) : null}
            </GlassCard>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(80).duration(500)}
            style={{ flexDirection: 'row', gap: spacing.cardGap }}>
            <GlassCard
              tint="indigo"
              radius={28}
              padding={{ horizontal: 16, top: 20, bottom: 16 }}
              chevron
              chevronOffset={{ top: 20, right: 16 }}
              onPress={() => router.push('/sleep')}
              accessibilityLabel="Sleep details"
              style={{ flex: 1 }}
              contentStyle={{ alignItems: 'center', gap: 8 }}>
              <ScoreRing size={96} value={hasSleep ? today.sleepScore : 0} colors={gradients.sleep} strokeWidth={8.5} delay={150}>
                <Text style={{ fontSize: 28, fontFamily: fontFamily.light, color: hasSleep ? palette.ink : palette.muted }}>
                  {hasSleep ? today.sleepScore : '0'}
                </Text>
              </ScoreRing>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <IconBadge name="sleep" tint="indigo" size={20} />
                <Label color={palette.ink}>Sleep</Label>
              </View>
              <Txt role="caption" align="center" style={{ marginTop: -4 }}>
                {hasSleep && sleepDur ? `${sleepDur.h}h ${sleepDur.m}m asleep` : mat.sleep.copy.none}
              </Txt>
            </GlassCard>
            <GlassCard
              tint="peach"
              radius={28}
              padding={{ horizontal: 16, top: 20, bottom: 16 }}
              chevron
              chevronOffset={{ top: 20, right: 16 }}
              onPress={() => router.push('/activity')}
              accessibilityLabel="Activity details"
              style={{ flex: 1 }}
              contentStyle={{ alignItems: 'center', gap: 8 }}>
              <ScoreRing size={96} value={hasActivity ? today.activityScore : 0} colors={gradients.activity} strokeWidth={8.5} delay={250}>
                <Text style={{ fontSize: 28, fontFamily: fontFamily.light, color: hasActivity ? palette.ink : palette.muted }}>
                  {hasActivity ? today.activityScore : '0'}
                </Text>
              </ScoreRing>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <IconBadge name="fire" tint="peach" size={20} />
                <Label color={palette.ink}>Activity</Label>
              </View>
              <Txt role="caption" align="center" style={{ marginTop: -4 }}>
                {hasActivity
                  ? `${today.activity.activeCal} of ${today.activity.goalCal} cal`
                  : mat.activity.copy.none}
              </Txt>
            </GlassCard>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(160).duration(500)}>
            <GlassCard radius={32} padding={{ horizontal: 20, top: 20, bottom: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  paddingBottom: 8,
                }}>
                <Label color={palette.ink}>Vitals</Label>
                <Txt role="caption">Latest readings</Txt>
              </View>
              <VitalRow
                first
                icon="heart-pulse"
                tint="mint"
                name="HRV"
                sub={
                  hrvSample != null
                    ? relTime(hrvSample.t)
                    : mat.hrv.state === 'none'
                      ? mat.hrv.copy.none
                      : mat.hrv.copy.unlock!
                }
                value={hrvSample != null ? String(Math.round(hrvSample.v)) : '0'}
                unit="ms"
                href="/metric/hrv"
              />
              <VitalRow
                icon="heart"
                tint="indigo"
                name="Resting heart rate"
                sub={rhrSample != null ? relTime(rhrSample.t) : mat.hr.copy.unlock!}
                value={rhrSample != null ? String(Math.round(rhrSample.v)) : '0'}
                unit="bpm"
                href="/metric/rhr"
              />
              <VitalRow
                icon="thermometer"
                tint="lavender"
                name="Body temperature"
                sub={
                  mat.temp.state === 'collecting'
                    ? mat.temp.copy.unlock!
                    : tempAbsSeries.length > 0
                      ? relTime(tempAbsSeries[tempAbsSeries.length - 1].t)
                      : mat.temp.copy.none
                }
                value={tempValue}
                unit={tempUnit(units)}
                href="/metric/temp"
              />
              <VitalRow
                icon="lungs"
                tint="peach"
                name="Blood oxygen"
                sub={
                  spo2Current != null && dataset.series.spo2.length > 0
                    ? relTime(dataset.series.spo2[dataset.series.spo2.length - 1].t)
                    : mat.spo2.copy.none
                }
                value={spo2Current != null ? String(Math.round(spo2Current)) : '0'}
                unit="%"
                href="/metric/spo2"
              />
            </GlassCard>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(240).duration(500)}>
            <GlassCard
              tint="indigo"
              radius={28}
              padding={{ vertical: 16 }}
              chevron
              chevronOffset={{ top: 32, right: 24 }}
              onPress={() => router.push('/trends')}
              accessibilityLabel="Trends"
              contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingLeft: 16, paddingRight: 40 }}>
              <GlassCircle size={40}>
                <RingIcon />
              </GlassCircle>
              <View style={{ flex: 1, gap: 2 }}>
                <Label color={palette.ink}>Trends</Label>
                <Txt role="caption">
                  {`Averages and baselines across ${days.length} synced ${days.length === 1 ? 'day' : 'days'}`}
                </Txt>
              </View>
            </GlassCard>
          </Animated.View>
        </>
      )}
    </Screen>
  );
}
