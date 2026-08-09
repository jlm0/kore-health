import { MaterialCommunityIcons } from '@expo/vector-icons';
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
  haptics,
  palette,
  spacing,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useDays, useDataset, useLatestSample, useMaturities, useToday, useUnits } from '@/data/hooks';
import { fmtDate, hasTempBaselineForDay, samplesWithinSleepWindows } from '@/data/selectors';
import { tempUnit, toDisplayTemp, toDisplayTempDelta } from '@/data/units';
import { syncRing } from '@/ring/sync';
import { useHealthStore } from '@/store/health';

function readinessStatus(score: number): string {
  if (score >= 85) return 'Optimal';
  if (score >= 70) return 'Good';
  return 'Recover';
}

// Small caption shown in place of a trend that isn't ready yet — copy comes
// from the central maturity module, never invented per screen.
const hintText = {
  fontSize: 9,
  fontFamily: fontFamily.regular,
  color: palette.faint,
  lineHeight: 13,
} as const;

// Fixed-height bottom slot for the home metric cards: chart, hint text, or
// empty — the slot is ALWAYS rendered so all four cards keep identical heights
// in every data state.
const chartSlot = {
  height: 26,
  justifyContent: 'center',
} as const;

// Measurement timestamp under a card value — the cards read as "current
// state", so the time context must be explicit, never implied.
const contextText = {
  fontSize: 8,
  fontFamily: fontFamily.regular,
  color: palette.faint,
} as const;

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
      haptics.tap();
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
    haptics.tap();
    router.push('/pair');
  };

  // Status element: always visible without tapping, reflects sync health —
  // never "Connected" (we don't hold a persistent link; connect → sync →
  // disconnect by design). Tapping opens ring management.
  const statusText = !ringDeviceId
    ? 'Connect ring'
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
    ? palette.slate
    : busy
      ? palette.mint.base
      : syncError
        ? palette.peach.deep
        : lastSyncAt
          ? palette.mint.deep
          : palette.faint;
  // "Current" SpO2: the freshest of live/latest-vitals/last synced sample —
  // null when the ring has never reported one (SpO2 is never invented), in
  // which case the card shows a numeric 0, never an invented value.
  const spo2Current = useLatestSample('spo2');

  const hrv14 = days.slice(-14).map((d) => d.hrvAvg);
  const rhr14 = days.slice(-14).map((d) => d.restingHr);
  const temp7 = days.slice(-7).map((d) => d.tempDeviation);

  // Card headlines: the LATEST measurement in each series (the right edge of
  // any chart of that metric) — users read home cards as current state, so a
  // nightly average here reads as wrong-or-stale. HRV/RHR use the freshest
  // sample INSIDE A DETECTED SLEEP WINDOW: resting means "measured while you
  // slept", never a daytime reading whatever the clock says. Each card stamps
  // when its value was measured.
  const hrvSleep = samplesWithinSleepWindows(dataset.series.hrv, days);
  const rhrSleep = samplesWithinSleepWindows(dataset.series.hr, days);
  const hrvSample = hrvSleep.length > 0 ? hrvSleep[hrvSleep.length - 1] : null;
  const rhrSample = rhrSleep.length > 0 ? rhrSleep[rhrSleep.length - 1] : null;

  // Data-presence gates come from the central maturity model (NOW/TODAY/TREND).
  // Absent values render as numeric 0 (never an invented number) with the
  // group's unlock copy beside them: HRV/RHR/readiness are night-derived and
  // stay 0 until the first overnight sync; the sleep ring waits for a detected
  // sleep window today.
  const mat = useMaturities();
  const hasNight = mat.readiness.state === 'ready';
  const hasSleep = today != null && today.sleep.durationMin > 0;
  // Activity score is 0-computed when nothing was ever measured — the group's
  // maturity gate decides, exactly like the activity screen's empty state.
  const hasActivity = mat.activity.state === 'ready';

  // Temp: until a personal baseline exists (state 'collecting'), deviation is
  // 0 by design — show the real absolute skin temperature instead of "+0.0".
  // Even in state 'ready', tonight may have no baseline-backed reading (ring
  // not worn): fall back to the absolute value then, never the fake 0.
  const tempAbsSeries = useHealthStore((s) => s.tempAbsSeries);
  const tempNights = useHealthStore((s) => s.tempNights);
  const tempLatestAbs = tempAbsSeries.length > 0 ? tempAbsSeries[tempAbsSeries.length - 1].v : null;
  const tempDeviation =
    today != null && hasTempBaselineForDay(tempNights, today.dayStart)
      ? today.tempDeviation
      : null;
  const units = useUnits();
  // Deviation (Δ rule) when baseline-backed, otherwise the absolute reading.
  const tempDisplay =
    tempDeviation != null
      ? toDisplayTempDelta(tempDeviation, units)
      : tempLatestAbs != null
        ? toDisplayTemp(tempLatestAbs, units)
        : null;

  return (
    <Screen aura="home" gap={spacing.gridGap}>
      <ScreenHeader
        left={
          <View style={{ gap: 3 }}>
            <Text style={{ fontSize: 27, fontFamily: fontFamily.displayLight, color: palette.ink }}>
              {greeting()}
            </Text>
            <Label size={9} em={0.16}>{fmtDate(Date.now(), true)}</Label>
            {/* Status line: display only — syncing happens from the dedicated
                Sync button in the header (or automatically on foreground). */}
            <View
              accessibilityLabel={`Ring status: ${statusText}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                alignSelf: 'flex-start',
              }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusColor }} />
              <Label size={8} em={0.14} color={syncError && !busy ? palette.peach.deep : palette.faint}>
                {statusText}
              </Label>
            </View>
          </View>
        }
        right={
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
            {/* Icon + label form one 48×48 target: the column is 32+3+label ≈ 44
                pt tall + 2 pt slop each side, and 8 pt horizontal hitSlop brings
                the 32 pt width to 48 (the shared floor — see ui/touch.ts). */}
            <Pressable
              onPress={onSync}
              disabled={busy}
              hitSlop={{ top: 2, bottom: 2, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={ringDeviceId ? 'Sync ring now' : 'Connect ring'}
              style={{ alignItems: 'center', gap: 3 }}>
              <GlassCircle size={32}>
                <MaterialCommunityIcons
                  name="sync"
                  size={14}
                  color={busy ? palette.mint.base : palette.slate}
                />
              </GlassCircle>
              <Label size={7} em={0.12} color={palette.faint}>{busy ? 'Syncing' : 'Sync'}</Label>
            </Pressable>
            <Pressable
              onPress={onManageRing}
              hitSlop={{ top: 2, bottom: 2, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Manage ring"
              style={{ alignItems: 'center', gap: 3 }}>
              <GlassCircle size={32}>
                <MaterialCommunityIcons
                  name="bluetooth-connect"
                  size={14}
                  color={lastSyncAt ? palette.mint.base : palette.slate}
                />
              </GlassCircle>
              <Label size={7} em={0.12} color={palette.faint}>Ring</Label>
            </Pressable>
          </View>
        }
      />

      {today == null ? (
        <Animated.View entering={FadeInDown.delay(40).duration(500)}>
          <GlassCard
            radius={28}
            padding={24}
            tint="mint"
            contentStyle={{ alignItems: 'center', gap: 12 }}>
            <IconBadge name="bluetooth" tint="mint" size={44} />
            <Label size={9} em={0.2}>Connect your ring</Label>
            <Text
              style={{
                fontSize: 12,
                fontFamily: fontFamily.regular,
                color: palette.slate,
                textAlign: 'center',
                lineHeight: 18,
              }}>
              No data yet. Keep your Oura ring nearby and sync to import your
              nights, heart rate and temperature.
            </Text>
            <Pill variant="mint" em={0.18} onPress={onSync} disabled={busy} style={{ alignSelf: 'center' }}>
              {busy ? 'Syncing…' : ringDeviceId ? 'Sync now' : 'Connect ring'}
            </Pill>
            {syncError && !busy ? (
              <Text style={{ fontSize: 10, fontFamily: fontFamily.regular, color: palette.peach.deep, textAlign: 'center' }}>
                {syncError}
              </Text>
            ) : null}
          </GlassCard>
        </Animated.View>
      ) : (
        <>
          <Animated.View entering={FadeInDown.delay(40).duration(500)}>
            <GlassCard
              radius={28}
              padding={{ horizontal: 20, vertical: 24 }}
              tint="mint"
              chevron
              onPress={() => router.push('/readiness')}
              contentStyle={{ alignItems: 'center', gap: 10 }}>
              <IconBadge
                name="lightning-bolt"
                tint="mint"
                style={{ position: 'absolute', top: 18, left: 18 }}
              />
              <ScoreRing size={172} value={hasNight ? today.readiness : 0} colors={gradients.readiness} strokeWidth={10}>
                {hasNight ? (
                  <AnimatedNumber value={today.readiness} size={72} weight="displayLight" />
                ) : (
                  <Text style={{ fontSize: 34, fontFamily: fontFamily.displayLight, color: palette.muted }}>
                    0
                  </Text>
                )}
                <Label size={9} em={0.2}>Readiness</Label>
              </ScoreRing>
              <Pill variant="mint" em={0.18} style={{ alignSelf: 'center' }}>
                {hasNight ? readinessStatus(today.readiness) : mat.readiness.copy.none}
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
              <ScoreRing size={92} value={hasSleep ? today.sleepScore : 0} colors={gradients.sleep} strokeWidth={8} delay={150}>
                <Text style={{ fontSize: 28, fontFamily: fontFamily.displayLight, color: hasSleep ? palette.ink : palette.muted }}>
                  {hasSleep ? today.sleepScore : '0'}
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
              <ScoreRing size={92} value={hasActivity ? today.activityScore : 0} colors={gradients.activity} strokeWidth={8} delay={250}>
                <Text style={{ fontSize: 28, fontFamily: fontFamily.displayLight, color: hasActivity ? palette.ink : palette.muted }}>
                  {hasActivity ? today.activityScore : '0'}
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
              <MetricValue value={hrvSample != null ? String(Math.round(hrvSample.v)) : '0'} unit="ms" />
              <Text style={contextText}>{hrvSample != null ? relTime(hrvSample.t) : ' '}</Text>
              <View style={chartSlot}>
                {hrvSample != null ? (
                  <Sparkline data={hrv14} height={22} color={palette.mint.base} delay={350} />
                ) : (
                  <Text style={hintText} numberOfLines={2}>
                    {mat.hrv.state === 'none' ? mat.hrv.copy.none : mat.hrv.copy.unlock}
                  </Text>
                )}
              </View>
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
              <MetricValue value={rhrSample != null ? String(Math.round(rhrSample.v)) : '0'} unit="bpm" />
              <Text style={contextText}>{rhrSample != null ? relTime(rhrSample.t) : ' '}</Text>
              <View style={chartSlot}>
                {rhrSample != null ? (
                  <Sparkline data={rhr14} height={22} color={palette.indigo.base} delay={420} />
                ) : (
                  <Text style={hintText} numberOfLines={2}>{mat.hr.copy.unlock}</Text>
                )}
              </View>
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
              <CardHeading icon="thermometer" tint="lavender">
                Body Temp
              </CardHeading>
              <MetricValue
                value={
                  tempDisplay != null
                    ? tempDeviation != null
                      ? `${tempDisplay >= 0 ? '+' : ''}${tempDisplay.toFixed(1)}`
                      : tempDisplay.toFixed(1)
                    : '0.0'
                }
                unit={tempUnit(units)}
              />
              <Text style={contextText}>
                {tempAbsSeries.length > 0 ? relTime(tempAbsSeries[tempAbsSeries.length - 1].t) : ' '}
              </Text>
              <View style={chartSlot}>
                {tempDeviation != null ? (
                  <DotTrend data={temp7} height={22} delay={500} />
                ) : mat.temp.state === 'collecting' ? (
                  <Text style={hintText} numberOfLines={2}>{mat.temp.copy.unlock}</Text>
                ) : null}
              </View>
            </GlassCard>
            <GlassCard
              radius={24}
              padding={13}
              tint="peach"
              onPress={() => router.push('/metric/spo2')}
              style={{ flex: 1 }}
              contentStyle={{ gap: 6 }}>
              <CardHeading icon="lungs" tint="peach">
                SpO2
              </CardHeading>
              <MetricValue
                value={spo2Current != null ? String(Math.round(spo2Current)) : '0'}
                unit="%"
              />
              <Text style={contextText}>
                {spo2Current != null && dataset.series.spo2.length > 0
                  ? relTime(dataset.series.spo2[dataset.series.spo2.length - 1].t)
                  : ' '}
              </Text>
              <View style={chartSlot}>
                {spo2Current != null ? (
                  <ProgressBar
                    progress={spo2Current / 100}
                    colors={gradients.spo2}
                    delay={550}
                  />
                ) : null}
              </View>
            </GlassCard>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(320).duration(500)}>
            <GlassCard
              radius={26}
              padding={{ horizontal: 18, vertical: 16 }}
              tint="indigo"
              chevron
              onPress={() => router.push('/trends')}
              contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <GlassCircle size={36}>
                <RingIcon />
              </GlassCircle>
              <View style={{ flex: 1, gap: 3 }}>
                <Label size={9} em={0.18}>Trends</Label>
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: fontFamily.regular,
                    color: palette.slate,
                    lineHeight: 16,
                  }}>
                  Averages and baselines across your synced days
                </Text>
              </View>
            </GlassCard>
          </Animated.View>
        </>
      )}
    </Screen>
  );
}
