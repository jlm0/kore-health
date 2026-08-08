import {
  SAMPLE_INTERVAL_MS,
  type ActivitySummary,
  type DaySummary,
  type MetricSample,
  type ReadinessContributors,
  type SeriesId,
  type SleepStage,
  type SleepStageSegment,
  type SleepSummary,
} from './types';

// Scores and sleep stages computed locally from the raw ring streams.
//
// The ring does NOT provide Oura's 0–100 Readiness/Sleep/Activity scores or a
// staged hypnogram — those are computed app/cloud-side by Oura. Everything in
// this file is a transparent heuristic over the synced data (night HR/HRV,
// temperature deviation, movement, MET bins). Each formula is documented at
// its definition. All scores are clamped to 0–100; missing inputs fall back
// to a neutral 0.5 contributor so a sparse day is scored on what exists.

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

export interface SleepWindow {
  startMs: number;
  endMs: number;
}

// Per-day activity totals accumulated from activity_information MET bins in
// ring.ts (persisted between syncs, since the move series alone is lossy).
export interface DayActivityTotals {
  /** Net kcal above resting, summed from MET bins. */
  activeCal: number;
  /** Minutes at MET >= 3 (moderate intensity and up). */
  activeMin: number;
}

export const EMPTY_ACTIVITY: DayActivityTotals = { activeCal: 0, activeMin: 0 };

// Bucket-keyed view of a series: grid timestamp (ms) → value.
export type SeriesMaps = Record<SeriesId, Map<number, number>>;

