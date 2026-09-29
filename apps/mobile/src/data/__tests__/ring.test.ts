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
  // Night for wake day D (a local midnight): samples from 23:00 on D−1
  // (hour >= 20 → night hours, keyed to D via t + 12 h). A full night emits
  // `count` events spaced 10 min apart — over the ≥20-sample wear gate.
  const nightEvents = (wakeDay: number, temp: number, count = 20): RingEventLike[] =>
    Array.from({ length: count }, (_, i) =>
      ev('temp_event', wakeDay - HOUR + i * 10 * MIN, { temps_c: [temp] }),
    );

  it('filters implausible probe temps (keeps only 25–40 °C)', () => {
    const wakeDay = localMidnight(NOW) - DAY;
    // Each event averages its probes: [20, 36, 45] → 36 °C.
    const events = Array.from({ length: 20 }, (_, i) =>
      ev('temp_event', wakeDay - HOUR + i * 10 * MIN, { temps_c: [20, 36, 45] }),
    );
    const r = fold([timeSync(), ...events]);
    expect(r.state.tempNights).toEqual([{ dayStart: wakeDay, meanC: 36 }]);
  });

  it('baseline is the median of up to 7 preceding nightly means; 0 until one exists', () => {
    const d1 = localMidnight(NOW) - 2 * DAY;
    const d2 = localMidnight(NOW) - DAY;
    const d3 = localMidnight(NOW);
    const r = fold([
      timeSync(),
      ...nightEvents(d1, 34),
      ...nightEvents(d2, 35),
      ...nightEvents(d3, 36.5),
      // A daytime sample on d3 so its DaySummary row exists to carry the deviation.
      ev('spo2_event', d3 + 12 * HOUR, { spo2_percent: [97] }),
    ]);
    expect(r.state.tempNights).toEqual([
      { dayStart: d1, meanC: 34 },
      { dayStart: d2, meanC: 35 },
      { dayStart: d3, meanC: 36.5 },
    ]);
    const temp = r.state.dataset.series.temp;
    const devAt = (wakeDay: number) =>
      temp.find((s) => s.t === bucketOf(wakeDay - HOUR))?.v;
    expect(devAt(d1)).toBe(0); // no baseline yet
    expect(devAt(d2)).toBe(1); // 35 − median([34])
    expect(devAt(d3)).toBe(2); // 36.5 − median([34, 35])
    // DaySummary carries the same deviation.
    const day3 = r.state.dataset.days.find((d) => d.dayStart === d3);
    expect(day3?.tempDeviation).toBe(2);
  });

  it('ignores daytime samples (12:00–20:00) for nightly means', () => {
    const wakeDay = localMidnight(NOW) - DAY;
    const r = fold([
      timeSync(),
      ...nightEvents(wakeDay, 36),
      ev('temp_event', wakeDay - 10 * HOUR, { temps_c: [30] }), // 14:00 prior day
    ]);
    expect(r.state.tempNights).toEqual([{ dayStart: wakeDay, meanC: 36 }]);
  });
});

describe('foldRingEvents — temperature artifact gating', () => {
  const nightEvents = (wakeDay: number, temp: number, count = 20): RingEventLike[] =>
    Array.from({ length: count }, (_, i) =>
      ev('temp_event', wakeDay - HOUR + i * 10 * MIN, { temps_c: [temp] }),
    );

  it('excludes implausible night means (charging/off-wrist heat) from the baseline', () => {
    // Capture store showed night 1 at 37.8 °C (charging) vs 34–36 °C worn.
    const d1 = localMidnight(NOW) - 2 * DAY;
    const d2 = localMidnight(NOW) - DAY;
    const d3 = localMidnight(NOW);
    const r = fold([
      timeSync(),
      ...nightEvents(d1, 37.8), // charging artifact
      ...nightEvents(d2, 34),
      ...nightEvents(d3, 34.5),
      ev('spo2_event', d3 + 12 * HOUR, { spo2_percent: [97] }),
    ]);
    // The artifact night never enters tempNights, so it can't be a baseline.
    expect(r.state.tempNights).toEqual([
      { dayStart: d2, meanC: 34 },
      { dayStart: d3, meanC: 34.5 },
    ]);
    const temp = r.state.dataset.series.temp;
    const devAt = (wakeDay: number) =>
      temp.find((s) => s.t === bucketOf(wakeDay - HOUR))?.v;
    expect(devAt(d2)).toBe(0); // no baseline yet (d1 gated out)
    expect(devAt(d3)).toBe(0.5); // 34.5 − 34, NOT 34.5 − 37.8
  });

  it('excludes nights with too few overnight samples', () => {
    const wakeDay = localMidnight(NOW) - DAY;
    const r = fold([timeSync(), ...nightEvents(wakeDay, 35, 5)]);
    expect(r.state.tempNights).toEqual([]);
  });

  it('purges a previously persisted artifact night on refold', () => {
    // Simulate a store written before the gating existed (37.8 °C night).
    const artifactDay = localMidnight(NOW) - DAY;
    const prior = emptyFoldState();
    prior.tempNights = [{ dayStart: artifactDay, meanC: 37.8 }];
    const r = fold([], prior);
    expect(r.state.tempNights).toEqual([]);
  });

  it('keeps previously persisted real nights on refold', () => {
    const d1 = localMidnight(NOW) - 2 * DAY;
    const d2 = localMidnight(NOW) - DAY;
    const first = fold([timeSync(), ...nightEvents(d1, 34.3), ...nightEvents(d2, 35.1)]);
    const second = fold([], first.state);
    expect(second.state.tempNights).toEqual(first.state.tempNights);
  });
});

