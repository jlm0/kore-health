import { foldRingEvents, type RingEventLike } from '../data/ring';
import { mergeLatestVitals } from '../data/vitals';
import { useHealthStore, useLiveStore } from '../store/health';
import { waitForBluetoothReady, withTimeout, describeBleError } from './bluetooth';
import { OuraRingClient, type LatestValues } from './client';
import { FEATURE, FEATURE_MODE, CONNECT_TIMEOUT_MS } from './constants';
import { BleTransport } from './transport';

// Ring sync orchestration: connect to the paired ring → authenticate → sync
// clock → drain history events from the persisted cursor → fold into the
// dataset → persist once → disconnect. Cursor progress is persisted per batch,
// so a mid-sync failure keeps whatever was drained and the next sync resumes
// there. Pairing (key install) happens on the pairing screen, not here.

let syncing = false;
// Set while a live HR stream is running so stopLiveHeartRate() can end it
// early; the client still restores AUTOMATIC mode on the way out.
let liveStop: (() => void) | null = null;

/** End an in-progress live HR stream early. No-op when none is running. */
export function stopLiveHeartRate(): void {
  liveStop?.();
}

// Connect to the paired device. Pairing is the pairing screen's job: with no
// saved device there is nothing to connect to, so fail with a pointer to it
// rather than scanning and silently picking the strongest ring.
async function connectTransport(transport: BleTransport): Promise<void> {
  const deviceId = useHealthStore.getState().ringDeviceId;
  if (!deviceId) {
    throw new Error('No ring paired — open pairing to choose your ring');
  }
  try {
    await withTimeout(
      transport.connect(deviceId),
      CONNECT_TIMEOUT_MS,
      'Connection timed out — keep the ring nearby, or re-pair from the pairing screen',
    );
  } catch (error) {
    // Abort the OS-level connect attempt our timeout abandoned, or it keeps
    // running in the background and wedges the next attempt.
    await transport.cancelPending(deviceId);
    throw error;
  }
}

// The ring rotates its BLE address (RPA), so the saved peripheral id goes
// stale — the ring's advertised NAME is the stable identity. On connect
// failure, re-discover by name and refresh the saved id, then retry once.
async function connectWithRediscovery(transport: BleTransport): Promise<void> {
  try {
    await connectTransport(transport);
    return;
  } catch (firstError) {
    const { ringDeviceName } = useHealthStore.getState();
    if (!ringDeviceName) throw firstError;
    console.log(`[sync] saved id unreachable, re-discovering by name "${ringDeviceName}"`);
    const found = await transport.scanForRing();
    const match =
      found.find((r) => r.name === ringDeviceName) ??
      (found.length === 1 ? found[0] : undefined);
    if (!match) throw firstError;
    console.log(`[sync] re-discovered as ${match.id}, refreshing saved id`);
    useHealthStore.getState().setRingDeviceId(match.id);
    await withTimeout(
      transport.connect(match.id),
      CONNECT_TIMEOUT_MS,
      'Connection timed out — keep the ring nearby, or re-pair from the pairing screen',
    );
  }
}

// Authenticate with the stored key, which the pairing screen installed.
async function authenticateClient(client: OuraRingClient): Promise<void> {
  const key = useHealthStore.getState().ringAuthKey;
  if (!key) {
    throw new Error('No ring paired — open pairing to choose your ring');
  }
  const result = await client.authenticate(key);
  if (!result.success) throw new Error(`ring auth failed: ${result.name}`);
}

/**
 * Full history sync against the paired ring. No-op while a sync is already
 * running. Errors are surfaced via connectionStatus/syncError in the store
 * rather than thrown; the catch + finally below guarantee the status can
 * never stick at 'connecting'/'syncing'.
 */
