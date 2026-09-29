import {
  BackButton,
  GlassCard,
  IconBadge,
  Label,
  Pill,
  Screen,
  ScreenHeader,
  Txt,
  fontFamily,
  haptics,
  palette,
  spacing,
  surfaces,
  type,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, Pressable, Text, View } from 'react-native';
import { JourneyStep } from '@/components/JourneyStep';
import { waitForBluetoothReady, withTimeout, describeBleError, isPairingInfoRemoved } from '@/ring/bluetooth';
import { OuraRingClient } from '@/ring/client';
import { CONNECT_TIMEOUT_MS, FEATURE, FEATURE_MODE, SCAN_TIMEOUT_MS } from '@/ring/constants';
import { cancelSync, syncRing } from '@/ring/sync';
import { BleTransport, type DiscoveredRing } from '@/ring/transport';
import { useHealthStore } from '@/store/health';

type ScanPhase = 'checking' | 'scanning' | 'results' | 'error';

// Guided prep before discovery: a ring still bonded to the Oura app or to
// iOS must be released first, and a ring on its charger stays awake to scan.
type PrepStep = 'oura' | 'remove' | 'charger';

async function openBluetoothSettings(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS');
      return;
    }
    await Linking.openURL('App-Prefs:Bluetooth');
  } catch {
    await Linking.openSettings();
  }
}

// Last successful ring-info read, cached in component state only — it is
// display-only, so it deliberately stays out of the persisted store.
interface RingInfo {
  batteryPercent: number;
  charging: boolean;
  chargeRecommended: boolean;
  firmware: string;
  serial: string;
}

function signal(rssi: number | null): { label: string; bars: number } {
  if (rssi == null) return { label: 'No signal', bars: 0 };
  if (rssi >= -55) return { label: 'Strong', bars: 3 };
  if (rssi >= -70) return { label: 'Good', bars: 2 };
  return { label: 'Weak', bars: 1 };
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(-6).toUpperCase() : id.toUpperCase();
}

