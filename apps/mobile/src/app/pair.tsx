import {
  BackButton,
  GlassCard,
  IconBadge,
  Label,
  Pill,
  Screen,
  ScreenHeader,
  fontFamily,
  palette,
  spacing,
} from '@kore/ui';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { waitForBluetoothReady, withTimeout, describeBleError, isPairingInfoRemoved } from '@/ring/bluetooth';
import { OuraRingClient } from '@/ring/client';
import { CONNECT_TIMEOUT_MS, FEATURE, FEATURE_MODE, SCAN_TIMEOUT_MS } from '@/ring/constants';
import { syncRing } from '@/ring/sync';
import { BleTransport, type DiscoveredRing } from '@/ring/transport';
import { useHealthStore } from '@/store/health';

type ScanPhase = 'checking' | 'scanning' | 'results' | 'error';

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
    if (!paired) void startScan();
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
        // ship with them OFF) and resets the user's prefs to all-enabled —
        // pairing is a fresh start. Best-effort: the first sync retries.
        setStep('Enabling sensors…');
        try {
          await client.setFeatureMode(FEATURE.DAYTIME_HR, FEATURE_MODE.AUTOMATIC);
          await client.setFeatureMode(FEATURE.RESTING_HR, FEATURE_MODE.AUTOMATIC);
          await client.setFeatureMode(FEATURE.SPO2, FEATURE_MODE.AUTOMATIC);
          // Steps + workout HR are always-on (no user toggle) — REAL_STEPS
          // before EXERCISE_HR (upstream enable chain).
          await client.setFeatureMode(FEATURE.REAL_STEPS, FEATURE_MODE.AUTOMATIC);
          await client.setFeatureMode(FEATURE.EXERCISE_HR, FEATURE_MODE.AUTOMATIC);
          useHealthStore.getState().setFeaturePref('daytimeHr', true);
          useHealthStore.getState().setFeaturePref('restingHr', true);
          useHealthStore.getState().setFeaturePref('spo2', true);
          console.log('[pair] all sensors enabled');
        } catch (featureError) {
          console.log(`[pair] sensor enable failed (sync will retry): ${describeBleError(featureError)}`);
        }

        setRingDeviceId(ring.id);
        setRingDeviceName(ring.name);
        stopScan();
        console.log('[pair] paired, starting first sync');
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

  return (
    <Screen aura="home" gap={spacing.gridGap}>
      <ScreenHeader title="Pair your ring" left={<BackButton onPress={() => router.back()} />} />

      <Pressable
        onPress={() => router.push('/ring-debug')}
        hitSlop={10}
        style={{ alignSelf: 'flex-start', paddingVertical: 9, marginVertical: -9 }}>
        <Label size={8} em={0.14} color={palette.faint}>
          Having trouble? Open the debug console →
        </Label>
      </Pressable>

      {paired ? (
        <GlassCard radius={24} padding={16} tint="mint" contentStyle={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconBadge name="bluetooth-connect" tint="mint" size={36} />
            <View style={{ flex: 1, gap: 3 }}>
              <Label size={9} em={0.18}>Your ring</Label>
              <Text style={{ fontSize: 13, fontFamily: fontFamily.regular, color: palette.slate }}>
                {shortId(ringDeviceId)}
              </Text>
            </View>
            <Pill variant="mint" em={0.16}>Paired</Pill>
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
                  <Text
                    style={{ fontSize: 12, fontFamily: fontFamily.regular, color: palette.muted }}>
                    {label}
                  </Text>
                  <Text
                    style={{
                      fontSize: 12,
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
            <Text
              style={{
                fontSize: 12,
                fontFamily: fontFamily.regular,
                color: palette.peach.deep,
                lineHeight: 18,
              }}>
              {infoError}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pill
              variant="indigo"
              em={0.16}
              onPress={() => void onReadInfo()}
              disabled={busy || infoBusy}
              style={busy || infoBusy ? { opacity: 0.5 } : undefined}>
              {infoBusy
                ? (infoStep ?? 'Reading…')
                : ringInfo
                  ? 'Refresh ring info'
                  : 'Read ring info'}
            </Pill>
            {infoBusy ? <ActivityIndicator size="small" color={palette.indigo.deep} /> : null}
          </View>
          <Pressable
            onPress={forgetRing}
            hitSlop={10}
            style={{ alignSelf: 'flex-start', paddingVertical: 9, marginVertical: -9 }}>
            <Text style={{ fontSize: 12, fontFamily: fontFamily.semiBold, color: palette.peach.deep }}>
              Forget this ring
            </Text>
          </Pressable>
        </GlassCard>
      ) : null}

      {paired && !showOthers ? (
        <Pressable
          onPress={() => {
            setShowOthers(true);
            void startScan();
          }}
          hitSlop={10}
          style={{ alignSelf: 'center', paddingVertical: 9, marginVertical: -9 }}>
          <Label size={8} em={0.14} color={palette.faint}>
            Pair a different ring →
          </Label>
        </Pressable>
      ) : null}

      {!paired || showOthers ? (
      <GlassCard radius={24} padding={16} contentStyle={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Label size={9} em={0.18}>Nearby rings</Label>
          {phase === 'checking' || phase === 'scanning' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ActivityIndicator size="small" color={palette.mint.deep} />
              <Label size={8} em={0.14} color={palette.faint}>
                {phase === 'checking' ? 'Preparing Bluetooth…' : 'Scanning…'}
              </Label>
            </View>
          ) : null}
        </View>

        {phase === 'error' ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
            <Text
              style={{
                fontSize: 12,
                fontFamily: fontFamily.regular,
                color: palette.peach.deep,
                textAlign: 'center',
                lineHeight: 18,
              }}>
              {scanError}
            </Text>
            <Pill variant="mint" em={0.18} onPress={() => void startScan()}>Try again</Pill>
          </View>
        ) : rings.length === 0 && phase === 'results' ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 8 }}>
            <Text
              style={{
                fontSize: 12,
                fontFamily: fontFamily.regular,
                color: palette.slate,
                textAlign: 'center',
                lineHeight: 18,
              }}>
              No rings found — make sure the ring is nearby and awake
            </Text>
            <Pill variant="mint" em={0.18} onPress={() => void startScan()}>Rescan</Pill>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {rings.map((ring) => {
              const s = signal(ring.rssi);
              const isAttempt = attempt?.id === ring.id;
              return (
                <Pressable
                  key={ring.id}
                  onPress={() => void onPick(ring)}
                  disabled={busy}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderRadius: 16,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    backgroundColor: 'rgba(255,255,255,0.55)',
                    opacity: busy && !isAttempt ? 0.4 : pressed ? 0.7 : 1,
                  })}>
                  <IconBadge name="ring" tint="indigo" size={32} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 14, fontFamily: fontFamily.semiBold, color: palette.ink }}>
                      {ring.name}
                    </Text>
                    <Text style={{ fontSize: 11, fontFamily: fontFamily.regular, color: palette.muted }}>
                      {shortId(ring.id)}
                    </Text>
                  </View>
                  {isAttempt && busy ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator size="small" color={palette.indigo.deep} />
                      <Text style={{ fontSize: 11, fontFamily: fontFamily.regular, color: palette.slate }}>
                        {step}
                      </Text>
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
                      <Text style={{ fontSize: 9, fontFamily: fontFamily.regular, color: palette.muted }}>
                        {ring.rssi != null ? `${s.label} · ${ring.rssi} dBm` : s.label}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
            {phase === 'scanning' ? (
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: fontFamily.regular,
                  color: palette.faint,
                  textAlign: 'center',
                }}>
                Keep your ring close — results appear as they are found
              </Text>
            ) : (
              <Pill
                variant="neutral"
                em={0.18}
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
            <Text
              style={{
                fontSize: 12,
                fontFamily: fontFamily.regular,
                color: palette.peach.deep,
                textAlign: 'center',
                lineHeight: 18,
              }}>
              {pairError}
            </Text>
            {pairError.includes('set_auth_key') ? (
              <>
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: fontFamily.regular,
                    color: palette.slate,
                    textAlign: 'center',
                    lineHeight: 18,
                  }}>
                  This ring already holds an auth key nobody knows. Factory-reset it to wipe the
                  key, then pair again.
                </Text>
                <Pill
                  variant="peach"
                  em={0.18}
                  onPress={() => attempt && void onFactoryReset(attempt)}
                  disabled={resetBusy || !attempt}>
                  {resetBusy ? 'Resetting…' : 'Factory-reset ring'}
                </Pill>
              </>
            ) : null}
            {resetNote ? (
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: fontFamily.regular,
                  color: palette.muted,
                  textAlign: 'center',
                  lineHeight: 16,
                }}>
                {resetNote}
              </Text>
            ) : null}
            {attempt ? (
              <Pill
                variant="mint"
                em={0.18}
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