export function toSeriesMaps(series: Record<SeriesId, MetricSample[]>): SeriesMaps {
  return {
    hr: new Map(series.hr.map((s) => [s.t, s.v])),
    hrv: new Map(series.hrv.map((s) => [s.t, s.v])),
    temp: new Map(series.temp.map((s) => [s.t, s.v])),
    spo2: new Map(series.spo2.map((s) => [s.t, s.v])),
    move: new Map(series.move.map((s) => [s.t, s.v])),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(sortedXs: number[], p: number): number {
  const i = clamp((p / 100) * (sortedXs.length - 1), 0, sortedXs.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sortedXs[lo] + (sortedXs[hi] - sortedXs[lo]) * (i - lo);
}

function emptySleep(window: SleepWindow | null): SleepSummary {
  return {
    start: window?.startMs ?? 0,
    end: window?.endMs ?? 0,
    durationMin: 0,
    efficiency: 0,
    latencyMin: 0,
    stages: [],
    deepMin: 0,
    remMin: 0,
    lightMin: 0,
    awakeMin: 0,
    lowestHr: 0,
    peakHrv: 0,
  };
}

// Movement intensity (0..1) at or above this marks a wake epoch. Chosen so the
// small residual motion of normal sleep (tossing) stays below it — the move
// series blends motion_seconds and accelerometer MAD, both near zero at rest.
const WAKE_MOVE_THRESHOLD = 0.12;

/**
 * Actigraphy-style sleep staging over the ring's own bedtime window.
 *
 * The ring emits no hypnogram, so each 3-minute epoch in the window is
 * classified from overnight movement + heart rate:
 *   awake — movement intensity >= WAKE_MOVE_THRESHOLD (actigraphy wake test)
 *   deep  — still AND HR in the lowest band of the night (<= p10 + 35% of the
 *           p10–p90 range): deep sleep carries the night's HR nadir
 *   rem   — still AND HR in the top band (>= p90 - 25% of range): REM shows
 *           wake-like HR while muscles are paralysed (still)
 *   light — everything else
 * Consecutive equal epochs merge into segments. This is deliberately simple —
 * it uses only signals the ring actually streams and is documented as a local
 * heuristic, not a validated sleep staging algorithm.
 */
export function computeSleep(maps: SeriesMaps, window: SleepWindow | null): SleepSummary {
  if (!window || window.endMs - window.startMs < 30 * MIN) return emptySleep(window);

  interface Epoch {
    t: number;
    move: number | null;
    hr: number | null;
    hrv: number | null;
  }
  const epochs: Epoch[] = [];
  for (let t = window.startMs; t < window.endMs; t += SAMPLE_INTERVAL_MS) {
    const b = Math.floor(t / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
    epochs.push({
      t: b,
      move: maps.move.get(b) ?? null,
      hr: maps.hr.get(b) ?? null,
      hrv: maps.hrv.get(b) ?? null,
    });
  }
  if (epochs.length === 0) return emptySleep(window);

  const hrs = epochs.map((e) => e.hr).filter((v): v is number => v != null);
  const hrvs = epochs.map((e) => e.hrv).filter((v): v is number => v != null);
  const hasHr = hrs.length >= 10;
  const sortedHr = [...hrs].sort((a, b) => a - b);
  const p10 = hasHr ? percentile(sortedHr, 10) : 0;
  const p90 = hasHr ? percentile(sortedHr, 90) : 0;
  const deepMax = p10 + 0.35 * (p90 - p10);
  const remMin = p90 - 0.25 * (p90 - p10);

  const stageOf = (e: Epoch): SleepStage => {
    if (e.move != null && e.move >= WAKE_MOVE_THRESHOLD) return 'awake';
    if (hasHr && e.hr != null) {
      if (e.hr <= deepMax) return 'deep';
      if (e.hr >= remMin) return 'rem';
    }
    return 'light';
  };

  // Latency: start of the first run of >= 3 consecutive asleep epochs (9 min
  // of sustained stillness/low movement), a standard actigraphy sleep-onset rule.
  let latencyMin = 0;
  {
    let run = 0;
    for (const e of epochs) {
      if (stageOf(e) === 'awake') {
        run = 0;
      } else {
        if (run === 0) latencyMin = (e.t - window.startMs) / MIN;
        run++;
        if (run >= 3) break;
      }
    }
    latencyMin = Math.round(clamp(latencyMin, 0, 120));
  }

  const segments: SleepStageSegment[] = [];
  for (const e of epochs) {
    const stage = stageOf(e);
    const last = segments[segments.length - 1];
    if (last && last.stage === stage && last.end === e.t) {
      last.end = e.t + SAMPLE_INTERVAL_MS;
    } else {
      segments.push({ stage, start: e.t, end: Math.min(e.t + SAMPLE_INTERVAL_MS, window.endMs) });
    }
  }

  const totals: Record<SleepStage, number> = { deep: 0, rem: 0, light: 0, awake: 0 };
  for (const s of segments) totals[s.stage] += (s.end - s.start) / MIN;
  const asleepMin = totals.deep + totals.rem + totals.light;
  const inBedMin = (window.endMs - window.startMs) / MIN;

  return {
    start: window.startMs,
    end: window.endMs,
    durationMin: Math.round(asleepMin),
    efficiency: Math.round(clamp((asleepMin / inBedMin) * 100, 0, 100)),
    latencyMin,
    stages: segments,
    deepMin: Math.round(totals.deep),
    remMin: Math.round(totals.rem),
    lightMin: Math.round(totals.light),
    awakeMin: Math.round(totals.awake),
    lowestHr: hrs.length ? Math.round(Math.min(...hrs)) : 0,
    peakHrv: hrvs.length ? Math.round(Math.max(...hrvs)) : 0,
  };
}

/**
 * Resting HR: the night's lowest 30-minute rolling mean HR (10 grid buckets).
 * Matches the common "lowest sustained overnight HR" definition; falls back to
 * the plain minimum when the window is short.
 */
function restingHr(maps: SeriesMaps, window: SleepWindow | null): number {
  if (!window) return 0;
  const pts: { t: number; v: number }[] = [];
  for (const [t, v] of maps.hr) {
    if (t >= window.startMs && t < window.endMs) pts.push({ t, v });
  }
  if (pts.length === 0) return 0;
  pts.sort((a, b) => a.t - b.t);
  const W = 10;
  if (pts.length < W) return Math.round(Math.min(...pts.map((p) => p.v)));
  let best = Infinity;
  for (let i = 0; i + W <= pts.length; i++) {
    let sum = 0;
    for (let j = i; j < i + W; j++) sum += pts[j].v;
    best = Math.min(best, sum / W);
  }
  return Math.round(best);
}

function nightValues(
  map: Map<number, number>,
  window: SleepWindow | null,
): number[] {
  if (!window) return [];
  const out: number[] = [];
  for (const [t, v] of map) {
    if (t >= window.startMs && t < window.endMs) out.push(v);
  }
  return out;
}

/**
 * Activity summary for one day.
 *
 * steps is reported as 0: the ring's step-count events (0x7e/0x7f) are
 * unvalidated packed records (see open_oura), and a step estimate from ring
 * accelerometer motion-seconds would not be defensible — we show no number
 * rather than an invented one. kmEquiv follows steps.
 *
 * inactiveMin counts near-still 3-min buckets during waking hours (07:00–23:00
 * local) outside any sleep window.
 */
export function computeActivity(
  maps: SeriesMaps,
  dayStart: number,
  totals: DayActivityTotals,
  goalCal: number,
  window: SleepWindow | null,
): ActivitySummary {
  let inactiveMin = 0;
  for (const [t, v] of maps.move) {
    if (t < dayStart || t >= dayStart + DAY) continue;
    const hour = new Date(t).getHours();
    if (hour < 7 || hour >= 23) continue;
    if (window && t >= window.startMs && t < window.endMs) continue;
    if (v < 0.05) inactiveMin += SAMPLE_INTERVAL_MS / MIN;
  }
  return {
    steps: 0,
    activeCal: Math.round(totals.activeCal),
    goalCal,
    kmEquiv: 0,
    inactiveMin: Math.round(inactiveMin),
  };
}

/**
 * Sleep score (0–100) from the computed sleep summary:
 *   45% duration   asleep minutes vs an 8 h (480 min) target
 *   25% efficiency vs a 95% ceiling
 *   15% latency    5 min → full marks, 35+ min → zero
 *   15% architecture  deep share vs 18% and REM share vs 22% reference mixes
 */
export function sleepScore(sleep: SleepSummary): number {
  if (sleep.start === 0 || sleep.durationMin === 0) return 0;
  const duration = clamp(sleep.durationMin / 480, 0, 1);
  const efficiency = clamp(sleep.efficiency / 95, 0, 1);
  const latency = 1 - clamp((sleep.latencyMin - 5) / 30, 0, 1);
  const asleep = Math.max(sleep.durationMin, 1);
  const stage = clamp(
    0.5 * (sleep.deepMin / asleep / 0.18) + 0.5 * (sleep.remMin / asleep / 0.22),
    0,
    1,
  );
  return Math.round(100 * (0.45 * duration + 0.25 * efficiency + 0.15 * latency + 0.15 * stage));
}

export interface DayMetrics {
  hrvAvg: number;
  restingHr: number;
  tempDeviation: number;
  spo2: number;
}

/**
 * Readiness (0–100) and its contributors (0..1 progress values).
 *
 * Contributors compare the night against personal baselines (median of up to
 * 14 prior days with data); a missing signal contributes a neutral 0.5.
 *   hrvBalance      (hrvAvg / baselineHrv) / 1.15 — parity ≈ 0.87
 *   restingHr       0.85 - (rhr - baselineRhr) * 0.05 — +3 bpm → 0.70
 *   bodyTemp        1 - |tempDeviation| / 0.5 °C
 *   sleep           sleepScore / 100
 *   recovery        mean(hrvBalance, restingHr)
 *   activityBalance yesterday's activeCal / goal, capped at 1.2× and rescaled
 * Readiness = 25% HRV + 25% sleep + 15% resting HR + 10% temp + 10% recovery
 * + 15% activity balance, clamped to 0–100.
 */
export function computeReadiness(input: {
  metrics: DayMetrics;
  sleepScoreValue: number;
  activity: ActivitySummary;
  yesterday: DayActivityTotals;
  priorDays: DaySummary[];
  /** False until a temp baseline exists (first week) — contributor stays neutral. */
  hasTempBaseline: boolean;
}): { readiness: number; contributors: ReadinessContributors } {
  const { metrics, sleepScoreValue, activity, yesterday, priorDays, hasTempBaseline } = input;

  const hrvBase = median(priorDays.map((d) => d.hrvAvg).filter((v) => v > 0).slice(-14));
  const rhrBase = median(priorDays.map((d) => d.restingHr).filter((v) => v > 0).slice(-14));

  const hrvBalance =
    metrics.hrvAvg > 0 && hrvBase != null
      ? clamp(metrics.hrvAvg / hrvBase / 1.15, 0, 1)
      : 0.5;
  const restingHrC =
    metrics.restingHr > 0 && rhrBase != null
      ? clamp(0.85 - (metrics.restingHr - rhrBase) * 0.05, 0, 1)
      : 0.5;
  const bodyTemp = hasTempBaseline ? clamp(1 - Math.abs(metrics.tempDeviation) / 0.5, 0, 1) : 0.5;
  const sleepC = sleepScoreValue > 0 ? sleepScoreValue / 100 : 0.5;
  const recovery = (hrvBalance + restingHrC) / 2;
  const activityBalance = clamp(yesterday.activeCal / Math.max(activity.goalCal, 1) / 1.2, 0, 1);

  const readiness = Math.round(
    clamp(
      100 *
        (0.25 * hrvBalance +
          0.25 * sleepC +
          0.15 * restingHrC +
          0.1 * bodyTemp +
          0.1 * recovery +
          0.15 * activityBalance),
      0,
      100,
    ),
  );

  return {
    readiness,
    contributors: {
      hrvBalance,
      bodyTemp,
      sleep: sleepC,
      restingHr: restingHrC,
      recovery,
      activityBalance,
    },
  };
}

export interface DayContext {
  dayStart: number;
  sleepWindow: SleepWindow | null;
  /** This night's absolute mean skin temperature (°C), if measured. */
  tempNightMeanC: number | null;
  /** Personal baseline: median of up to 7 prior nightly means (°C). */
  tempBaselineC: number | null;
  activity: DayActivityTotals;
  yesterday: DayActivityTotals;
  goalCal: number;
  priorDays: DaySummary[];
}

/** Assemble a full DaySummary for one day from the series maps + context. */
export function buildDaySummary(maps: SeriesMaps, ctx: DayContext): DaySummary {
  const sleep = computeSleep(maps, ctx.sleepWindow);
  const window = ctx.sleepWindow;

  const hrvNight = nightValues(maps.hrv, window);
  const spo2Night = nightValues(maps.spo2, window);
  const hrvAvg = mean(hrvNight);
  const spo2Avg = mean(spo2Night);

  const tempDeviation =
    ctx.tempNightMeanC != null && ctx.tempBaselineC != null
      ? Math.round((ctx.tempNightMeanC - ctx.tempBaselineC) * 100) / 100
      : 0;

  const metrics: DayMetrics = {
    hrvAvg: hrvAvg != null ? Math.round(hrvAvg) : 0,
    restingHr: restingHr(maps, window),
    tempDeviation,
    spo2: spo2Avg != null ? Math.round(spo2Avg * 10) / 10 : 0,
  };

  const activity = computeActivity(maps, ctx.dayStart, ctx.activity, ctx.goalCal, window);
  const sleepScoreValue = sleepScore(sleep);
  // Activity score (0–100): 70% active calories vs the daily goal, 30%
  // moderate+ minutes vs a 60 min target.
  const actScore = Math.round(
    100 *
      (0.7 * clamp(activity.activeCal / Math.max(activity.goalCal, 1), 0, 1) +
        0.3 * clamp(ctx.activity.activeMin / 60, 0, 1)),
  );
  const { readiness, contributors } = computeReadiness({
    metrics,
    sleepScoreValue,
    activity,
    yesterday: ctx.yesterday,
    priorDays: ctx.priorDays,
    hasTempBaseline: ctx.tempNightMeanC != null && ctx.tempBaselineC != null,
  });

  const d = new Date(ctx.dayStart);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

  return {
    date,
    dayStart: ctx.dayStart,
    readiness,
    sleepScore: sleepScoreValue,
    activityScore: actScore,
    contributors,
    sleep,
    activity,
    hrvAvg: metrics.hrvAvg,
    restingHr: metrics.restingHr,
    tempDeviation: metrics.tempDeviation,
    spo2: metrics.spo2,
  };
}