export default function PairScreen() {
  const router = useRouter();
  const ringDeviceId = useHealthStore((s) => s.ringDeviceId);
  const ringAuthKey = useHealthStore((s) => s.ringAuthKey);
  const forgetRing = useHealthStore((s) => s.forgetRing);
  const setRingDeviceId = useHealthStore((s) => s.setRingDeviceId);
  const setRingDeviceName = useHealthStore((s) => s.setRingDeviceName);
  const setRingAuthKey = useHealthStore((s) => s.setRingAuthKey);

  const [phase, setPhase] = useState<ScanPhase>('checking');
  const [rings, setRings] = useState<DiscoveredRing[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  // Ring currently being connected (or the last attempt, for Retry).
  const [attempt, setAttempt] = useState<DiscoveredRing | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [ringInfo, setRingInfo] = useState<RingInfo | null>(null);
  const [infoBusy, setInfoBusy] = useState(false);
  const [infoStep, setInfoStep] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);

  const paired = ringDeviceId != null && ringAuthKey != null;

  const [prepHistory, setPrepHistory] = useState<PrepStep[]>(() => (paired ? [] : ['oura']));
  const prepStep = prepHistory.length > 0 ? prepHistory[prepHistory.length - 1] : null;
  const prepActiveRef = useRef(prepStep != null);
  prepActiveRef.current = prepStep != null;

  const transportRef = useRef<BleTransport | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const transport = useCallback(() => {
    transportRef.current ??= new BleTransport();
    return transportRef.current;
  }, []);

  const stopScan = useCallback(() => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    transportRef.current?.stopScan();
  }, []);

  // Wait for the adapter, then scan continuously for SCAN_TIMEOUT_MS,
  // reporting rings live as advertisements arrive.
  const startScan = useCallback(async () => {
    stopScan();
    setScanError(null);
    setRings([]);
    setPhase('checking');
    try {
      await cancelSync();
      await waitForBluetoothReady();
    } catch (e) {
      if (!mountedRef.current) return;
      setScanError(describeBleError(e));
      setPhase('error');
      return;
    }
    if (!mountedRef.current) return;
    setPhase('scanning');
    transport().startScan(
      (ring) => {
        setRings((prev) => {
          const i = prev.findIndex((r) => r.id === ring.id);
          if (i === -1) return [...prev, ring];
          const next = prev.slice();
          next[i] = ring;
          return next;
        });
      },
      (error) => {
        if (!mountedRef.current) return;
        setScanError(describeBleError(error));
        setPhase('error');
      },
    );
    scanTimerRef.current = setTimeout(() => {
      stopScan();
      if (mountedRef.current) setPhase('results');
    }, SCAN_TIMEOUT_MS);
  }, [stopScan, transport]);

  useEffect(() => {
    mountedRef.current = true;
    // Only auto-scan when there's nothing paired — a paired screen is about
    // YOUR ring, not an invitation to re-pair it. (Forgetting flips paired →
    // false and re-runs this, dropping straight into discovery.)
    if (!paired && !prepActiveRef.current) void startScan();
    return () => {
      mountedRef.current = false;
      if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
      const t = transportRef.current;
      transportRef.current = null;
      if (t) {
        t.stopScan();
        void t.disconnect().finally(() => t.destroy());
      }
    };
  }, [startScan, paired]);

  // connect → pair (only when no key is stored) → authenticate → syncTime →
  // persist, then back to home where a sync against the fresh pairing starts.
  const onPick = useCallback(
    async (ring: DiscoveredRing) => {
      if (busy) return;
      // Already paired: pairing another ring would fail auth against the
      // stored key anyway — require an explicit Forget first.
      if (paired) {
        setPairError('Forget your current ring first — then pair the new one.');
        return;
      }
      setAttempt(ring);
      setBusy(true);
      setPairError(null);
      // Keep scanning during connect: the ring rotates its BLE address (RPA),
      // and an active scan lets CoreBluetooth track the current one. The scan
      // window timer is cancelled so it can't stop the scan mid-connect; scan
      // is stopped after a successful pairing or when leaving the screen.
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
        scanTimerRef.current = null;
      }
      const t = transport();
      const client = new OuraRingClient(t);
      console.log(`[pair] picked ${ring.name ?? 'ring'} (${ring.id}) rssi=${ring.rssi ?? 'n/a'}`);
      try {
        setStep('Connecting…');
        try {
          await withTimeout(
            t.connect(ring.id),
            CONNECT_TIMEOUT_MS,
            'Connection timed out — keep the ring nearby and try again',
          );
        } catch (connectError) {
          // Abort the OS-level connect our timeout abandoned (iOS keeps it
          // running in the background otherwise, wedging later attempts).
          await t.cancelPending(ring.id);
          // Bond wiped on the ring (post-factory-reset): iOS must drop its
          // stale bond before a re-bond can happen, and that cleanup is async
          // — retry a few times with spacing before surfacing an error.
          if (isPairingInfoRemoved(connectError)) {
            let lastError: unknown = connectError;
            for (let attempt = 1; attempt <= 4; attempt++) {
              console.log(`[pair] bond wiped on ring — re-bond attempt ${attempt}/4`);
              await new Promise((r) => setTimeout(r, 1500));
              try {
                await withTimeout(
                  t.connect(ring.id),
                  CONNECT_TIMEOUT_MS,
                  'Connection timed out — keep the ring nearby and try again',
                );
                lastError = null;
                break;
              } catch (retryError) {
                lastError = retryError;
                if (!isPairingInfoRemoved(retryError)) throw retryError;
                await t.cancelPending(ring.id);
              }
            }
            if (lastError) {
              throw new Error(
                'iOS pairing is stuck — remove the ring in Settings → Bluetooth, then try again',
              );
            }
          } else {
            throw connectError;
          }
        }
        console.log('[pair] connected');
        if (!mountedRef.current) return;

        let key = useHealthStore.getState().ringAuthKey;
        let installedFreshKey = false;
        if (!key) {
          setStep('Pairing…');
          key = await client.pair();
          installedFreshKey = true;
          console.log('[pair] key installed');
          if (!mountedRef.current) return;
        }

        setStep('Authenticating…');
        const result = await client.authenticate(key);
        console.log(`[pair] auth result: ${result.name} (${result.code})`);
        if (!result.success) {
          throw new Error(
            `Ring rejected authentication (${result.name}) — it is paired to another app. ` +
              'Factory-reset the ring (or extract its existing key) to use it here.',
          );
        }
        // Persist the key only after auth succeeds — a rejected ring must not
        // leave a half-paired key behind.
        if (installedFreshKey) setRingAuthKey(key);

        setStep('Syncing time…');
        await client.syncTime();

        // First pairing turns every measurement feature ON (self-paired rings
        // ship with them OFF) — nothing is optional. Best-effort: every sync
        // re-checks and re-applies anything that didn't take.
        setStep('Enabling sensors…');
        try {
          await client.setFeatureMode(FEATURE.DAYTIME_HR, FEATURE_MODE.AUTOMATIC);
          await client.setFeatureMode(FEATURE.RESTING_HR, FEATURE_MODE.AUTOMATIC);
          await client.setFeatureMode(FEATURE.SPO2, FEATURE_MODE.AUTOMATIC);
          // REAL_STEPS before EXERCISE_HR (upstream enable chain).
          await client.setFeatureMode(FEATURE.REAL_STEPS, FEATURE_MODE.AUTOMATIC);
          await client.setFeatureMode(FEATURE.EXERCISE_HR, FEATURE_MODE.AUTOMATIC);
          await client.setFeatureMode(FEATURE.CVA_PPG, FEATURE_MODE.AUTOMATIC);
          await client.setFeatureMode(FEATURE.EXPERIMENTAL, FEATURE_MODE.AUTOMATIC);
          console.log('[pair] all sensors enabled');
        } catch (featureError) {
          console.log(`[pair] sensor enable failed (sync will retry): ${describeBleError(featureError)}`);
        }

        setRingDeviceId(ring.id);
        setRingDeviceName(ring.name);
        stopScan();
        console.log('[pair] paired, starting first sync');
        haptics.success();
        router.back();
        // Home shows the sync progress via connectionStatus.
        void syncRing();
      } catch (e) {
        console.log(`[pair] failed: ${describeBleError(e)}`);
        if (!mountedRef.current) return;
        setPairError(describeBleError(e));
        try {
          await t.disconnect();
        } catch {
          // Link may already be down.
        }
        // Stop scanning — one clear failure state with Retry (same ring) or
        // Rescan (start over), never an auto-restarting scan racing the error.
        stopScan();
        if (mountedRef.current) setPhase('results');
      } finally {
        if (mountedRef.current) {
          setBusy(false);
          setStep(null);
        }
      }
    },
    [busy, router, setRingAuthKey, setRingDeviceId, setRingDeviceName, startScan, stopScan, transport],
  );

  // Ring holds an unknown key (set_auth_key refused with 0x01): send the raw
  // factory-reset frame (0x1a, Ring 3 protocol cheatsheet) over a fresh
  // connection, then let the user retry pairing. A reset command must work
  // unauthenticated — otherwise a lost key would brick the ring.
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);
  const onFactoryReset = useCallback(
    async (ring: DiscoveredRing) => {
      if (resetBusy) return;
      setResetBusy(true);
      setResetNote(null);
      const t = new BleTransport();
      console.log(`[pair] factory reset: connecting ${ring.id}`);
      try {
        await withTimeout(
          t.connect(ring.id),
          CONNECT_TIMEOUT_MS,
          'Connection timed out — keep the ring nearby and try again',
        );
        const frames: string[] = [];
        const unsub = t.subscribe((f) => frames.push(f));
        await t.writeFrame('1a00');
        await new Promise((r) => setTimeout(r, 3000));
        unsub();
        console.log(`[pair] factory reset responses: ${frames.join(' ') || 'none'}`);
        setResetNote(
          frames.length > 0
            ? `Ring answered: ${frames.join(' ')} — wait a few seconds, then Retry pairing.`
            : 'Reset sent, no answer — watch the case LED, then Retry pairing.',
        );
      } catch (e) {
        await t.cancelPending(ring.id);
        console.log(`[pair] factory reset failed: ${describeBleError(e)}`);
        setResetNote(describeBleError(e));
      } finally {
        try {
          await t.disconnect();
        } catch {
          // Link may already be down.
        }
        t.destroy();
        if (mountedRef.current) setResetBusy(false);
      }
    },
    [resetBusy],
  );

  // Read ring info against the already-paired ring: Bluetooth readiness →
  // connect (15 s bound) → authenticate with the stored key → battery /
  // firmware / serial → disconnect. Uses its own transport so the scan
  // transport is untouched; each step reports inline and any failure lands as
  // a readable error on the card. The last good read is kept in state.
  const onReadInfo = useCallback(async () => {
    if (busy || infoBusy || !paired || !ringDeviceId) return;
    setInfoBusy(true);
    setInfoError(null);
    stopScan();
    setPhase((p) => (p === 'checking' || p === 'scanning' ? 'results' : p));
    const t = new BleTransport();
    const client = new OuraRingClient(t);
    try {
      setInfoStep('Preparing Bluetooth…');
      await cancelSync();
      await waitForBluetoothReady();
      if (!mountedRef.current) return;

      setInfoStep('Connecting…');
      try {
        await withTimeout(
          t.connect(ringDeviceId),
          CONNECT_TIMEOUT_MS,
          'Connection timed out — keep the ring nearby and try again',
        );
      } catch (connectError) {
        await t.cancelPending(ringDeviceId);
        throw connectError;
      }
      if (!mountedRef.current) return;

      setInfoStep('Authenticating…');
      const auth = await client.authenticate(useHealthStore.getState().ringAuthKey!);
      if (!auth.success) {
        throw new Error(`Ring rejected authentication (${auth.name})`);
      }
      if (!mountedRef.current) return;

      setInfoStep('Reading battery…');
      const battery = await client.battery();
      setInfoStep('Reading firmware…');
      const firmware = await client.firmware();
      setInfoStep('Reading serial…');
      const serial = await client.serial();
      if (!mountedRef.current) return;

      setRingInfo({
        batteryPercent: battery.percent,
        charging: battery.charging_progress > 0,
        chargeRecommended: battery.charging_recommended > 0,
        firmware: firmware.firmware_version,
        serial,
      });
    } catch (e) {
      console.log(`[pair] ring info failed: ${describeBleError(e)}`);
      if (mountedRef.current) {
        setInfoError(describeBleError(e));
      }
    } finally {
      try {
        await t.disconnect();
      } catch {
        // Link may already be down.
      }
      t.destroy();
      if (mountedRef.current) {
        setInfoBusy(false);
        setInfoStep(null);
      }
    }
  }, [busy, infoBusy, paired, ringDeviceId, stopScan]);

  const goToPrep = (next: PrepStep) => setPrepHistory((h) => [...h, next]);
  const onBack = () => {
    if (prepHistory.length > 1) {
      setPrepHistory((h) => h.slice(0, -1));
      return;
    }
    router.back();
  };
  const onFindRing = () => {
    setPrepHistory([]);
    void startScan();
  };

  if (prepStep != null) {
    return (
      <Screen aura="home" gap={spacing.gridGap}>
        <ScreenHeader title="Pair your ring" left={<BackButton onPress={onBack} />} />
        {prepStep === 'oura' ? (
          <JourneyStep
            step={1}
            total={3}
            tint="indigo"
            art="stepOura"
            title={{ lead: 'Has this ring been used with ', strong: 'the Oura app', tail: '?' }}
            body="A ring set up in Oura is locked to that app, so it needs a reset before Kore can pair with it."
            primary={{ label: 'Yes, it has', onPress: () => goToPrep('remove') }}
            secondary={{ label: 'No, it’s new or already reset', onPress: () => goToPrep('charger') }}
          />
        ) : prepStep === 'remove' ? (
          <JourneyStep
            step={2}
            total={3}
            tint="lavender"
            art="stepRemove"
            title={{ lead: 'Free it from ', strong: 'Oura and your phone' }}
            body="Do these once, then Kore takes it from here."
            checklist={[
              'Remove the ring in the Oura app',
              'Forget it in Settings → Bluetooth',
              'If it’s still locked, Kore can factory-reset it',
            ]}
            primary={{ label: 'Done, continue', onPress: () => goToPrep('charger') }}
            secondary={{ label: 'Open Bluetooth settings', onPress: () => void openBluetoothSettings() }}
          />
        ) : (
          <JourneyStep
            step={3}
            total={3}
            tint="peach"
            art="stepCharger"
            title={{ lead: 'Place your ring ', strong: 'on its charger' }}
            body="Charging keeps the ring awake so Kore can find it fast. Keep your phone close."
            primary={{ label: 'Find my ring', onPress: onFindRing }}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen aura="home" gap={spacing.gridGap}>
      <ScreenHeader title="Pair your ring" left={<BackButton onPress={onBack} />} />

      <Pressable
        onPress={() => {
          haptics.tap();
          router.push('/ring-debug');
        }}
        hitSlop={10}
        style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 9, marginVertical: -9 }}>
        <Txt role="caption">Having trouble? Open the debug console →</Txt>
      </Pressable>

      {paired ? (
        <GlassCard radius={28} padding={20} tint="mint" contentStyle={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <IconBadge name="bluetooth-connect" tint="mint" size={36} />
            <View style={{ flex: 1, gap: 3 }}>
              <Label>Your ring</Label>
              <Txt role="body">{shortId(ringDeviceId)}</Txt>
            </View>
            <Pill variant="mint" style={{ alignSelf: 'center' }}>Paired</Pill>
          </View>
          {ringInfo ? (
            <View style={{ gap: 4 }}>
              {(
                [
                  [
                    'Battery',
                    `${ringInfo.batteryPercent}%${
                      ringInfo.charging
                        ? ' · charging'
                        : ringInfo.chargeRecommended
                          ? ' · charge recommended'
                          : ''
                    }`,
                  ],
                  ['Firmware', ringInfo.firmware],
                  ['Serial', ringInfo.serial],
                ] as const
              ).map(([label, value]) => (
                <View
                  key={label}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <Txt role="caption">{label}</Txt>
                  <Text
                    style={{
                      ...type.caption,
                      fontFamily: fontFamily.semiBold,
                      color: palette.ink,
                      flexShrink: 1,
                      textAlign: 'right',
                    }}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {infoError ? (
            <Txt role="caption" color={palette.destructive}>
              {infoError}
            </Txt>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pill
              variant="indigo"
              onPress={() => void onReadInfo()}
              disabled={busy || infoBusy}>
              {infoBusy
                ? (infoStep ?? 'Reading…')
                : ringInfo
                  ? 'Refresh ring info'
                  : 'Read ring info'}
            </Pill>
            {infoBusy ? <ActivityIndicator size="small" color={palette.indigo.deep} /> : null}
          </View>
          <Pressable
            onPress={() => {
              haptics.tap();
              Alert.alert(
                'Forget this ring?',
                'Its synced data is removed from this phone too. Pairing again re-imports what the ring still stores.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Forget',
                    style: 'destructive',
                    onPress: () => {
                      haptics.confirm();
                      void cancelSync().then(forgetRing);
                    },
                  },
                ],
              );
            }}
            hitSlop={10}
            style={{ alignSelf: 'flex-start', paddingVertical: 9, marginVertical: -9 }}>
            <Text style={[type.caption, { fontFamily: fontFamily.semiBold, color: palette.destructive }]}>
              Forget this ring
            </Text>
          </Pressable>
        </GlassCard>
      ) : null}

      {paired && !showOthers ? (
        <Pressable
          onPress={() => {
            haptics.tap();
            setShowOthers(true);
            void startScan();
          }}
          hitSlop={10}
          style={{ alignSelf: 'center', paddingVertical: 9, marginVertical: -9 }}>
          <Txt role="caption">Pair a different ring →</Txt>
        </Pressable>
      ) : null}

      {!paired || showOthers ? (
      <GlassCard radius={28} padding={16} contentStyle={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
          <Label color={palette.ink}>Nearby rings</Label>
          {phase === 'checking' || phase === 'scanning' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ActivityIndicator size="small" color={palette.mint.deep} />
              <Txt role="caption">{phase === 'checking' ? 'Preparing Bluetooth…' : 'Scanning…'}</Txt>
            </View>
          ) : null}
        </View>

        {phase === 'error' ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
            <Txt role="body" align="center" color={palette.destructive}>
              {scanError}
            </Txt>
            <Pill variant="mint" onPress={() => void startScan()}>Try again</Pill>
          </View>
        ) : rings.length === 0 && phase === 'results' ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
            <Txt role="body" align="center">
              No rings found — make sure the ring is on its charger and nearby
            </Txt>
            <Pill variant="mint" onPress={() => void startScan()}>Rescan</Pill>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {rings.map((ring) => {
              const s = signal(ring.rssi);
              const isAttempt = attempt?.id === ring.id;
              return (
                <Pressable
                  key={ring.id}
                  onPress={() => {
                    haptics.select();
                    void onPick(ring);
                  }}
                  disabled={busy}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 14,
                    borderRadius: 20,
                    paddingLeft: 12,
                    paddingRight: 16,
                    paddingVertical: 12,
                    backgroundColor: surfaces.well,
                    opacity: busy && !isAttempt ? 0.4 : pressed ? 0.7 : 1,
                  })}>
                  <IconBadge name="ring" tint="indigo" size={32} />
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={1} style={[type.body, { fontFamily: fontFamily.semiBold, color: palette.ink }]}>
                      {ring.name}
                    </Text>
                    <Txt role="caption">{shortId(ring.id)}</Txt>
                  </View>
                  {isAttempt && busy ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator size="small" color={palette.indigo.deep} />
                      <Txt role="caption" color={palette.slate}>
                        {step ?? ''}
                      </Txt>
                    </View>
                  ) : (
                    <View style={{ alignItems: 'flex-end', gap: 3 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
                        {[1, 2, 3].map((bar) => (
                          <View
                            key={bar}
                            style={{
                              width: 3,
                              height: 3 + bar * 3,
                              borderRadius: 1.5,
                              backgroundColor:
                                bar <= s.bars ? palette.mint.deep : palette.faint,
                            }}
                          />
                        ))}
                      </View>
                      <Txt role="micro" color={palette.muted}>
                        {ring.rssi != null ? `${s.label} · ${ring.rssi} dBm` : s.label}
                      </Txt>
                    </View>
                  )}
                </Pressable>
              );
            })}
            {phase === 'scanning' ? (
              <Txt role="caption" align="center">
                Keep your ring close — results appear as they are found
              </Txt>
            ) : (
              <Pill
                variant="neutral"
                onPress={() => void startScan()}
                disabled={busy}
                style={{ alignSelf: 'center' }}>
                Rescan
              </Pill>
            )}
          </View>
        )}

        {pairError ? (
          <View style={{ alignItems: 'center', gap: 8 }}>
            <Txt role="body" align="center" color={palette.destructive}>
              {pairError}
            </Txt>
            {pairError.includes('set_auth_key') ? (
              <>
                <Txt role="body" align="center">
                  This ring already holds an auth key nobody knows. Factory-reset it to wipe the
                  key, then pair again.
                </Txt>
                <Pill
                  variant="peach"
                  onPress={() => attempt && void onFactoryReset(attempt)}
                  disabled={resetBusy || !attempt}>
                  {resetBusy ? 'Resetting…' : 'Factory-reset ring'}
                </Pill>
              </>
            ) : null}
            {resetNote ? (
              <Txt role="caption" align="center">
                {resetNote}
              </Txt>
            ) : null}
            {attempt ? (
              <Pill
                variant="mint"
                onPress={() => void onPick(attempt)}
                disabled={busy || resetBusy}>
                Retry pairing
              </Pill>
            ) : null}
          </View>
        ) : null}
      </GlassCard>
      ) : null}
    </Screen>
  );
}
