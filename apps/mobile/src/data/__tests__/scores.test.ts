import { describe, expect, it } from 'bun:test';
import {
  buildDaySummary,
  computeActivity,
  computeReadiness,
  computeSleep,
  sleepScore,
  toSeriesMaps,
  EMPTY_ACTIVITY,
} from '../scores';
import { SAMPLE_INTERVAL_MS, type MetricSample, type SeriesId, type SleepSummary } from '../types';

// Tests for the aggregation/scoring contract in docs/bdd/ring-sync-data.feature:
// sleep staging thresholds, latency and efficiency, resting-HR rolling mean,
// night HRV average, score clamping and neutral 0.5 fallbacks, steps-as-zero.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GRID = SAMPLE_INTERVAL_MS;

function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const TODAY = localMidnight(Date.now());

function maps(partial: Partial<Record<SeriesId, MetricSample[]>>) {
  return toSeriesMaps({
    hr: partial.hr ?? [],
    hrv: partial.hrv ?? [],
    temp: partial.temp ?? [],
    spo2: partial.spo2 ?? [],
    move: partial.move ?? [],
  });
}

// A grid-aligned sleep window ending this morning: 23:00 → 07:00.
const WAKE_DAY = TODAY;
const WIN_START = Math.floor((WAKE_DAY - HOUR) / GRID) * GRID;
const WIN_END = WIN_START + 8 * HOUR;
const WINDOW = { startMs: WIN_START, endMs: WIN_END };

describe('computeSleep — actigraphy staging heuristic', () => {
  // 60-min window = 20 epochs: 2 awake (move ≥ 0.12), 13 deep (HR at the
  // night low), 1 light (mid HR), 4 REM (HR at the night high). With these 20
  // HR values, p10 = 50 and p90 = 80, so the deep ceiling is 60.5 and the REM
  // floor is 72.5.
  const S_START = WIN_START;
  const S_END = S_START + 60 * MIN;
  const S_WINDOW = { startMs: S_START, endMs: S_END };
  const epochs = 20;
  const move: MetricSample[] = [];
  const hr: MetricSample[] = [];
  const hrv: MetricSample[] = [];
  for (let i = 0; i < epochs; i++) {
    const t = S_START + i * GRID;
    if (i < 2) {
      move.push({ t, v: 0.5 }); // awake
      hr.push({ t, v: 65 });
    } else if (i < 15) {
      move.push({ t, v: 0 });
      hr.push({ t, v: 50 }); // deep band
      hrv.push({ t, v: 40 + i });
    } else if (i === 15) {
      move.push({ t, v: 0 });
      hr.push({ t, v: 65 }); // light band
    } else {
      move.push({ t, v: 0 });
      hr.push({ t, v: 80 }); // REM band
    }
  }
  const sleep = computeSleep(maps({ move, hr, hrv }), S_WINDOW);

  it('stages epochs: movement ≥ 0.12 awake, HR-nadir deep, HR-peak REM, else light', () => {
    expect(sleep.awakeMin).toBe(6); // 2 epochs × 3 min
    expect(sleep.deepMin).toBe(39); // 13 epochs (i = 2..14)
    expect(sleep.remMin).toBe(12); // 4 epochs (i = 16..19)
    expect(sleep.lightMin).toBe(3); // 1 epoch (i = 15)
    expect(sleep.lowestHr).toBe(50);
    expect(sleep.peakHrv).toBe(54);
  });

  it('latency is the first run of 3 consecutive asleep epochs', () => {
    expect(sleep.latencyMin).toBe(6); // epochs 0–1 awake, asleep run starts at epoch 2
  });

  it('efficiency = asleep / time-in-bed', () => {
    const asleepMin = sleep.deepMin + sleep.remMin + sleep.lightMin;
    expect(sleep.durationMin).toBe(asleepMin);
    expect(sleep.efficiency).toBe(Math.round((asleepMin / 60) * 100));
  });

  it('returns an empty summary for windows shorter than 30 min', () => {
    const s = computeSleep(maps({}), { startMs: WIN_START, endMs: WIN_START + 20 * MIN });
    expect(s.durationMin).toBe(0);
    expect(s.stages).toEqual([]);
  });

  it('returns an empty summary without a window', () => {
    const s = computeSleep(maps({}), null);
    expect(s.start).toBe(0);
    expect(s.durationMin).toBe(0);
  });
});

