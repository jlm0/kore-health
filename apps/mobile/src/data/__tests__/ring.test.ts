import { describe, expect, it } from 'bun:test';
import { emptyFoldState, foldRingEvents, type RingEventLike } from '../ring';
import { DATASET_DAYS, SAMPLE_INTERVAL_MS } from '../types';

// Tests for the normalization contract in docs/bdd/ring-sync-data.feature:
// grid bucketing, hrv window mapping, temp baseline, spo2 policy, movement
// blends, MET calories, bedtime attribution, 30-day trim, clock anchoring and
// zero-event refold stability.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const GOAL_CAL = 500;

function localMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketOf(ms: number): number {
  return Math.floor(ms / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
}

// "Now" is today at 18:00 local — relative offsets keep the tests
// timezone-independent. Whole-second so it can ride a time_sync anchor.
const NOW = localMidnight(Date.now()) + 18 * HOUR;

// Ring-clock anchor: ring decisecond 1_000_000 == NOW wall clock.
const ANCHOR_DS = 1_000_000;

function dsAt(wallMs: number): number {
  return ANCHOR_DS + Math.round((wallMs - NOW) / 100);
}

function timeSync(): RingEventLike {
  return {
    tag: 0x44,
    name: 'time_sync',
    timestamp: ANCHOR_DS,
    decoded: { unix_time: Math.floor(NOW / 1000) },
  };
}

function ev(name: string, wallMs: number, decoded: unknown): RingEventLike {
  return { tag: 0x41, name, timestamp: dsAt(wallMs), decoded };
}

function fold(events: RingEventLike[], prior = emptyFoldState(), nowMs = NOW) {
  return foldRingEvents({ prior, events, goalCal: GOAL_CAL, nowMs });
}

describe('foldRingEvents — clock anchoring', () => {
  it('anchors ring deciseconds to wall clock via time_sync events', () => {
    const at = NOW - 2 * HOUR;
    const r = fold([timeSync(), ev('spo2_event', at, { spo2_percent: [97] })]);
    expect(r.clockAnchor).toBe('time_sync');
    expect(r.state.dataset.series.spo2).toEqual([{ t: bucketOf(at), v: 97 }]);
  });

  it('falls back to "newest event is now" without a time_sync', () => {
    const r = fold([ev('spo2_event', NOW - 5 * MIN, { spo2_percent: [95] })]);
    expect(r.clockAnchor).toBe('newest_event');
    // Newest (only) event maps to nowMs.
    expect(r.state.dataset.series.spo2).toEqual([{ t: bucketOf(NOW), v: 95 }]);
  });

  it('reports anchor "none" for an empty batch', () => {
    const r = fold([]);
    expect(r.clockAnchor).toBe('none');
    expect(r.eventsApplied).toBe(0);
  });
});

describe('foldRingEvents — per-beat heart rate grid bucketing', () => {
  it('averages per-beat bpm into one 3-min bucket, keyed at bucket start', () => {
    const b = bucketOf(NOW - 2 * HOUR);
    const r = fold([
      timeSync(),
      ev('ibi_and_amplitude_event', b + 10_000, { hr_bpm: [60, 90] }),
      ev('green_ibi_quality_event', b + 70_000, { hr_bpm: [80] }),
    ]);
    expect(r.state.dataset.series.hr).toEqual([{ t: b, v: 76.7 }]);
  });

  it('keeps beats in different buckets as separate grid points', () => {
    const b = bucketOf(NOW - 2 * HOUR);
    const r = fold([
      timeSync(),
      ev('ibi_and_amplitude_event', b + 10_000, { hr_bpm: [60] }),
      ev('ibi_and_amplitude_event', b + SAMPLE_INTERVAL_MS + 10_000, { hr_bpm: [90] }),
    ]);
    expect(r.state.dataset.series.hr).toEqual([
      { t: b, v: 60 },
      { t: b + SAMPLE_INTERVAL_MS, v: 90 },
    ]);
  });
});

describe('foldRingEvents — hrv_event windows', () => {
  it('maps each 5-min window to event-time + i×interval on hr and hrv', () => {
    const t0 = NOW - 4 * HOUR;
    const r = fold([
      timeSync(),
      ev('hrv_event', t0, { hr_bpm: [50, 55], rmssd_ms: [40, 60], interval_min: 5 }),
    ]);
    expect(r.state.dataset.series.hr).toEqual([
      { t: bucketOf(t0), v: 50 },
      { t: bucketOf(t0 + 5 * MIN), v: 55 },
    ]);
    expect(r.state.dataset.series.hrv).toEqual([
      { t: bucketOf(t0), v: 40 },
      { t: bucketOf(t0 + 5 * MIN), v: 60 },
    ]);
  });
});

describe('foldRingEvents — temperature baseline and deviation', () => {
  // Night for wake day D (a local midnight): a 23:00 sample on D−1
  // (hour >= 20 → night hours, keyed to D via t + 12 h).
  const nightSample = (wakeDay: number, temps: number[]) =>
    ev('temp_event', wakeDay - HOUR, { temps_c: temps });

  it('filters implausible temps (keeps only 25–40 °C)', () => {
    const wakeDay = localMidnight(NOW) - DAY;
    const r = fold([timeSync(), nightSample(wakeDay, [20, 36, 45])]);
    expect(r.state.tempNights).toEqual([{ dayStart: wakeDay, meanC: 36 }]);
  });

  it('baseline is the median of up to 7 preceding nightly means; 0 until one exists', () => {
    const d1 = localMidnight(NOW) - 2 * DAY;
    const d2 = localMidnight(NOW) - DAY;
    const d3 = localMidnight(NOW);
    const r = fold([
      timeSync(),
      nightSample(d1, [36]),
      nightSample(d2, [37]),
      nightSample(d3, [39]),
      // A daytime sample on d3 so its DaySummary row exists to carry the deviation.
      ev('spo2_event', d3 + 12 * HOUR, { spo2_percent: [97] }),
    ]);
    expect(r.state.tempNights).toEqual([
      { dayStart: d1, meanC: 36 },
      { dayStart: d2, meanC: 37 },
      { dayStart: d3, meanC: 39 },
    ]);
    const temp = r.state.dataset.series.temp;
    const devAt = (wakeDay: number) =>
      temp.find((s) => s.t === bucketOf(wakeDay - HOUR))?.v;
    expect(devAt(d1)).toBe(0); // no baseline yet
    expect(devAt(d2)).toBe(1); // 37 − median([36])
    expect(devAt(d3)).toBe(2.5); // 39 − median([36, 37])
    // DaySummary carries the same deviation.
    const day3 = r.state.dataset.days.find((d) => d.dayStart === d3);
    expect(day3?.tempDeviation).toBe(2.5);
  });

  it('ignores daytime samples (12:00–20:00) for nightly means', () => {
    const wakeDay = localMidnight(NOW) - DAY;
    const r = fold([
      timeSync(),
      nightSample(wakeDay, [36]),
      ev('temp_event', wakeDay - 10 * HOUR, { temps_c: [30] }), // 14:00 prior day
    ]);
    expect(r.state.tempNights).toEqual([{ dayStart: wakeDay, meanC: 36 }]);
  });
});

describe('foldRingEvents — SpO2 is never invented', () => {
  it('ignores raw spo2_r_pi R-ratio events entirely', () => {
    const r = fold([
      timeSync(),
      ev('spo2_r_pi', NOW - HOUR, { r_ratio: [1.1, 1.2], perfusion_index: [3, 4] }),
    ]);
    expect(r.state.dataset.series.spo2).toEqual([]);
  });

  it('accepts summarized spo2_event samples (burst averaged to one grid point)', () => {
    const at = NOW - HOUR;
    const r = fold([timeSync(), ev('spo2_event', at, { spo2_percent: [96, 98, 50] })]);
    expect(r.state.dataset.series.spo2).toEqual([{ t: bucketOf(at), v: 97 }]);
  });
});

describe('foldRingEvents — movement blends and MET calories', () => {
  it('blends motion duty cycle + intensity, MAD/4, and (MET−1)/8 into 0..1', () => {
    const b1 = bucketOf(NOW - 5 * HOUR);
    const b2 = bucketOf(NOW - 4 * HOUR);
    const b3 = bucketOf(NOW - 3 * HOUR);
    const r = fold([
      timeSync(),
      ev('motion_event', b1 + 10_000, { motion_seconds: 31, high_intensity: 63 }),
      ev('sleep_acm_period', b2 + 10_000, { acm_mad: [2, 2] }),
      ev('activity_information', b3, { met: [1, 5, 9] }), // 1-min bins → same bucket
    ]);
    const move = r.state.dataset.series.move;
    expect(move.find((s) => s.t === b1)?.v).toBe(1); // 0.6×31/31 + 0.4×63/63
    expect(move.find((s) => s.t === b2)?.v).toBe(0.5); // MAD 2 / 4
    expect(move.find((s) => s.t === b3)?.v).toBe(0.5); // mean(0, 0.5, 1)
  });

  it('accrues active calories from MET bins ≥ 1.5 and active minutes ≥ 3', () => {
    const at = bucketOf(NOW - 3 * HOUR);
    const r = fold([timeSync(), ev('activity_information', at, { met: [1, 1.4, 5, 9] })]);
    const day = r.state.dataset.days.find((d) => d.dayStart === localMidnight(at));
    // (5−1)×1.225 + (9−1)×1.225 = 4.9 + 9.8 = 14.7 → 15
    expect(day?.activity.activeCal).toBe(15);
    // Active minutes (MET ≥ 3) are kept in the persisted per-day totals.
    expect(r.state.activityByDay[String(localMidnight(at))]?.activeMin).toBe(2);
  });
});

describe('foldRingEvents — bedtime windows', () => {
  it('attributes a plausible window to the wake day', () => {
    const wakeDay = localMidnight(NOW);
    const start = wakeDay - HOUR; // 23:00 prior day
    const end = wakeDay + 7 * HOUR; // 07:00
    const r = fold([
      timeSync(),
      ev('bedtime_period', NOW - 30 * MIN, {
        bedtime_start_ds: dsAt(start),
        bedtime_end_ds: dsAt(end),
      }),
    ]);
    const day = r.state.dataset.days.find((d) => d.dayStart === wakeDay);
    expect(day?.sleep.start).toBe(start);
    expect(day?.sleep.end).toBe(end);
  });

  it('ignores implausible windows (< 1 h or > 16 h)', () => {
    const wakeDay = localMidnight(NOW);
    const start = wakeDay - HOUR;
    const r = fold([
      timeSync(),
      ev('bedtime_period', NOW - 30 * MIN, {
        bedtime_start_ds: dsAt(start),
        bedtime_end_ds: dsAt(start + 30 * MIN), // 30 min — too short
      }),
      ev('bedtime_period', NOW - 20 * MIN, {
        bedtime_start_ds: dsAt(start - 20 * HOUR),
        bedtime_end_ds: dsAt(start), // 20 h — too long
      }),
    ]);
    const day = r.state.dataset.days.find((d) => d.dayStart === wakeDay);
    expect(day == null || day.sleep.start === 0).toBe(true);
  });
});

describe('foldRingEvents — 30-day trim', () => {
  it('drops series, day rows, tempNights and activityByDay older than 30 days', () => {
    const old = NOW - 40 * DAY;
    const r = fold([
      timeSync(),
      ev('spo2_event', old, { spo2_percent: [95] }),
      ev('spo2_event', NOW, { spo2_percent: [97] }),
      ev('temp_event', old + 5 * HOUR, { temps_c: [36] }), // 23:00 → a nightly mean
      ev('activity_information', bucketOf(old), { met: [5] }),
    ]);
    const trimStart = localMidnight(NOW) - (DATASET_DAYS - 1) * DAY;
    for (const series of Object.values(r.state.dataset.series)) {
      for (const s of series) expect(s.t).toBeGreaterThanOrEqual(trimStart);
    }
    expect(r.state.dataset.series.spo2).toEqual([{ t: bucketOf(NOW), v: 97 }]);
    for (const d of r.state.dataset.days) expect(d.dayStart).toBeGreaterThanOrEqual(trimStart);
    for (const n of r.state.tempNights) expect(n.dayStart).toBeGreaterThanOrEqual(trimStart);
    for (const key of Object.keys(r.state.activityByDay)) {
      expect(Number(key)).toBeGreaterThanOrEqual(trimStart);
    }
  });
});

describe('foldRingEvents — refold stability and purity', () => {
  const mixedEvents = (): RingEventLike[] => [
    timeSync(),
    ev('hrv_event', NOW - 8 * HOUR, { hr_bpm: [52, 54], rmssd_ms: [45, 55], interval_min: 5 }),
    ev('temp_event', NOW - 9 * HOUR, { temps_c: [36.2] }),
    ev('spo2_event', NOW - 7 * HOUR, { spo2_percent: [96, 98] }),
    ev('motion_event', NOW - 6 * HOUR, { motion_seconds: 10, high_intensity: 20 }),
    ev('activity_information', bucketOf(NOW - 5 * HOUR), { met: [1, 4, 6] }),
    ev('bedtime_period', NOW - 30 * MIN, {
      bedtime_start_ds: dsAt(localMidnight(NOW) - HOUR),
      bedtime_end_ds: dsAt(localMidnight(NOW) + 7 * HOUR),
    }),
  ];

  it('re-folding with zero new events leaves the dataset unchanged', () => {
    const first = fold(mixedEvents());
    const second = fold([], first.state);
    expect(second.eventsApplied).toBe(0);
    expect(second.state).toEqual(first.state);
  });

  it('does not mutate the prior fold state', () => {
    const first = fold(mixedEvents());
    const snapshot = JSON.parse(JSON.stringify(first.state)) as unknown;
    fold(mixedEvents(), first.state);
    expect(JSON.parse(JSON.stringify(first.state))).toEqual(snapshot);
  });
});