export async function syncRing(): Promise<void> {
  if (syncing) return;
  syncing = true;
  const store = useHealthStore.getState;
  store().setConnectionStatus('connecting');
  const transport = new BleTransport();
  const client = new OuraRingClient(transport);
  try {
    // Gate on adapter readiness (permissions + PoweredOn) before any BLE op
    // so the first sync after app install cannot race the iOS prompt.
    console.log('[sync] waiting for bluetooth ready');
    await waitForBluetoothReady();

    console.log('[sync] connecting');
    await connectWithRediscovery(transport);
    store().setConnectionStatus('connected');

    console.log('[sync] authenticating');
    await authenticateClient(client);

    // Self-paired rings ship with measurement features OFF — the official app
    // enables them at onboarding. Ensure on every sync (idempotent, cheap);
    // non-fatal: a failed enable must not block the history drain. RESTING_HR
    // is the overnight HRV/RHR measurement — without it there is no night data.
    // Only the user-enabled features are touched (featurePrefs): a feature the
    // user turned off stays off.
    try {
      const prefs = store().featurePrefs;
      if (prefs.daytimeHr) await client.setFeatureMode(FEATURE.DAYTIME_HR, FEATURE_MODE.AUTOMATIC);
      if (prefs.restingHr) await client.setFeatureMode(FEATURE.RESTING_HR, FEATURE_MODE.AUTOMATIC);
      if (prefs.spo2) await client.setFeatureMode(FEATURE.SPO2, FEATURE_MODE.AUTOMATIC);
      console.log('[sync] feature modes applied per user prefs');
      // Read back what the ring actually reports — a confirmed write is not
      // proof the mode took effect.
      for (const [name, id] of [
        ['daytime', FEATURE.DAYTIME_HR],
        ['resting', FEATURE.RESTING_HR],
        ['spo2', FEATURE.SPO2],
      ] as const) {
        try {
          const st = await client.featureStatus(id);
          console.log(
            `[sync] feature ${name} (0x${id.toString(16)}): mode=${st.mode} status=${st.status} state=${st.state}`,
          );
        } catch {
          console.log(`[sync] feature ${name} (0x${id.toString(16)}): status unreadable`);
        }
      }
    } catch (featureError) {
      console.log(`[sync] feature enable failed (non-fatal): ${describeBleError(featureError)}`);
    }
    // Align the ring clock before draining so new events carry a fresh
    // time_sync anchor for decisecond → wall-clock conversion.
    await client.syncTime();

    // Sleep events (bedtime_period, stages) only enter the history stream
    // after the ring runs its analysis — trigger it, then let it settle.
    console.log('[sync] triggering sleep analysis');
    try {
      await client.checkSleepAnalysis();
      await new Promise((r) => setTimeout(r, 3000));
    } catch (sleepError) {
      console.log(`[sync] sleep analysis failed (non-fatal): ${describeBleError(sleepError)}`);
    }

    store().setConnectionStatus('syncing');
    console.log(`[sync] draining events from cursor ${store().syncCursor}`);
    const events: RingEventLike[] = [];
    await client.drainEvents(
      store().syncCursor,
      (event) => events.push({ tag: event.tag, name: event.name, timestamp: event.timestamp, decoded: event.decoded }),
      (nextCursor) => store().setSyncCursor(nextCursor),
    );
    console.log(`[sync] drained ${events.length} events, folding`);
    // Diagnostic: event-type breakdown + computed day rows, so score/data
    // accuracy can be sanity-checked from the logs.
    const byName = new Map<string, number>();
    let metBins = 0;
    for (const e of events) {
      byName.set(e.name, (byName.get(e.name) ?? 0) + 1);
      if (e.name === 'activity_information') {
        const mets = (e.decoded as Record<string, unknown> | null)?.met;
        if (Array.isArray(mets)) metBins += mets.length;
      }
    }
    console.log(
      `[sync] event types: ${[...byName.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`).join(' ')}${metBins > 0 ? ` | met bins: ${metBins}` : ''}`,
    );

    const result = foldRingEvents({
      prior:
        store().dataset != null
          ? {
              dataset: store().dataset!,
              tempAbsSeries: store().tempAbsSeries,
              tempNights: store().tempNights,
              activityByDay: store().activityByDay,
            }
          : null,
      events,
      goalCal: store().activityGoalCal,
    });
    // Single atomic commit → single AsyncStorage write for the whole sync.
    store().applySyncResult(result.state);
    console.log(
      `[sync] done: ${result.eventsApplied} events applied, clock=${result.clockAnchor}, days=${result.state.dataset.days.length}`,
    );
    for (const d of result.state.dataset.days) {
      console.log(
        `[sync] day ${d.date}: readiness=${d.readiness} sleep=${d.sleepScore} activity=${d.activityScore} ` +
          `cal=${Math.round(d.activity.activeCal)}/${d.activity.goalCal} rhr=${d.restingHr} ` +
          `hrv=${d.hrvAvg} temp=${d.tempDeviation} spo2=${d.spo2}`,
      );
      // Diagnostic: resting HR/HRV are computed from HR points INSIDE the
      // sleep window — show exactly why a night-backed day still has 0.
      if (d.sleep.durationMin > 0) {
        const hr = result.state.dataset.series.hr;
        const inside = hr.filter((s) => s.t >= d.sleep.start && s.t < d.sleep.end).length;
        const fmt = (ms: number) =>
          `${new Date(ms).getHours()}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`;
        console.log(
          `[sync]   sleep window ${fmt(d.sleep.start)}→${fmt(d.sleep.end)}: ` +
            `${inside} hr pts inside, ${hr.length} total in series`,
        );
      }
    }
    for (const id of ['hr', 'hrv', 'temp', 'spo2', 'move'] as const) {
      console.log(`[sync] series ${id}: ${result.state.dataset.series[id].length} points`);
    }

    // History fills charts; featureLatest fills "right now". Read the ring's
    // cached latest HR + SpO2 while we're still connected. Best-effort: a
    // ring off the finger answers with empty values and a failed read must
    // never fail the sync — empty means "no current value", not 0.
    try {
      const hrLatest = await client.featureLatest(FEATURE.DAYTIME_HR);
      let spo2Latest: LatestValues | null = null;
      try {
        spo2Latest = await client.featureLatest(FEATURE.SPO2);
      } catch (spo2Error) {
        console.log(`[sync] featureLatest(SPO2) failed (non-fatal): ${describeBleError(spo2Error)}`);
      }
      const vitals = mergeLatestVitals(hrLatest, spo2Latest);
      if (vitals) {
        store().setLatestVitals(vitals);
        console.log(`[sync] latest vitals: bpm=${vitals.bpm ?? '—'} spo2=${vitals.spo2Percent ?? '—'}`);
      } else {
        console.log('[sync] no latest vitals (ring not worn?)');
      }
    } catch (vitalsError) {
      console.log(`[sync] featureLatest failed (non-fatal): ${describeBleError(vitalsError)}`);
    }

    // Dev-only data audit on the still-open connection: read-only full
    // history drain + persisted-store dump, all prefixed [audit] in the logs.
    if (__DEV__) {
      try {
        const { runRingAudit, dumpStoreSnapshot } = await import('./audit');
        await runRingAudit(client);
        dumpStoreSnapshot();
      } catch (auditError) {
        console.log(`[audit] failed (non-fatal): ${describeBleError(auditError)}`);
      }
    }

    store().setConnectionStatus('disconnected');
  } catch (error) {
    console.log(`[sync] failed: ${describeBleError(error)}`);
    store().setConnectionStatus('disconnected', describeBleError(error));
  } finally {
    try {
      await transport.disconnect();
    } catch {
      // Link may already be down.
    }
    transport.destroy();
    syncing = false;
  }
}

/**
 * Live daytime HR while (and only while) connected: enables the ring's
 * CONNECTED_LIVE daytime-HR feature for `durationSeconds`, appending each beat
 * to the non-persisted live buffer that backs the HR "Current" readout. The
 * client restores AUTOMATIC mode on exit — both on natural completion and on
 * an early stopLiveHeartRate(). Errors surface in syncError.
 */
export async function streamLiveHeartRate(durationSeconds = 60): Promise<void> {
  if (syncing) return;
  syncing = true;
  const store = useHealthStore.getState;
  store().setConnectionStatus('connecting');
  const transport = new BleTransport();
  const client = new OuraRingClient(transport);
  try {
    await waitForBluetoothReady();
    await connectWithRediscovery(transport);
    store().setConnectionStatus('connected');
    await authenticateClient(client);
    useLiveStore.getState().clearLiveHr();
    let stopped = false;
    liveStop = () => {
      stopped = true;
    };
    await client.liveHeartRate(
      durationSeconds,
      (sample) => {
        useLiveStore.getState().appendLiveHr(sample.bpm);
      },
      () => stopped,
    );
    store().setConnectionStatus('disconnected');
  } catch (error) {
    store().setConnectionStatus('disconnected', describeBleError(error));
  } finally {
    try {
      await transport.disconnect();
    } catch {
      // Link may already be down.
    }
    transport.destroy();
    liveStop = null;
    syncing = false;
  }
}

/**
 * Enable/disable one ring measurement feature (AUTOMATIC vs OFF) from a
 * metric screen's sensor toggle. Same connect → authenticate → act →
 * disconnect shape as a sync. Returns true when the ring confirmed the mode
 * change; failures surface in syncError and return false so the caller can
 * revert its optimistic pref. No-op (false) while another BLE op is running.
 */
export async function setRingFeature(featureId: number, enabled: boolean): Promise<boolean> {
  if (syncing) return false;
  syncing = true;
  const store = useHealthStore.getState;
  store().setConnectionStatus('connecting');
  const transport = new BleTransport();
  const client = new OuraRingClient(transport);
  try {
    await waitForBluetoothReady();
    await connectWithRediscovery(transport);
    store().setConnectionStatus('connected');
    await authenticateClient(client);
    await client.setFeatureMode(featureId, enabled ? FEATURE_MODE.AUTOMATIC : FEATURE_MODE.OFF);
    console.log(`[sync] feature 0x${featureId.toString(16)} set to ${enabled ? 'AUTOMATIC' : 'OFF'}`);
    store().setConnectionStatus('disconnected');
    return true;
  } catch (error) {
    console.log(`[sync] setRingFeature failed: ${describeBleError(error)}`);
    store().setConnectionStatus('disconnected', describeBleError(error));
    return false;
  } finally {
    try {
      await transport.disconnect();
    } catch {
      // Link may already be down.
    }
    transport.destroy();
    syncing = false;
  }
}
