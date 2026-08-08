import { useHealthStore } from '../store/health';
import type { OuraRingClient, RingEvent } from './client';
import { FEATURE } from './constants';

// Dev-only data audit (called from syncRing behind __DEV__): dumps the
// persisted store and does a READ-ONLY full history drain (from cursor 0 —
// the ring keeps its own history; the client-side cursor is untouched) so the
// raw ring data can be verified against what the app persisted and displays.
// Every line is prefixed [audit] for log harvesting; long JSON payloads are
// chunked with `tag [i/n]` markers so they can be reassembled from a log file.

const LINE_MAX = 1200;

function logJson(tag: string, value: unknown): void {
  const text = JSON.stringify(value);
  if (text.length <= LINE_MAX) {
    console.log(`[audit] ${tag}: ${text}`);
    return;
  }
  const chunks = Math.ceil(text.length / LINE_MAX);
  for (let i = 0; i < chunks; i++) {
    console.log(
      `[audit] ${tag} [${i + 1}/${chunks}] ${text.slice(i * LINE_MAX, (i + 1) * LINE_MAX)}`,
    );
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

// Persisted store: everything needed to verify "what the app shows" against
// "what the ring sent". Full days/tempNights/activityByDay (small); series as
// stats + head/tail samples (full grids would be megabytes of log).
export function dumpStoreSnapshot(): void {
  const s = useHealthStore.getState();
  console.log('[audit] --- store snapshot ---');
  logJson('store.scalars', {
    syncCursor: s.syncCursor,
    lastSyncAt: s.lastSyncAt != null ? iso(s.lastSyncAt) : null,
    units: s.units,
    featurePrefs: s.featurePrefs,
    activityGoalCal: s.activityGoalCal,
    latestVitals: s.latestVitals,
    ringDeviceName: s.ringDeviceName,
  });
  logJson('store.tempNights', s.tempNights);
  logJson('store.activityByDay', s.activityByDay);
  if (!s.dataset) {
    console.log('[audit] store.dataset: null');
    return;
  }
  logJson('store.days', s.dataset.days);
  for (const id of ['hr', 'hrv', 'temp', 'spo2', 'move'] as const) {
    const series = s.dataset.series[id];
    const vs = series.map((p) => p.v);
    logJson(`store.series.${id}`, {
      points: series.length,
      firstT: series.length ? iso(series[0].t) : null,
      lastT: series.length ? iso(series[series.length - 1].t) : null,
      min: vs.length ? Math.min(...vs) : null,
      max: vs.length ? Math.max(...vs) : null,
      head: series.slice(0, 3).map((p) => [iso(p.t), p.v]),
      tail: series.slice(-3).map((p) => [iso(p.t), p.v]),
    });
  }
}

interface TagTally {
  name: string;
  count: number;
  decoded: number;
  unvalidated: number;
  minTs: number;
  maxTs: number;
  sampleDecoded: string | null;
  sampleRaw: string | null;
}

// Tags dumped with FULL raw bodies + decodes — the ground truth for decoder
// development and field-level verification. Everything else stays tallied.
const FULL_DUMP_TAGS = new Set([
  0x42, // time_sync
  0x45, // state_change
  0x48, // sleep_period_information
  0x49, // sleep_summary_1
  0x4b, // sleep_phase_information
  0x4c, // sleep_summary_2
  0x4e, // sleep_phase_details
  0x4f, // sleep_summary_3
  0x50, // activity_information
  0x51, // activity_summary_1
  0x52, // activity_summary_2
  0x53, // wear_event
  0x55, // sleep_heart_rate
  0x56, // alert_event
  0x58, // sleep_summary_4
  0x5d, // hrv_event
  0x61, // debug_data (all subtypes — sleep_statistics 0x09 lives here)
  0x62, // on_demand_meas
  0x6c, // feature_session
  0x6d, // meas_quality_event
  0x6f, // spo2_event
  0x76, // bedtime_period
  0x7e, // real_step_event_feature_1
  0x7f, // real_step_event_feature_2
  0x8b, // spo2_r_pi_event
]);

interface DumpEvent {
  ts: number;
  body: string;
  decoded?: unknown;
}

// One full-drain pass; returns the max event ts seen. The legacy GetEvent
// walk can report bytesLeft=0 at segment boundaries while newer segments
// exist, so callers may re-enter with a higher start.
async function drainPass(
  client: OuraRingClient,
  start: number,
  onEvent: (e: RingEvent) => void,
): Promise<number> {
  let maxTs = start;
  await client.drainEvents(start, (e) => {
    maxTs = Math.max(maxTs, e.timestamp);
    onEvent(e);
  });
  return maxTs;
}

// Read-only full drain + device state. Runs on the sync's live connection,
// after the real drain, so it never touches the persisted cursor.
export async function runRingAudit(client: OuraRingClient): Promise<void> {
  console.log('[audit] --- ring audit (read-only) ---');

  try {
    const b = await client.battery();
    console.log(`[audit] battery: ${b.percent}% charging_progress=${b.charging_progress}`);
  } catch (e) {
    console.log(`[audit] battery read failed: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const info = await client.firmware();
    console.log(
      `[audit] firmware: ${info.firmware_version} api=${info.api_version} mac=${info.mac}`,
    );
  } catch (e) {
    console.log(`[audit] firmware read failed: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const hw = await client.hardwareId();
    console.log(`[audit] hardware: ${hw}`);
  } catch (e) {
    console.log(`[audit] hardware read failed: ${e instanceof Error ? e.message : e}`);
  }
  try {
    const caps = await client.capabilities();
    logJson('capabilities', caps);
  } catch (e) {
    console.log(`[audit] capabilities read failed: ${e instanceof Error ? e.message : e}`);
  }
  for (const [name, id] of [
    ['daytime', FEATURE.DAYTIME_HR],
    ['resting', FEATURE.RESTING_HR],
    ['spo2', FEATURE.SPO2],
    ['steps', FEATURE.REAL_STEPS],
    ['exercise', FEATURE.EXERCISE_HR],
  ] as const) {
    try {
      const st = await client.featureStatus(id);
      console.log(
        `[audit] feature ${name} (0x${id.toString(16)}): mode=${st.mode} status=${st.status} state=${st.state} subscription=${st.subscription}`,
      );
    } catch {
      console.log(`[audit] feature ${name} (0x${id.toString(16)}): status unreadable`);
    }
  }

  const storeCursor = useHealthStore.getState().syncCursor;
  const byTag = new Map<number, TagTally>();
  const dumpByTag = new Map<number, DumpEvent[]>();
  const seen = new Set<string>();
  let total = 0;

  const handle = (e: RingEvent) => {
    // Multi-pass walks overlap — dedupe on the event's identity.
    const key = `${e.tag}:${e.timestamp}:${e.bodyHex}`;
    if (seen.has(key)) return;
    seen.add(key);
    total++;
    let t = byTag.get(e.tag);
    if (!t) {
      t = {
        name: e.name,
        count: 0,
        decoded: 0,
        unvalidated: 0,
        minTs: e.timestamp,
        maxTs: e.timestamp,
        sampleDecoded: null,
        sampleRaw: null,
      };
      byTag.set(e.tag, t);
    }
    t.count++;
    t.minTs = Math.min(t.minTs, e.timestamp);
    t.maxTs = Math.max(t.maxTs, e.timestamp);
    if (e.decoded != null) {
      t.decoded++;
      const d = e.decoded as Record<string, unknown>;
      if (d._status === 'unvalidated') t.unvalidated++;
      if (t.sampleDecoded == null) t.sampleDecoded = JSON.stringify(e.decoded).slice(0, 300);
    } else if (t.sampleRaw == null) {
      t.sampleRaw = e.bodyHex.slice(0, 96);
    }
    if (FULL_DUMP_TAGS.has(e.tag)) {
      let list = dumpByTag.get(e.tag);
      if (!list) {
        list = [];
        dumpByTag.set(e.tag, list);
      }
      list.push(e.decoded != null ? { ts: e.timestamp, body: e.bodyHex, decoded: e.decoded } : { ts: e.timestamp, body: e.bodyHex });
    }
  };

  // Pass 1: from 0. The legacy walk can stop early at a segment boundary
  // (observed: bytesLeft=0 while events exist at higher timestamps), so if it
  // ends below the app's own cursor, pass 2 re-walks the recent era with a
  // one-day overlap for continuity.
  console.log('[audit] full drain pass 1 from cursor 0 (read-only)…');
  const end1 = await drainPass(client, 0, handle);
  console.log(`[audit] pass 1 ended at ${end1} (store cursor ${storeCursor})`);
  if (storeCursor > 0 && end1 < storeCursor - 864_000) {
    console.log('[audit] early termination detected — pass 2 over recent era');
    await drainPass(client, storeCursor - 864_000, handle);
  }
  console.log(`[audit] drain complete: ${total} unique events`);

  const tallies = [...byTag.entries()]
    .map(([tag, t]) => ({ tag: `0x${tag.toString(16)}`, ...t }))
    .sort((a, b) => b.count - a.count);
  logJson('drain.byTag', tallies);

  for (const [tag, list] of [...dumpByTag.entries()].sort((a, b) => a[0] - b[0])) {
    logJson(`dump.0x${tag.toString(16)}.${byTag.get(tag)?.name ?? 'unknown'}`, list);
  }
}
