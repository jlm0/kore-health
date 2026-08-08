import { foldRingEvents, type RingEventLike } from '../data/ring';
import { mergeLatestVitals } from '../data/vitals';
import { useHealthStore, useLiveStore } from '../store/health';
import { waitForBluetoothReady, withTimeout, describeBleError } from './bluetooth';
import { OuraRingClient, type LatestValues } from './client';
import { FEATURE, FEATURE_MODE, CONNECT_TIMEOUT_MS } from './constants';
import { dedupeEvents, hasInteriorDateGap, DEEP_RESYNC_REACH_TOLERANCE_DS } from './resync';
import { BleTransport } from './transport';

// Ring sync orchestration: connect to the paired ring → authenticate → sync
// clock → drain history events from the persisted cursor → fold into the
// dataset → persist once → disconnect. Cursor progress is persisted per batch,
// so a mid-sync failure keeps whatever was drained and the next sync resumes
// there. Pairing (key install) happens on the pairing screen, not here.

let syncing = false;
// Circuit breaker: an AUTO-triggered deep resync runs at most once per app
// session — if the rebuild cannot complete (or the gap persists), later
// syncs stay incremental instead of re-entering a rebuild loop (observed
// live: an incomplete rebuild regressed days=7 → days=2, and the gap
// detector immediately re-triggered on the next sync). A forced
// deepResync() bypasses this.
let autoDeepResyncUsed = false;
// Dev audit gating: the audit's read-only full history drain costs minutes
// of ring radio time (it ran the battery 32%→21% in ~1h of dev churn when it
// followed EVERY sync), so it runs at most once per app session — on the
// first dev sync — unless re-armed via runAuditOnNextSync().
let auditRanThisSession = false;
let auditArmed = false;
// Set while a live HR stream is running so stopLiveHeartRate() can end it
// early; the client still restores AUTOMATIC mode on the way out.
let liveStop: (() => void) | null = null;

/** Dev-only: run the full ring audit after the next sync (ring-debug hook). */
export function runAuditOnNextSync(): void {
  auditArmed = true;
}

// Event tags produced by the ring's sleep analysis — used to tell whether a
// drain already picked up fresh sleep data (see the need-based settle below).
const SLEEP_EVENT_TAGS = new Set([
  0x48, // sleep_period_information
  0x49, // sleep_summary_1
  0x4b, // sleep_phase_information
  0x4c, // sleep_summary_2
  0x4e, // sleep_phase_details
  0x4f, // sleep_summary_3
  0x58, // sleep_summary_4
  0x76, // bedtime_period
]);

/** End an in-progress live HR stream early. No-op when none is running. */
export function stopLiveHeartRate(): void {
  liveStop?.();
}

