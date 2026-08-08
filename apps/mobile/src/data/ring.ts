import {
  buildDaySummary,
  toSeriesMaps,
  type DayActivityTotals,
  type SleepWindow,
} from './scores';
import {
  DATASET_DAYS,
  SAMPLE_INTERVAL_MS,
  type Dataset,
  type DaySummary,
  type MetricSample,
  type SeriesId,
} from './types';

// Pure mapping from decoded ring history events → dataset increments.
//
// Decoded event shapes come from OuraCore.decodeEvent (see
// third_party/open_oura/crates/oura-protocol/src/events.rs). Ring event
// timestamps are ring-clock deciseconds; they are anchored to wall-clock via
// the ring's own time_sync events (u32 unix seconds in the body), falling back
// to "newest event ≈ now" when no time_sync was captured (the same anchor
// oura-cli uses). All series live on the shared 3-minute grid: events are
// aggregated per grid bucket (mean).

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface RingEventLike {
  tag: number;
  name: string;
  /** Envelope timestamp in ring-clock deciseconds. */
  timestamp: number;
  decoded: unknown;
}

/** Absolute nightly mean skin temperature, keyed by wake-day local midnight. */
export interface TempNight {
  dayStart: number;
  meanC: number;
}

/** Everything the fold needs from (and returns to) the persisted store. */
export interface RingFoldState {
  dataset: Dataset;
  /** Absolute °C grid points — kept so temp deviations can be re-baselined. */
  tempAbsSeries: MetricSample[];
  tempNights: TempNight[];
  /** Per-day MET-derived totals, keyed by local-midnight ms (as string). */
  activityByDay: Record<string, DayActivityTotals>;
}

export interface FoldResult {
  state: RingFoldState;
  eventsApplied: number;
  clockAnchor: 'time_sync' | 'newest_event' | 'none';
}

export function emptyDataset(): Dataset {
  return { days: [], series: { hr: [], hrv: [], temp: [], spo2: [], move: [] } };
}

export function emptyFoldState(): RingFoldState {
  return { dataset: emptyDataset(), tempAbsSeries: [], tempNights: [], activityByDay: {} };
}

