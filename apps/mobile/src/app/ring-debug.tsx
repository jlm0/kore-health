import { BackButton, Screen, ScreenHeader, palette } from '@kore/ui';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ensureBlePermissions, waitForBluetoothReady } from '@/ring/bluetooth';
import { OuraRingClient, type RingEvent } from '@/ring/client';
import { FEATURE, FEATURE_MODE } from '@/ring/constants';
import { cancelSync, deepResync } from '@/ring/sync';
import { syncLogText } from '@/ring/syncLog';
import { BleTransport, type DiscoveredRing } from '@/ring/transport';
import { useHealthStore, useLiveStore } from '@/store/health';

// Temporary verification tool for the ring link — not linked from app screens.

export default function RingDebugScreen() {
  const router = useRouter();
  const ringAuthKey = useHealthStore((s) => s.ringAuthKey);
  const ringDeviceId = useHealthStore((s) => s.ringDeviceId);
  const setRingAuthKey = useHealthStore((s) => s.setRingAuthKey);
  const setRingDeviceId = useHealthStore((s) => s.setRingDeviceId);
  const resetAll = useHealthStore((s) => s.resetAll);

  const [logs, setLogs] = useState<string[]>([]);
  const [rings, setRings] = useState<DiscoveredRing[]>([]);
  const [busy, setBusy] = useState(false);
  const linkRef = useRef<{ transport: BleTransport; client: OuraRingClient } | null>(null);

  const log = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    console.log(`[ring-debug] ${message}`);
    setLogs((prev) => [...prev.slice(-199), `${stamp}  ${message}`]);
  }, []);

  const link = useCallback(() => {
    if (!linkRef.current) {
      const transport = new BleTransport();
      linkRef.current = { transport, client: new OuraRingClient(transport) };
    }
    return linkRef.current;
  }, []);

  useEffect(() => {
    if (useHealthStore.getState().connectionStatus !== 'disconnected') {
      log('stopping the running sync so the console can use the ring');
      void cancelSync().then(() => log('sync stopped'));
    }
    ensureBlePermissions().then((granted) => {
      log(`BLE permissions: ${granted ? 'granted' : 'DENIED'}`);
      if (Platform.OS === 'ios') {
        link()
          .transport.bluetoothState()
          .then((state) => log(`BLE state: ${state}`));
      }
    });
    return () => {
      linkRef.current?.transport.destroy();
      linkRef.current = null;
    };
  }, [link, log]);

  const run = useCallback(
    async (label: string, fn: (client: OuraRingClient) => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      log(`> ${label}`);
      try {
        await fn(link().client);
        log(`ok: ${label}`);
      } catch (e) {
        log(`ERR ${label}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [busy, link, log],
  );

  const onScan = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    log('> scan');
    try {
      await waitForBluetoothReady();
      const found = await link().transport.scanForRing();
      setRings(found);
      if (found.length === 0) {
        log('no rings found');
      }
      for (const r of found) {
        log(`${r.name}  ${r.id}  rssi=${r.rssi ?? 'n/a'}`);
      }
    } catch (e) {
      log(`ERR scan: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, link, log]);

  const onConnect = useCallback(async () => {
    const target = rings.find((r) => r.id === ringDeviceId) ?? rings[0];
    if (!target) {
      log('scan first — no ring to connect to');
      return;
    }
    if (busy) return;
    setBusy(true);
    log(`> connect ${target.name} (${target.id})`);
    try {
      await waitForBluetoothReady();
      await link().transport.connect(target.id);
      setRingDeviceId(target.id);
      log('ok: connected');
    } catch (e) {
      log(`ERR connect: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, link, log, rings, ringDeviceId, setRingDeviceId]);

  const onDisconnect = useCallback(async () => {
    await linkRef.current?.transport.disconnect();
    log('disconnected');
  }, [log]);

  const onPair = useCallback(
    () =>
      run('pair (factory-reset rings only)', async (client) => {
        const keyHex = await client.pair();
        setRingAuthKey(keyHex);
        log(`key installed and stored: ${keyHex}`);
      }),
    [run, setRingAuthKey, log],
  );

  const onAuthenticate = useCallback(() => {
    if (!ringAuthKey) {
      log('no stored key — pair first');
      return;
    }
    return run('authenticate', async (client) => {
      const result = await client.authenticate(ringAuthKey);
      log(`auth result: ${result.name} (${result.code})`);
    });
  }, [run, ringAuthKey, log]);

  const onBattery = useCallback(
    () =>
      run('battery', async (client) => {
        const b = await client.battery();
        log(
          `battery ${b.percent}%  charging_progress=${b.charging_progress}  charging_recommended=${b.charging_recommended}`,
        );
      }),
    [run, log],
  );

  const onInfo = useCallback(
    () =>
      run('serial + firmware', async (client) => {
        const serial = await client.serial();
        log(`serial: ${serial}`);
        const hardware = await client.hardwareId();
        log(`hardware: ${hardware}`);
        const info = await client.firmware();
        log(`firmware: ${info.firmware_version}  api: ${info.api_version}  mac: ${info.mac}`);
      }),
    [run, log],
  );

  const onSyncTime = useCallback(
    () =>
      run('sync time', async (client) => {
        await client.syncTime();
      }),
    [run],
  );

  const onEnableFeatures = useCallback(
    () =>
      run('enable HR + resting HR + SpO2 (needed after self-pair)', async (client) => {
        await client.setFeatureMode(FEATURE.DAYTIME_HR, FEATURE_MODE.AUTOMATIC);
        log('daytime HR: AUTOMATIC');
        await client.setFeatureMode(FEATURE.RESTING_HR, FEATURE_MODE.AUTOMATIC);
        log('resting HR (overnight): AUTOMATIC');
        await client.setFeatureMode(FEATURE.SPO2, FEATURE_MODE.AUTOMATIC);
        log('SpO2: AUTOMATIC');
      }),
    [run, log],
  );

  const onSyncEvents = useCallback(
    () =>
      run('sync events (full drain from epoch)', async (client) => {
        const last: RingEvent[] = [];
        const outcome = await client.drainEvents(0, (event) => {
          last.push(event);
          if (last.length > 5) last.shift();
        });
        log(`synced ${outcome.eventsSynced} events, next cursor ${outcome.nextCursor}`);
        for (const e of last) {
          const body = e.decoded ? JSON.stringify(e.decoded) : e.bodyHex;
          log(`${e.name} (0x${e.tag.toString(16)}) ts=${e.timestamp} ${body}`);
        }
      }),
    [run, log],
  );

  // Full rebuild from cursor 0 — the only way to recover events stranded
  // below the persisted cursor (e.g. after an interrupted drain). syncRing
  // manages its own link, so drop this screen's connection first. NOTE: the
  // rebuilt dataset replaces the old one — days the ring no longer holds
  // (e.g. before a factory reset) are dropped.
  const onDeepResync = useCallback(
    () =>
      run('deep resync (full rebuild from cursor 0)', async () => {
        await linkRef.current?.transport.disconnect();
        await deepResync();
        log('dataset rebuilt from ring history — ring-forgotten days were dropped');
      }),
    [run, log],
  );

  // Escape hatch for an orphaned key (key installed but unknown): send the raw
  // factory-reset frame (0x1a, per the Ring 3 protocol cheatsheet) and log any
  // response. Unauthenticated by nature — the ring must accept it without a
  // valid key, or a lost key would brick the ring. Connect first.
  const onFactoryReset = useCallback(
    () =>
      run('factory reset (0x1a)', async () => {
        const { transport } = link();
        const frames: string[] = [];
        const unsub = transport.subscribe((f) => frames.push(f));
        await transport.writeFrame('1a00');
        await new Promise((r) => setTimeout(r, 3000));
        unsub();
        log(
          frames.length > 0
            ? `reset responses: ${frames.join(' ')}`
            : 'no response — watch the ring/case LED, then re-Scan',
        );
      }),
    [run, link, log],
  );

  const onShareLog = useCallback(async () => {
    const s = useHealthStore.getState();
    const version = Constants.expoConfig?.version ?? '?';
    const build = Constants.expoConfig?.ios?.buildNumber;
    const header = [
      `Kore ${version}${build ? ` (${build})` : ''} · ${Platform.OS} ${Platform.Version}`,
      `ring: ${s.ringDeviceId ? `paired (${s.ringDeviceName ?? s.ringDeviceId})` : 'not paired'} · cursor ${s.syncCursor}`,
      `days: ${s.dataset?.days.length ?? 0} · last sync: ${s.lastSyncAt ? new Date(s.lastSyncAt).toISOString() : 'never'}`,
      `status: ${s.connectionStatus}${s.syncError ? ` · error: ${s.syncError}` : ''}`,
    ].join('\n');
    try {
      await Share.share({ message: `${header}\n\n${syncLogText() || '(no ring log yet)'}` });
    } catch (e) {
      log(`ERR share: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [log]);

  const onResetKore = useCallback(() => {
    Alert.alert(
      'Reset Kore?',
      'This forgets your ring and deletes all synced data on this phone. Your ring keeps its own history, so pairing again re-imports what it still stores.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () =>
            void run('reset Kore (forget ring + clear data)', async () => {
              await cancelSync();
              await linkRef.current?.transport.disconnect();
              resetAll();
              useLiveStore.getState().clearLiveHr();
              setRings([]);
              log('Kore reset — pair your ring again from Home');
            }),
        },
      ],
    );
  }, [run, resetAll, log]);

  return (
    <Screen aura="home">
      <ScreenHeader title="Ring debug" left={<BackButton onPress={() => router.back()} />} />
      <View style={styles.buttons}>
        <DebugButton label="Scan" onPress={onScan} disabled={busy} />
        <DebugButton label="Connect" onPress={onConnect} disabled={busy} />
        <DebugButton label="Disconnect" onPress={onDisconnect} disabled={busy} />
        <DebugButton label="Pair" onPress={onPair} disabled={busy} />
        <DebugButton
          label="Authenticate"
          onPress={onAuthenticate}
          disabled={busy || !ringAuthKey}
        />
        <DebugButton label="Battery" onPress={onBattery} disabled={busy} />
        <DebugButton label="Serial / Firmware" onPress={onInfo} disabled={busy} />
        <DebugButton label="Sync time" onPress={onSyncTime} disabled={busy} />
        <DebugButton label="Enable all features" onPress={onEnableFeatures} disabled={busy} />
        <DebugButton label="Sync events" onPress={onSyncEvents} disabled={busy} />
        <DebugButton label="⚠ Deep resync" onPress={onDeepResync} disabled={busy} />
        <DebugButton label="⚠ Factory reset" onPress={onFactoryReset} disabled={busy} />
        <DebugButton label="⚠ Reset Kore" onPress={onResetKore} disabled={busy} />
        <DebugButton label="Share sync log" onPress={() => void onShareLog()} />
      </View>
      <Text style={styles.meta}>
        key: {ringAuthKey ? `${ringAuthKey.slice(0, 8)}…` : 'none'} · device:{' '}
        {ringDeviceId ?? 'none'}
      </Text>
      <View style={styles.console}>
        {logs.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </View>
    </Screen>
  );
}

function DebugButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}>
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    backgroundColor: palette.ink,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    // 48 pt touch-target floor — real height, no hitSlop needed.
    minHeight: 48,
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
    color: palette.slate,
  },
  console: {
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.65)',
    padding: 12,
    gap: 3,
  },
  logLine: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: palette.ink,
  },
});
