import type { Dataset, MetricSample, SeriesId } from './types';

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