function localDayStart(tMs: number): number {
  const d = new Date(tMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// A night is attributed to the calendar day you wake up: any timestamp maps to
// the local midnight 12 h ahead (23:00 Mon → Tue, 06:00 Tue → Tue).
function nightKey(tMs: number): number {
  return localDayStart(tMs + 12 * HOUR);
}

function bucketOf(tMs: number): number {
  return Math.floor(tMs / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
}

// --- decoded-payload accessors (defensive: decoded is `unknown`) -------------

function obj(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function numArray(v: unknown, key: string): number[] {
  const a = obj(v)?.[key];
  return Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number') : [];
}

function num(v: unknown, key: string): number | null {
  const n = obj(v)?.[key];
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// --- bucket accumulator ------------------------------------------------------

class BucketAcc {
  private buckets = new Map<number, { sum: number; count: number }>();

  add(tMs: number, v: number): void {
    const b = bucketOf(tMs);
    const cur = this.buckets.get(b);
    if (cur) {
      cur.sum += v;
      cur.count += 1;
    } else {
      this.buckets.set(b, { sum: v, count: 1 });
    }
  }

  seed(samples: MetricSample[]): void {
    for (const s of samples) this.buckets.set(bucketOf(s.t), { sum: s.v, count: 1 });
  }

  keys(): Iterable<number> {
    return this.buckets.keys();
  }

  /** Sorted grid points, value = bucket mean, `t` = bucket start. */
  materialize(round: (v: number) => number, minT: number): MetricSample[] {
    const out: MetricSample[] = [];
    for (const [t, { sum, count }] of this.buckets) {
      if (t < minT) continue;
      out.push({ t, v: round(sum / count) });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const round0 = (v: number) => Math.round(v);

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Calories from MET bins: kcal/min = MET × 3.5 × kg / 200. With an assumed
// 70 kg wearer (no profile data on the ring) and crediting only work above
// resting (MET − 1): kcal = (MET − 1) × 1.225 per minute.
const KCAL_PER_MIN_PER_MET = (3.5 * 70) / 200;
const MODERATE_MET = 3;

/**
 * Fold a batch of ring events into the persisted fold state, producing a new
 * dataset with all DaySummary rows recomputed. Pure: no I/O, no globals.
 */
export function foldRingEvents(input: {
  prior: RingFoldState | null;
  events: RingEventLike[];
  goalCal: number;
  nowMs?: number;
}): FoldResult {
  const { events, goalCal } = input;
  const nowMs = input.nowMs ?? Date.now();
  const prior = input.prior ?? emptyFoldState();

  // --- anchor ring clock (deciseconds) to wall-clock ms ---------------------
  // Prefer time_sync events: body carries the u32 unix time that was written
  // to the ring, at the event's ring timestamp. syncRing() calls syncTime()
  // before draining, so a fresh anchor is normally present.
  let offsetMs: number | null = null;
  let clockAnchor: FoldResult['clockAnchor'] = 'none';
  for (const e of events) {
    if (e.name !== 'time_sync') continue;
    const unix = num(e.decoded, 'unix_time');
    if (unix != null && unix > 0) {
      offsetMs = unix * 1000 - e.timestamp * 100;
      clockAnchor = 'time_sync';
    }
  }
  if (offsetMs == null && events.length > 0) {
    // Fallback: assume the newest event in the batch happened "now" (the drain
    // runs live against the ring). Less accurate for stale rings, documented.
    const maxDs = Math.max(...events.map((e) => e.timestamp));
    offsetMs = nowMs - maxDs * 100;
    clockAnchor = 'newest_event';
  }
  const toMs = (ds: number): number => ds * 100 + (offsetMs ?? 0);

  // --- seed accumulators from the prior persisted state ---------------------
  const hr = new BucketAcc();
  const hrv = new BucketAcc();
  const spo2 = new BucketAcc();
  const move = new BucketAcc();
  const tempAbs = new BucketAcc();
  hr.seed(prior.dataset.series.hr);
  hrv.seed(prior.dataset.series.hrv);
  spo2.seed(prior.dataset.series.spo2);
  move.seed(prior.dataset.series.move);
  tempAbs.seed(prior.tempAbsSeries);

  // Nightly absolute temp means (for the personal baseline).
  const nightAcc = new Map<number, { sum: number; count: number }>();
  for (const n of prior.tempNights) nightAcc.set(n.dayStart, { sum: n.meanC, count: 1 });

  // Sleep windows keyed by wake-day local midnight.
  const sleepWindows = new Map<number, SleepWindow>();
  for (const d of prior.dataset.days) {
    if (d.sleep.start > 0 && d.sleep.end > d.sleep.start) {
      sleepWindows.set(d.dayStart, { startMs: d.sleep.start, endMs: d.sleep.end });
    }
  }

  const activityByDay: Record<string, DayActivityTotals> = { ...prior.activityByDay };

  // --- apply events ----------------------------------------------------------
  let eventsApplied = 0;
  for (const e of events) {
    if (offsetMs == null) break;
    const t = toMs(e.timestamp);
    const d = e.decoded;
    switch (e.name) {
      case 'hrv_event': {
        // 5-minute windows of (avg HR bpm, avg RMSSD ms), sequential from the
        // event timestamp.
        const hrs = numArray(d, 'hr_bpm');
        const rmssd = numArray(d, 'rmssd_ms');
        const intervalMin = num(d, 'interval_min') ?? 5;
        for (let i = 0; i < Math.max(hrs.length, rmssd.length); i++) {
          const ti = t + i * intervalMin * MIN;
          const h = hrs[i];
          const r = rmssd[i];
          if (h != null && h > 0) hr.add(ti, h);
          if (r != null && r > 0) hrv.add(ti, r);
        }
        eventsApplied++;
        break;
      }
      case 'ibi_and_amplitude_event':
      case 'green_ibi_quality_event': {
        // Overnight / daytime per-beat streams. The decoder already converts
        // plausible IBIs (300–2000 ms) to bpm; aggregate into the 3-min grid.
        for (const bpm of numArray(d, 'hr_bpm')) hr.add(t, bpm);
        eventsApplied++;
        break;
      }
      case 'temp_event':
      case 'temp_period':
      case 'sleep_temp_event': {
        // i16 LE /100 °C, already decoded to °C. Keep plausible skin temps and
        // average probes within one event. Absolute values are stored; the
        // deviation series is derived after the baseline pass below.
        const temps = numArray(d, 'temps_c').filter((c) => c >= 25 && c <= 40);
        if (temps.length === 0) break;
        const meanC = temps.reduce((s, v) => s + v, 0) / temps.length;
        tempAbs.add(t, meanC);
        // Nightly means use night hours only (20:00–12:00 local).
        const hour = new Date(t).getHours();
        if (hour >= 20 || hour < 12) {
          const key = nightKey(t);
          const acc = nightAcc.get(key) ?? { sum: 0, count: 0 };
          acc.sum += meanC;
          acc.count += 1;
          nightAcc.set(key, acc);
        }
        eventsApplied++;
        break;
      }
      case 'spo2_event': {
        // Summarized SpO2 % samples at 1 Hz — average the burst into one grid
        // point. (spo2_r_pi raw R-ratios are NOT converted: the R→SpO2 curve
        // needs Oura's per-device calibration coefficients, which are
        // proprietary. Without them any % we emitted would be invented.)
        const vals = numArray(d, 'spo2_percent').filter((v) => v >= 70 && v <= 100);
        if (vals.length === 0) break;
        spo2.add(t, vals.reduce((s, v) => s + v, 0) / vals.length);
        eventsApplied++;
        break;
      }
      case 'motion_event': {
        // motion_seconds (0–31 within the window) + intensity nibbles (0–63).
        // Blend: 60% duty cycle + 40% peak intensity, clamped to 0..1.
        const motionSeconds = num(d, 'motion_seconds') ?? 0;
        const high = num(d, 'high_intensity') ?? num(d, 'low_intensity') ?? 0;
        move.add(t, clamp(0.6 * (motionSeconds / 31) + 0.4 * (high / 63), 0, 1));
        eventsApplied++;
        break;
      }
      case 'sleep_acm_period': {
        // 6 accelerometer MAD statistics (fixed-point, arbitrary units — ~0.7
        // at rest in captures). Rough normalization: mean MAD / 4 → 0..1.
        const mad = numArray(d, 'acm_mad');
        if (mad.length === 0) break;
        move.add(t, clamp(mad.reduce((s, v) => s + v, 0) / mad.length / 4, 0, 1));
        eventsApplied++;
        break;
      }
      case 'activity_information': {
        // State byte + per-bin MET levels. Bin duration is undocumented in the
        // decompile — we assume 1 minute per bin (documented assumption).
        const mets = numArray(d, 'met');
        for (let i = 0; i < mets.length; i++) {
          const m = mets[i];
          if (m <= 0) continue;
          const ti = t + i * MIN;
          move.add(ti, clamp((m - 1) / 8, 0, 1)); // MET 1 rest → 9+ vigorous
          if (m >= 1.5) {
            const key = String(localDayStart(ti));
            // Copy before accumulating — the prior totals objects belong to
            // the persisted state and must never be mutated in place.
            const acc = { ...(activityByDay[key] ?? { activeCal: 0, activeMin: 0 }) };
            acc.activeCal += (m - 1) * KCAL_PER_MIN_PER_MET;
            if (m >= MODERATE_MET) acc.activeMin += 1;
            activityByDay[key] = acc;
          }
        }
        eventsApplied++;
        break;
      }
      case 'bedtime_period': {
        // The ring's detected sleep window (ring deciseconds → wall ms).
        const startDs = num(d, 'bedtime_start_ds');
        const endDs = num(d, 'bedtime_end_ds');
        if (startDs == null || endDs == null) break;
        const startMs = toMs(startDs);
        const endMs = toMs(endDs);
        const durH = (endMs - startMs) / HOUR;
        if (durH < 1 || durH > 16) break; // implausible window, ignore
        sleepWindows.set(nightKey(startMs), { startMs, endMs });
        eventsApplied++;
        break;
      }
      default:
        break;
    }
  }

  // --- materialize series ----------------------------------------------------
  const trimStart = localDayStart(nowMs) - (DATASET_DAYS - 1) * DAY;
  const tempAbsSeries = tempAbs.materialize(round2, trimStart);

  // Temp baseline: for each night, the median of the up-to-7 preceding nightly
  // means (a robust personal baseline; 7 nights ≈ Oura's "past week" framing).
  const tempNights: TempNight[] = [...nightAcc.entries()]
    .map(([dayStart, a]) => ({ dayStart, meanC: round2(a.sum / a.count) }))
    .filter((n) => n.dayStart >= trimStart)
    .sort((a, b) => a.dayStart - b.dayStart);
  const baselineByNight = new Map<number, number>();
  for (let i = 0; i < tempNights.length; i++) {
    const prev = tempNights.slice(Math.max(0, i - 7), i).map((n) => n.meanC);
    const base = median(prev);
    if (base != null) baselineByNight.set(tempNights[i].dayStart, base);
  }
  // Deviation series: absolute grid point minus its night's baseline. Nights
  // without a baseline yet (first week of data) report deviation 0.
  const tempSeries: MetricSample[] = tempAbsSeries.map((s) => {
    const base = baselineByNight.get(nightKey(s.t));
    return { t: s.t, v: base != null ? round2(s.v - base) : 0 };
  });

  const series: Record<SeriesId, MetricSample[]> = {
    hr: hr.materialize(round1, trimStart),
    hrv: hrv.materialize(round1, trimStart),
    temp: tempSeries,
    spo2: spo2.materialize(round1, trimStart),
    move: move.materialize(round2, trimStart),
  };
  const maps = toSeriesMaps(series);

  // --- recompute every affected DaySummary ----------------------------------
  const dayStarts = new Set<number>();
  for (const id of Object.keys(series) as SeriesId[]) {
    for (const s of series[id]) dayStarts.add(localDayStart(s.t));
  }
  for (const key of sleepWindows.keys()) dayStarts.add(key);
  for (const key of Object.keys(activityByDay)) dayStarts.add(Number(key));
  for (const d of prior.dataset.days) dayStarts.add(d.dayStart);

  const sortedDays = [...dayStarts].filter((t) => t >= trimStart).sort((a, b) => a - b);
  const nightMeanByDay = new Map(tempNights.map((n) => [n.dayStart, n.meanC]));

  const days: DaySummary[] = [];
  for (const dayStart of sortedDays) {
    const prevDay = String(dayStart - DAY);
    const day = buildDaySummary(maps, {
      dayStart,
      sleepWindow: sleepWindows.get(dayStart) ?? null,
      tempNightMeanC: nightMeanByDay.get(dayStart) ?? null,
      tempBaselineC: baselineByNight.get(dayStart) ?? null,
      activity: activityByDay[String(dayStart)] ?? { activeCal: 0, activeMin: 0 },
      yesterday: activityByDay[prevDay] ?? { activeCal: 0, activeMin: 0 },
      goalCal,
      priorDays: days,
    });
    days.push(day);
  }

  // Keep the persisted per-day activity totals inside the 30-day window too,
  // same as series/days/tempNights — otherwise the map grows without bound.
  const trimmedActivityByDay: Record<string, DayActivityTotals> = {};
  for (const [key, totals] of Object.entries(activityByDay)) {
    if (Number(key) >= trimStart) trimmedActivityByDay[key] = totals;
  }

  return {
    state: { dataset: { days, series }, tempAbsSeries, tempNights, activityByDay: trimmedActivityByDay },
    eventsApplied,
    clockAnchor,
  };
}
