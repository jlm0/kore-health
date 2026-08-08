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
    const caps = await client.capabilities();
    logJson('capabilities', caps);
  } catch (e) {
    console.log(`[audit] capabilities read failed: ${e instanceof Error ? e.message : e}`);
  }
  for (const [name, id] of [
    ['daytime', FEATURE.DAYTIME_HR],
    ['resting', FEATURE.RESTING_HR],
    ['spo2', FEATURE.SPO2],
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

  const byTag = new Map<number, TagTally>();
  const timeSyncs: { ringTs: number; unixTime: number }[] = [];
  const bedtimes: unknown[] = [];
  const hypnograms: { ts: number; decoded: unknown }[] = [];
  let total = 0;

  console.log('[audit] full drain from cursor 0 (read-only)…');
  const outcome = await client.drainEvents(
    0,
    (e) => {
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
        if (t.sampleDecoded == null) {
          t.sampleDecoded = JSON.stringify(e.decoded).slice(0, 300);
        }
        if (e.name === 'time_sync' && typeof d.unix_time === 'number') {
          timeSyncs.push({ ringTs: e.timestamp, unixTime: d.unix_time });
        }
        if (e.name === 'bedtime_period' && bedtimes.length < 10) {
          bedtimes.push({ ts: e.timestamp, decoded: e.decoded });
        }
        if (e.name.startsWith('sleep_phase') && hypnograms.length < 10) {
          hypnograms.push({ ts: e.timestamp, decoded: e.decoded });
        }
      } else if (t.sampleRaw == null) {
        t.sampleRaw = e.bodyHex.slice(0, 96);
      }
    },
    (nextCursor) => console.log(`[audit] drain progress: cursor=${nextCursor} events=${total}`),
  );
  console.log(`[audit] drain complete: ${outcome.eventsSynced} events`);

  const tallies = [...byTag.entries()]
    .map(([tag, t]) => ({ tag: `0x${tag.toString(16)}`, ...t }))
    .sort((a, b) => b.count - a.count);
  logJson('drain.byTag', tallies);

  // Clock-anchor evidence: each time_sync maps a ring decisecond ts to unix
  // time — consecutive anchors expose ring-clock drift and anchor spacing.
  const anchors = timeSyncs.map((a, i) => {
    const prev = timeSyncs[i - 1];
    return {
      ...a,
      wallIso: iso(a.unixTime * 1000),
      ringGapDs: prev ? a.ringTs - prev.ringTs : null,
      wallGapS: prev ? a.unixTime - prev.unixTime : null,
      driftMs: prev
        ? (a.unixTime - prev.unixTime) * 1000 - (a.ringTs - prev.ringTs) * 100
        : null,
    };
  });
  logJson('drain.timeSyncAnchors', anchors);

  logJson('drain.bedtimes', bedtimes);
  logJson(
    'drain.hypnogramSamples',
    hypnograms.map((h) => ({
      ts: h.ts,
      phases: (h.decoded as { phases?: string[] })?.phases?.length ?? null,
      decoded: h.decoded,
    })),
  );
}
