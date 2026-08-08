import type { Dataset, DaySummary, MetricSample, SeriesId, SleepSummary } from './types';

export function windowSamples(
  samples: readonly MetricSample[],
  fromMs: number,
  toMs: number,
): MetricSample[] {
  return samples.filter((s) => s.t >= fromMs && s.t <= toMs);
}

export function downsample(values: readonly number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return [...values];
  const bucketSize = values.length / maxPoints;
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let sum = 0;
    for (let j = start; j < end; j++) sum += values[j];
    out.push(sum / (end - start));
  }
  return out;
}

export function seriesWindow(
  dataset: Dataset,
  id: SeriesId,
  hours: number,
  maxPoints = 48,
): number[] {
  const samples = dataset.series[id];
  if (samples.length === 0) return [];
  const to = samples[samples.length - 1].t;
  const from = to - hours * 3600_000;
  return downsample(
    windowSamples(samples, from, to).map((s) => s.v),
    maxPoints,
  );
}

export function hourlyMovement(dataset: Dataset, dayStart: number): number[] {
  const buckets = new Array(24).fill(0);
  const dayEnd = dayStart + 24 * 3600_000;
  for (const s of dataset.series.move) {
    if (s.t < dayStart || s.t >= dayEnd) continue;
    const h = Math.floor((s.t - dayStart) / 3600_000);
    buckets[h] += s.v;
  }
  const max = Math.max(...buckets, 1);
  return buckets.map((b) => b / max);
}

export function normalize(values: readonly number[], floor = 0.08): number[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((v) => floor + ((v - min) / span) * (1 - floor));
}

// Averaging helpers for display: DaySummary fields are 0 when the day had no
// such measurement, and readiness-like scores are neutral-fallback filler on
// dataless days. Averaging those in would fabricate a number, so every helper
// returns null when there is nothing real to average — screens render 0.

/**
 * Bucket a sample series by local calendar day (same localDayStart convention
 * as ring.ts: local midnight) and average each day. Returned ascending by
 * dayStart; days with no samples are simply absent — never averaged as 0.
 */
export function dailySeriesAverages(
  samples: readonly MetricSample[],
): { dayStart: number; avg: number }[] {
  const buckets = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    const d = new Date(s.t);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    const b = buckets.get(key);
    if (b) {
      b.sum += s.v;
      b.n += 1;
    } else {
      buckets.set(key, { sum: s.v, n: 1 });
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayStart, { sum, n }]) => ({ dayStart, avg: sum / n }));
}

/**
 * Most recent real (positive) daily value, scanning days newest-first (days
 * are ascending). Home cards and metric screens both headline a night-backed
 * metric (HRV, resting HR) with this so the two surfaces can never disagree:
 * today's row is 0 until its overnight data lands, but the metric still has a
 * meaningful latest value from a previous night. Null when no day ever
 * produced one — screens render 0.
 */
export function latestPositiveDayValue(
  days: readonly DaySummary[],
  pick: (day: DaySummary) => number,
): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = pick(days[i]);
    if (v > 0) return v;
  }
  return null;
}

/** Rounded mean of the real (positive) values; null when none exist. */
export function avgPositive(values: readonly number[]): number | null {
  const real = values.filter((v) => v > 0);
  return real.length ? Math.round(real.reduce((s, v) => s + v, 0) / real.length) : null;
}

/** Rounded mean over all values; null on empty input (never NaN). */
export function meanOf(values: readonly number[]): number | null {
  return values.length
    ? Math.round(values.reduce((s, v) => s + v, 0) / values.length)
    : null;
}

/** A day is night-backed when HRV, resting HR, or a sleep window was detected
 *  (mirrors the 'readiness' maturity group) — the only days whose score is
 *  real. A sleep window alone counts: a night can yield its window before the
 *  HR-derived metrics land. */
export function hasNightData(
  day: Pick<DaySummary, 'hrvAvg' | 'restingHr'> & { sleep: Pick<SleepSummary, 'durationMin'> },
): boolean {
  return day.hrvAvg > 0 || day.restingHr > 0 || day.sleep.durationMin > 0;
}

/** True when a day's temp deviation is baseline-backed. The deviation series
 *  reports 0 by design until a personal baseline exists (needs a prior
 *  recorded night), so a 0 there is not a real measurement. tempNights must
 *  be sorted by dayStart ascending, as ring.ts materializes them. */
export function hasTempBaselineForDay(
  tempNights: readonly { dayStart: number }[],
  dayStart: number,
): boolean {
  return tempNights.findIndex((n) => n.dayStart === dayStart) >= 1;
}

export function fmtDuration(minutes: number): { h: number; m: number } {
  return { h: Math.floor(minutes / 60), m: Math.round(minutes % 60) };
}

export function fmtHoursMinutes(minutes: number): string {
  const { h, m } = fmtDuration(minutes);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`;
}

export function fmtDate(ms: number, withDay = false): string {
  const d = new Date(ms);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const base = `${months[d.getMonth()]} ${d.getDate()}`;
  return withDay ? `${days[d.getDay()]} · ${base}` : base;
}