describe('foldRingEvents — SpO2 calibration (cooper quadratic)', () => {
  // Real decoded spo2_r_pi_event payloads from
  // docs/captures/ring-capture-2026-08-08.json (dump.0x8b, cooper ring).
  const REAL_R = [0.673, 0.675, 0.676, 0.677];
  const REAL_PI = [0.05, 0.05, 0.05, 0.05];

  it('converts R-ratios to SpO2 % with the cooper quadratic, clamped [85, 100]', () => {
    // −12.1·r² − 6.9·r + 106.3 at r = 0.732 (capture median) ≈ 94.8.
    const at = NOW - HOUR;
    const r = fold([
      timeSync(),
      ev('spo2_r_pi_event', at, { r: [0.732], perfusion_index: [0.05] }),
    ]);
    expect(r.state.dataset.series.spo2).toEqual([{ t: bucketOf(at), v: 94.8 }]);
  });

  it('converts a real captured burst and averages it into one grid point', () => {
    const at = NOW - HOUR;
    const r = fold([
      timeSync(),
      ev('spo2_r_pi_event', at, { r: REAL_R, perfusion_index: REAL_PI }),
    ]);
    // Per-sample: 96.18, 96.13, 96.10, 96.08 → mean rounds to 96.1.
    expect(r.state.dataset.series.spo2).toEqual([{ t: bucketOf(at), v: 96.1 }]);
    expect(r.eventsApplied).toBe(1); // time_sync anchors but is not "applied"
  });

  it('clamps extreme R-ratios to the [85, 100] output range', () => {
    const b = bucketOf(NOW - HOUR);
    const r = fold([
      timeSync(),
      // Capture range endpoints: r = 0.358 → >100, r = 1.288 → <85.
      ev('spo2_r_pi_event', b + 10_000, { r: [0.358], perfusion_index: [0.05] }),
      ev('spo2_r_pi_event', b + 20_000, { r: [1.288], perfusion_index: [0.05] }),
    ]);
    expect(r.state.dataset.series.spo2).toEqual([{ t: b, v: 92.5 }]); // mean(100, 85)
  });

  it('drops samples with no perfusion or a non-positive r', () => {
    const at = NOW - HOUR;
    const r = fold([
      timeSync(),
      ev('spo2_r_pi_event', at, {
        r: [0.7, 0, 0.8],
        perfusion_index: [0.05, 0.05, 0], // third sample: not perfused
      }),
      ev('spo2_r_pi_event', at + 10_000, { r: [0, 0], perfusion_index: [0, 0] }),
    ]);
    // Only r = 0.7 survives: −12.1·0.49 − 6.9·0.7 + 106.3 = 95.54 → 95.5.
    expect(r.state.dataset.series.spo2).toEqual([{ t: bucketOf(at), v: 95.5 }]);
    expect(r.eventsApplied).toBe(1); // the all-dead burst produces no grid point
  });

  it('fills DaySummary.spo2 from calibrated night values', () => {
    const wakeDay = localMidnight(NOW);
    const start = wakeDay - HOUR; // 23:00 prior day
    const end = wakeDay + 7 * HOUR; // 07:00
    const r = fold([
      timeSync(),
      ev('bedtime_period', NOW - 30 * MIN, {
        bedtime_start_ds: dsAt(start),
        bedtime_end_ds: dsAt(end),
      }),
      ev('spo2_r_pi_event', start + HOUR, { r: [0.732], perfusion_index: [0.05] }),
    ]);
    const day = r.state.dataset.days.find((d) => d.dayStart === wakeDay);
    expect(day?.spo2).toBe(94.8);
  });

  it('still accepts summarized spo2_event samples (burst averaged to one grid point)', () => {
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

describe('foldRingEvents — ring sleep phases (on-ring hypnogram)', () => {
  const wakeDay = () => localMidnight(NOW);
  const winStart = () => wakeDay() - HOUR; // 23:00 prior day
  const winEnd = () => wakeDay() + 7 * HOUR; // 07:00 — an 8 h window

  const bedtime = (): RingEventLike =>
    ev('bedtime_period', NOW - 30 * MIN, {
      bedtime_start_ds: dsAt(winStart()),
      bedtime_end_ds: dsAt(winEnd()),
    });

  // 8 h window = 960 30-s epochs: 4 h light, 1 h deep, 1 h rem, 2 h light.
  const phases = (): string[] => [
    ...Array(480).fill('light'),
    ...Array(120).fill('deep'),
    ...Array(120).fill('rem'),
    ...Array(240).fill('light'),
  ];

  it('anchors a plausible hypnogram to the bedtime window, sourced from the ring', () => {
    const r = fold([
      timeSync(),
      bedtime(),
      ev('sleep_phase_details', winEnd() + 30 * MIN, { header: 0, phases: phases() }),
    ]);
    const day = r.state.dataset.days.find((d) => d.dayStart === wakeDay());
    expect(day?.sleep.stagesSource).toBe('ring');
    expect(day?.sleep.deepMin).toBe(60);
    expect(day?.sleep.remMin).toBe(60);
    expect(day?.sleep.lightMin).toBe(360);
    expect(day?.sleep.stages[0]).toEqual({ stage: 'light', start: winStart(), end: winStart() + 4 * HOUR });
    expect(day?.sleep.stages[3]).toEqual({ stage: 'light', start: winStart() + 6 * HOUR, end: winEnd() });
  });

  it('rejects a hypnogram whose span is implausible for the window', () => {
    const r = fold([
      timeSync(),
      bedtime(),
      // 100 epochs = 50 min against an 8 h window — epoch assumption must be wrong.
      ev('sleep_phase_information', winEnd() + 30 * MIN, { header: 0, phases: Array(100).fill('light') }),
    ]);
    const day = r.state.dataset.days.find((d) => d.dayStart === wakeDay());
    expect(day?.sleep.stagesSource).not.toBe('ring');
  });

  it('drops a hypnogram with no bedtime window to anchor to', () => {
    const r = fold([
      timeSync(),
      ev('sleep_phase_data', winEnd() + 30 * MIN, { header: 0, phases: phases() }),
    ]);
    const day = r.state.dataset.days.find((d) => d.dayStart === wakeDay());
    expect(day == null || day.sleep.stagesSource !== 'ring').toBe(true);
  });

  it('keeps ring staging on a zero-event refold (seeded from persisted days)', () => {
    const first = fold([
      timeSync(),
      bedtime(),
      ev('sleep_phase_details', winEnd() + 30 * MIN, { header: 0, phases: phases() }),
    ]);
    const second = fold([], first.state);
    const day = second.state.dataset.days.find((d) => d.dayStart === wakeDay());
    expect(day?.sleep.stagesSource).toBe('ring');
    expect(day?.sleep.deepMin).toBe(60);
    expect(second.state).toEqual(first.state);
  });
});

describe('foldRingEvents — motion_period', () => {
  it('contributes the mean 2-bit level as a single grid point', () => {
    const at = NOW - 2 * HOUR;
    const r = fold([
      timeSync(),
      ev('motion_period', at, { period_type: 0, low_nibble: 3, motion_levels: [1, 2, 3, 0] }),
    ]);
    // mean(1,2,3,0) = 1.5 → 1.5/3 = 0.5
    expect(r.state.dataset.series.move).toEqual([{ t: bucketOf(at), v: 0.5 }]);
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

describe('foldRingEvents — chunked sync saves', () => {
  it('folding anchored chunks in order matches one fold of the whole drain', () => {
    const early = [
      timeSync(),
      ev('activity_information', bucketOf(NOW - 6 * HOUR), { met: [5, 9] }),
      ev('spo2_event', NOW - 5 * HOUR, { spo2_percent: [96] }),
    ];
    const late = [
      timeSync(),
      ev('activity_information', bucketOf(NOW - 2 * HOUR), { met: [3, 7] }),
      ev('spo2_event', NOW - HOUR, { spo2_percent: [98] }),
    ];
    const whole = fold([...early, ...late]);
    const chunked = fold(late, fold(early).state);
    expect(chunked.state.activityByDay).toEqual(whole.state.activityByDay);
    expect(chunked.state.dataset.series).toEqual(whole.state.dataset.series);
    expect(chunked.state.dataset.days.map((d) => d.activity)).toEqual(
      whole.state.dataset.days.map((d) => d.activity),
    );
  });
});