describe('buildDaySummary — night-derived metrics', () => {
  it('restingHr is the lowest 30-min rolling mean of night HR (not the min)', () => {
    // 12 consecutive night buckets; plain minimum is 50, best 10-bucket mean is 54.6.
    const vals = [60, 60, 58, 58, 55, 55, 52, 52, 50, 50, 58, 58];
    const hr = vals.map((v, i) => ({ t: WIN_START + i * GRID, v }));
    const day = buildDaySummary(maps({ hr }), {
      dayStart: WAKE_DAY,
      sleepWindow: WINDOW,
      tempNightMeanC: null,
      tempBaselineC: null,
      activity: EMPTY_ACTIVITY,
      yesterday: EMPTY_ACTIVITY,
      goalCal: 500,
      priorDays: [],
    });
    expect(day.restingHr).toBe(55);
  });

  it('falls back to the plain minimum for short windows (< 10 buckets)', () => {
    const vals = [70, 60, 65, 62, 68];
    const hr = vals.map((v, i) => ({ t: WIN_START + i * GRID, v }));
    const day = buildDaySummary(maps({ hr }), {
      dayStart: WAKE_DAY,
      sleepWindow: { startMs: WIN_START, endMs: WIN_START + 5 * GRID },
      tempNightMeanC: null,
      tempBaselineC: null,
      activity: EMPTY_ACTIVITY,
      yesterday: EMPTY_ACTIVITY,
      goalCal: 500,
      priorDays: [],
    });
    expect(day.restingHr).toBe(60);
  });

  it('hrvAvg is the mean of night RMSSD windows; spo2 is the night mean', () => {
    const hrv = [40, 60].map((v, i) => ({ t: WIN_START + i * GRID, v }));
    const spo2 = [96, 98].map((v, i) => ({ t: WIN_START + i * GRID, v }));
    const day = buildDaySummary(maps({ hrv, spo2 }), {
      dayStart: WAKE_DAY,
      sleepWindow: WINDOW,
      tempNightMeanC: 36.5,
      tempBaselineC: 36.0,
      activity: EMPTY_ACTIVITY,
      yesterday: EMPTY_ACTIVITY,
      goalCal: 500,
      priorDays: [],
    });
    expect(day.hrvAvg).toBe(50);
    expect(day.spo2).toBe(97);
    expect(day.tempDeviation).toBe(0.5);
  });

  it('reports steps and kmEquiv as zero (unvalidated real_steps records)', () => {
    const day = buildDaySummary(maps({}), {
      dayStart: WAKE_DAY,
      sleepWindow: null,
      tempNightMeanC: null,
      tempBaselineC: null,
      activity: { activeCal: 300.4, activeMin: 45 },
      yesterday: EMPTY_ACTIVITY,
      goalCal: 500,
      priorDays: [],
    });
    expect(day.activity.steps).toBe(0);
    expect(day.activity.kmEquiv).toBe(0);
    expect(day.activity.activeCal).toBe(300);
  });
});