export interface SyncOptions {
  /**
   * Force a deep resync: drain from cursor 0 (multi-segment, deduped) and
   * fold with `prior: null` — a full rebuild. This is the only safe way to
   * recover events stranded BELOW the cursor: re-feeding old events through
   * the incremental fold would double-count, so the dataset is rebuilt from
   * scratch instead.
   */
  forceDeepResync?: boolean;
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
  } catch (firstError) {
    const { ringDeviceName } = useHealthStore.getState();
    if (!ringDeviceName) throw firstError;
    console.log(`[sync] saved id unreachable, re-discovering by name "${ringDeviceName}"`);
    const found = await transport.scanForRing();
    const match =
      found.find((r) => r.name === ringDeviceName) ??
      (found.length === 1 ? found[0] : undefined);
    if (!match) {
      // Saved id stale AND name re-discovery found nothing — almost always
      // range or a sleeping radio, not a pairing problem.
      throw new Error(
        'Ring not reachable — it may be out of range or asleep. Keep it nearby and try again, or re-pair from the pairing screen',
      );
    }
    console.log(`[sync] re-discovered as ${match.id}, refreshing saved id`);
    useHealthStore.getState().setRingDeviceId(match.id);
    await withTimeout(
      transport.connect(match.id),
      CONNECT_TIMEOUT_MS,
      'Connection timed out — keep the ring nearby, or re-pair from the pairing screen',
    );
  }
  // The pairing screen persists the advertised name at pairing time, but
  // stores paired before that (or via a recovered path) have it null — which
  // silently disables the re-discovery fallback above. Backfill it from the
  // live link: the connected Device carries the advertised name.
  const connectedName = transport.deviceName;
  if (connectedName && connectedName !== useHealthStore.getState().ringDeviceName) {
    console.log(`[sync] persisting ring device name "${connectedName}" for RPA re-discovery`);
    useHealthStore.getState().setRingDeviceName(connectedName);
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
 *
 * Normal syncs are incremental (drain from the persisted cursor). A deep
 * resync — full rebuild from cursor 0, folded with prior: null — runs instead
 * when forced, or when the persisted day list has an interior date gap (the
 * signature of data stranded below the cursor by the legacy walk's early
 * segment termination; the forward-only cursor can never recover it
 * incrementally, and the non-idempotent fold forbids re-feeding old events).
 */
export async function syncRing(options?: SyncOptions): Promise<void> {
  if (syncing) return;
  syncing = true;
  const store = useHealthStore.getState;
  store().setConnectionStatus('connecting');
  const transport = new BleTransport();
  const client = new OuraRingClient(transport);
  const t0 = Date.now();
  try {
    // Gate on adapter readiness (permissions + PoweredOn) before any BLE op
    // so the first sync after app install cannot race the iOS prompt.
    console.log('[sync] waiting for bluetooth ready');
    await waitForBluetoothReady();

    console.log('[sync] connecting');
    await connectWithRediscovery(transport);
    store().setConnectionStatus('connected');
    const tConnected = Date.now();

    console.log('[sync] authenticating');
    await authenticateClient(client);
    const tAuthed = Date.now();

    // Self-paired rings ship with measurement features OFF — the official app
    // enables them at onboarding. Ensure on every sync; non-fatal: a failed
    // enable must not block the history drain. RESTING_HR is the overnight
    // HRV/RHR measurement — without it there is no night data.
    // Write-on-change: read featureStatus FIRST and only write setFeatureMode
    // when the ring's mode differs from the pref — steady-state syncs skip
    // all writes (3 write round trips saved). A feature the user turned off
    // is left untouched, exactly as before.
    try {
      const prefs = store().featurePrefs;
      for (const [name, id, enabled] of [
        ['daytime', FEATURE.DAYTIME_HR, prefs.daytimeHr],
        ['resting', FEATURE.RESTING_HR, prefs.restingHr],
        ['spo2', FEATURE.SPO2, prefs.spo2],
      ] as const) {
        try {
          const st = await client.featureStatus(id);
          if (!enabled) {
            console.log(
              `[sync] feature ${name} (0x${id.toString(16)}): mode=${st.mode} status=${st.status} state=${st.state} — disabled by user pref, untouched`,
            );
          } else if (st.mode === FEATURE_MODE.AUTOMATIC) {
            console.log(
              `[sync] feature ${name} (0x${id.toString(16)}): mode=${st.mode} status=${st.status} state=${st.state} — already AUTOMATIC, write skipped`,
            );
          } else {
            await client.setFeatureMode(id, FEATURE_MODE.AUTOMATIC);
            // Read back what the ring reports — a confirmed write is not
            // proof the mode took effect.
            const after = await client.featureStatus(id);
            console.log(
              `[sync] feature ${name} (0x${id.toString(16)}): mode ${st.mode} → AUTOMATIC written (readback mode=${after.mode} status=${after.status} state=${after.state})`,
            );
          }
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
    // after the ring runs its analysis — trigger it now. Whether we need to
    // WAIT for it is decided from the batch summaries' sleepAnalysisProgress
    // after the drain (see below), replacing the old fixed 3s settle.
    console.log('[sync] triggering sleep analysis');
    try {
      await client.checkSleepAnalysis();
    } catch (sleepError) {
      console.log(`[sync] sleep analysis failed (non-fatal): ${describeBleError(sleepError)}`);
    }
    const tPrepared = Date.now();

    store().setConnectionStatus('syncing');
    const previousCursor = store().syncCursor;
    const forced = options?.forceDeepResync === true;
    const gapDetected =
      store().dataset != null && hasInteriorDateGap(store().dataset!.days);
    const deep = forced || (gapDetected && !autoDeepResyncUsed);
    if (deep) {
      if (!forced) autoDeepResyncUsed = true;
      console.log(
        `[sync] deep resync (${forced ? 'forced' : 'interior date gap'}): ` +
          `full rebuild from cursor 0, expected end >=${previousCursor}`,
      );
    } else {
      if (gapDetected) {
        console.log(
          '[sync] interior date gap persists, but auto deep resync already ran this session — staying incremental',
        );
      }
      console.log(`[sync] draining events from cursor ${previousCursor}`);
    }
    const events: RingEventLike[] = [];
    const pushEvent = (event: { tag: number; name: string; timestamp: number; decoded: unknown }) =>
      events.push({ tag: event.tag, name: event.name, timestamp: event.timestamp, decoded: event.decoded });
    let outcome = await client.drainEvents(
      deep ? 0 : previousCursor,
      pushEvent,
      // A deep resync must not move the persisted cursor mid-rebuild: if it
      // is interrupted, the OLD dataset stays paired with the OLD cursor —
      // never a stale dataset with a rewound cursor (which the next
      // incremental sync would double-fold from).
      deep ? undefined : (nextCursor) => store().setSyncCursor(nextCursor),
      // The old cursor is proof newer segments exist: let the walk probe
      // past early segment-boundary terminations to reach them.
      deep ? { expectEndAtLeast: previousCursor } : undefined,
    );
    let batches = outcome.batches;

    // Need-based sleep-analysis settle (replaces the fixed 3s pre-drain
    // sleep): the batch summaries' sleepAnalysisProgress says whether the
    // ring was still analyzing when the drain ended. Only then — and only if
    // no sleep events arrived in this drain — poll progress (bounded, ≤10s)
    // and re-drain once so the freshly generated sleep events make THIS
    // sync's fold. Steady state (analysis complete, progress=100) costs
    // nothing at all.
    const progress = outcome.sleepAnalysisProgress;
    if (progress != null && progress < 100 && !events.some((e) => SLEEP_EVENT_TAGS.has(e.tag))) {
      try {
        console.log(
          `[sync] sleep analysis in progress (${progress}%), no sleep events in drain — waiting (bounded)`,
        );
        const deadline = Date.now() + 10_000;
        let p: number | null = progress;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2_000));
          p = await client.probeSleepAnalysis(outcome.nextCursor);
          console.log(`[sync] sleep analysis progress=${p ?? 'unknown'}`);
          if (p == null || p >= 100) break;
        }
        const follow = await client.drainEvents(
          outcome.nextCursor,
          pushEvent,
          deep ? undefined : (nextCursor) => store().setSyncCursor(nextCursor),
        );
        console.log(`[sync] sleep follow-up drain: ${follow.eventsSynced} events`);
        batches += follow.batches;
        outcome = {
          ...follow,
          eventsSynced: outcome.eventsSynced + follow.eventsSynced,
        };
      } catch (sleepWaitError) {
        console.log(`[sync] sleep-analysis wait failed (non-fatal): ${describeBleError(sleepWaitError)}`);
      }
    }
    const tDrained = Date.now();
    // Commit guard: a deep rebuild whose walk could not get within a day of
    // the expected end is INCOMPLETE — committing it would replace a more
    // complete dataset with a regressed one (observed live: days=7 → days=2
    // with clock=newest_event garbage dates; an incomplete walk may capture
    // no time_sync event near the end, and the fold's clock anchoring needs
    // one). Keep the previous dataset and cursor untouched; the circuit
    // breaker above prevents an auto-retry loop.
    const deepComplete =
      !deep || outcome.nextCursor >= previousCursor - DEEP_RESYNC_REACH_TOLERANCE_DS;
    if (deep && !deepComplete) {
      console.log(
        `[sync] deep resync incomplete (reached ${outcome.nextCursor} of ${previousCursor}) — keeping previous dataset`,
      );
    }
    if (deepComplete) {
      const uniqueEvents = dedupeEvents(events);
      if (uniqueEvents.length !== events.length) {
        console.log(
          `[sync] dropped ${events.length - uniqueEvents.length} duplicate events from overlapping segments`,
        );
      }
      console.log(`[sync] drained ${uniqueEvents.length} events, folding`);
      // Diagnostic: event-type breakdown + computed day rows, so score/data
      // accuracy can be sanity-checked from the logs.
      const byName = new Map<string, number>();
      let metBins = 0;
      for (const e of uniqueEvents) {
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
        // Deep resync rebuilds from scratch — folding old events onto the
        // existing (non-idempotent) fold state would double-count them.
        prior:
          !deep && store().dataset != null
            ? {
                dataset: store().dataset!,
                tempAbsSeries: store().tempAbsSeries,
                tempNights: store().tempNights,
                activityByDay: store().activityByDay,
              }
            : null,
        events: uniqueEvents,
        goalCal: store().activityGoalCal,
      });
      // Single atomic commit → single AsyncStorage write for the whole sync.
      store().applySyncResult(result.state);
      if (deep) {
        // Only now is it safe to move the cursor: the rebuilt dataset and
        // the new cursor advance together.
        store().setSyncCursor(outcome.nextCursor);
        console.log(`[sync] deep resync committed, cursor=${outcome.nextCursor}`);
      }
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
    const tLatest = Date.now();
    // Per-sync timing profile — the verification channel for lifecycle cost.
    // Segments: connect (BT-ready + connect + rediscovery), auth, features
    // (feature modes + syncTime + sleep trigger), drain (all batch
    // requests incl. the sleep follow-up), latest (featureLatest reads).
    console.log(
      `[sync] profile: connect=${tConnected - t0}ms auth=${tAuthed - tConnected}ms ` +
        `features=${tPrepared - tAuthed}ms drain=${tDrained - tPrepared}ms (${batches} batches) ` +
        `latest=${tLatest - tDrained}ms total=${tLatest - t0}ms`,
    );

    // Dev-only data audit on the still-open connection: read-only full
    // history drain + persisted-store dump, all prefixed [audit] in the logs.
    // Expensive (minutes of ring radio time), so it runs at most once per app
    // session unless re-armed via runAuditOnNextSync().
    if (__DEV__) {
      if (auditArmed || !auditRanThisSession) {
        auditArmed = false;
        auditRanThisSession = true;
        try {
          const { runRingAudit, dumpStoreSnapshot } = await import('./audit');
          await runRingAudit(client);
          dumpStoreSnapshot();
        } catch (auditError) {
          console.log(`[audit] failed (non-fatal): ${describeBleError(auditError)}`);
        }
      } else {
        console.log('[audit] skipped (already ran this session — runAuditOnNextSync() re-arms)');
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
 * Force a deep resync on the next sync: full rebuild from cursor 0
 * (multi-segment, deduped) folded with `prior: null`. Recovers events
 * stranded below the persisted cursor — see SyncOptions.forceDeepResync.
 */
export async function deepResync(): Promise<void> {
  return syncRing({ forceDeepResync: true });
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