describe('sleepScore — clamped composite', () => {
  const perfect: SleepSummary = {
    start: WIN_START,
    end: WIN_END,
    durationMin: 480,
    efficiency: 95,
    latencyMin: 5,
    stages: [],
    deepMin: 86.4, // 18% of asleep
    remMin: 105.6, // 22% of asleep
    lightMin: 288,
    awakeMin: 0,
    lowestHr: 50,
    peakHrv: 80,
  };

  it('scores a textbook night at 100', () => {
    expect(sleepScore(perfect)).toBe(100);
  });

  it('scores no sleep at 0', () => {
    expect(sleepScore({ ...perfect, start: 0, durationMin: 0 })).toBe(0);
  });

  it('stays within 0–100 for extreme inputs', () => {
    const terrible = sleepScore({ ...perfect, durationMin: 60, efficiency: 40, latencyMin: 120 });
    const over = sleepScore({
      ...perfect,
      durationMin: 900,
      efficiency: 100,
      deepMin: 162, // 18% of 900
      remMin: 198, // 22% of 900
    });
    expect(terrible).toBeGreaterThanOrEqual(0);
    expect(terrible).toBeLessThanOrEqual(100);
    expect(over).toBe(100);
  });
});

describe('computeReadiness — neutral fallbacks and clamping', () => {
  it('missing contributors fall back to neutral 0.5', () => {
    const { readiness, contributors } = computeReadiness({
      metrics: { hrvAvg: 0, restingHr: 0, tempDeviation: 0, spo2: 0 },
      sleepScoreValue: 0,
      activity: { steps: 0, activeCal: 0, goalCal: 500, kmEquiv: 0, inactiveMin: 0 },
      yesterday: EMPTY_ACTIVITY,
      priorDays: [],
      hasTempBaseline: false,
    });
    expect(contributors.hrvBalance).toBe(0.5);
    expect(contributors.restingHr).toBe(0.5);
    expect(contributors.bodyTemp).toBe(0.5);
    expect(contributors.sleep).toBe(0.5);
    expect(contributors.recovery).toBe(0.5);
    expect(contributors.activityBalance).toBe(0); // 0 cal vs goal — not neutral, measured
    // 100 × 0.5 × (0.25+0.25+0.15+0.1+0.1) = 42.5 → 43
    expect(readiness).toBe(43);
  });

  it('clamps the composite to 0–100 for extreme inputs', () => {
    const { readiness } = computeReadiness({
      metrics: { hrvAvg: 500, restingHr: 20, tempDeviation: 0, spo2: 0 },
      sleepScoreValue: 100,
      activity: { steps: 0, activeCal: 0, goalCal: 500, kmEquiv: 0, inactiveMin: 0 },
      yesterday: { activeCal: 100_000, activeMin: 0 },
      priorDays: [
        // Minimal prior days to establish baselines.
        ...[60, 60, 60].map((hrvAvg, i) => ({
          date: '2026-01-0' + (i + 1),
          dayStart: TODAY - (3 - i) * DAY,
          readiness: 0,
          sleepScore: 0,
          activityScore: 0,
          contributors: {
            hrvBalance: 0,
            bodyTemp: 0,
            sleep: 0,
            restingHr: 0,
            recovery: 0,
            activityBalance: 0,
          },
          sleep: {
            start: 0,
            end: 0,
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
          },
          activity: { steps: 0, activeCal: 0, goalCal: 500, kmEquiv: 0, inactiveMin: 0 },
          hrvAvg,
          restingHr: 50,
          tempDeviation: 0,
          spo2: 0,
        })),
      ],
      hasTempBaseline: true,
    });
    expect(readiness).toBeLessThanOrEqual(100);
    expect(readiness).toBeGreaterThanOrEqual(0);
  });
});

describe('computeActivity — inactive minutes and zero steps', () => {
  it('counts near-still waking-hours buckets outside the sleep window', () => {
    // Two still buckets at 10:00 and one active bucket at 11:00 today.
    const at10 = TODAY + 10 * HOUR;
    const move: MetricSample[] = [
      { t: at10, v: 0.01 },
      { t: at10 + GRID, v: 0.02 },
      { t: at10 + HOUR, v: 0.6 },
    ];
    const a = computeActivity(maps({ move }), TODAY, EMPTY_ACTIVITY, 500, null);
    expect(a.inactiveMin).toBe(6);
    expect(a.steps).toBe(0);
    expect(a.kmEquiv).toBe(0);
  });
});
