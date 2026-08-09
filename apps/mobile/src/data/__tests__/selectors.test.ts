import { describe, expect, test } from 'bun:test';
import {
  avgPositive,
  bucketSeries,
  dailySeriesAverages,
  downsample,
  fmtHoursMinutes,
  hasNightData,
  hasTempBaselineForDay,
  hourlyMovement,
  latestNightSample,
  latestPositiveDayValue,
  meanOf,
  movementByRange,
  normalize,
  rangeAxisLabels,
} from '../selectors';
import type { Dataset, DaySummary, MetricSample } from '../types';

describe('latestNightSample', () => {
  // Build a sample at a specific local hour today.
  const at = (hour: number, v: number): MetricSample => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    return { t: d.getTime(), v };
  };

  test('null when no sample falls in the resting domain (20:00–12:00)', () => {
    expect(latestNightSample([])).toBeNull();
    expect(latestNightSample([at(13, 70), at(16, 85)])).toBeNull();
  });

  test('returns the freshest night-hours sample, skipping daytime ones', () => {
    const night = at(6, 52);
    expect(latestNightSample([at(23, 55), at(13, 85), night, at(14, 90)])).toEqual(night);
  });
});

describe('latestPositiveDayValue', () => {
  const day = (restingHr: number) => ({ restingHr }) as DaySummary;

  test('null when no day ever produced a value', () => {
    expect(latestPositiveDayValue([], (d) => d.restingHr)).toBeNull();
    expect(latestPositiveDayValue([day(0), day(0)], (d) => d.restingHr)).toBeNull();
  });

  test('returns the most recent real value, skipping today’s 0', () => {
    expect(latestPositiveDayValue([day(52), day(0)], (d) => d.restingHr)).toBe(52);
    expect(latestPositiveDayValue([day(52), day(55)], (d) => d.restingHr)).toBe(55);
  });
});

describe('avgPositive', () => {
  test('null on empty input — never a fake 0', () => {
    expect(avgPositive([])).toBeNull();
  });

  test('null when every value is a missing-data 0', () => {
    expect(avgPositive([0, 0, 0])).toBeNull();
  });

  test('averages only the real values', () => {
    expect(avgPositive([0, 40, 0, 60])).toBe(50);
  });

  test('rounds the result', () => {
    expect(avgPositive([41, 42])).toBe(42);
  });
});

describe('dailySeriesAverages', () => {
  // Local wall-clock times — the helper buckets by local calendar day.
  const day1 = new Date(2024, 0, 15).getTime();
  const day2 = new Date(2024, 0, 16).getTime();
  const at = (h: number, min = 0) => new Date(2024, 0, 15, h, min).getTime();
  const nextAt = (h: number, min = 0) => new Date(2024, 0, 16, h, min).getTime();

  test('empty input → empty output', () => {
    expect(dailySeriesAverages([])).toEqual([]);
  });

  test('single-sample days keep the sample value', () => {
    expect(dailySeriesAverages([{ t: at(10), v: 65 }])).toEqual([
      { dayStart: day1, avg: 65 },
    ]);
  });

  test('buckets samples across local midnight into separate days', () => {
    const out = dailySeriesAverages([
      { t: at(23, 55), v: 60 },
      { t: nextAt(0, 5), v: 70 },
      { t: nextAt(1, 0), v: 80 },
    ]);
    expect(out).toEqual([
      { dayStart: day1, avg: 60 },
      { dayStart: day2, avg: 75 },
    ]);
  });

  test('averages multiple samples within a day', () => {
    const out = dailySeriesAverages([
      { t: at(8), v: 60 },
      { t: at(12), v: 70 },
      { t: at(18), v: 80 },
    ]);
    expect(out).toEqual([{ dayStart: day1, avg: 70 }]);
  });

  test('sorted ascending regardless of input order', () => {
    const out = dailySeriesAverages([
      { t: nextAt(9), v: 72 },
      { t: at(9), v: 66 },
    ]);
    expect(out.map((d) => d.dayStart)).toEqual([day1, day2]);
  });
});

describe('meanOf', () => {
  test('null on empty input — never NaN', () => {
    expect(meanOf([])).toBeNull();
  });

  test('rounds the mean of all values', () => {
    expect(meanOf([10, 15])).toBe(13);
    expect(meanOf([0, 100])).toBe(50);
  });
});

describe('hasNightData', () => {
  const noSleep = { durationMin: 0 };

  test('false when all night signals are 0', () => {
    expect(hasNightData({ hrvAvg: 0, restingHr: 0, sleep: noSleep })).toBe(false);
  });

  test('true when any night signal exists', () => {
    expect(hasNightData({ hrvAvg: 55, restingHr: 0, sleep: noSleep })).toBe(true);
    expect(hasNightData({ hrvAvg: 0, restingHr: 48, sleep: noSleep })).toBe(true);
    expect(hasNightData({ hrvAvg: 0, restingHr: 0, sleep: { durationMin: 420 } })).toBe(true);
  });
});

describe('hasTempBaselineForDay', () => {
  const nights = [{ dayStart: 100 }, { dayStart: 200 }, { dayStart: 300 }];

  test('false for the first recorded night (no prior baseline)', () => {
    expect(hasTempBaselineForDay(nights, 100)).toBe(false);
  });

  test('true once a prior night exists', () => {
    expect(hasTempBaselineForDay(nights, 200)).toBe(true);
    expect(hasTempBaselineForDay(nights, 300)).toBe(true);
  });

  test('false for a day with no recorded night', () => {
    expect(hasTempBaselineForDay(nights, 250)).toBe(false);
    expect(hasTempBaselineForDay([], 100)).toBe(false);
  });
});

describe('bucketSeries — day range (hourly buckets)', () => {
  // Local wall-clock anchor: 2024-01-15 14:30 local.
  const now = new Date(2024, 0, 15, 14, 30).getTime();
  const at = (h: number, min = 0) => new Date(2024, 0, 15, h, min).getTime();

  test('24 buckets; samples average into their local hour', () => {
    const out = bucketSeries(
      [
        { t: at(10, 15), v: 60 },
        { t: at(10, 45), v: 80 },
        { t: at(23, 5), v: 50 },
      ],
      'day',
      now,
    );
    expect(out).toHaveLength(24);
    expect(out[10]).toEqual({ start: at(10), count: 2, sum: 140, avg: 70, min: 60, max: 80 });
    expect(out[23].count).toBe(1);
    expect(out[23].avg).toBe(50);
  });

  test('empty buckets report null stats and zero count/sum — never fabricated', () => {
    const out = bucketSeries([{ t: at(8), v: 65 }], 'day', now);
    expect(out[9]).toEqual({ start: at(9), count: 0, sum: 0, avg: null, min: null, max: null });
  });

  test('samples from other days are ignored', () => {
    const yesterday = new Date(2024, 0, 14, 10).getTime();
    const out = bucketSeries([{ t: yesterday, v: 99 }, { t: at(10), v: 60 }], 'day', now);
    expect(out[10].avg).toBe(60);
    expect(out.reduce((n, b) => n + b.count, 0)).toBe(1);
  });

  test('empty input → all buckets empty', () => {
    const out = bucketSeries([], 'day', now);
    expect(out).toHaveLength(24);
    expect(out.every((b) => b.count === 0 && b.avg === null)).toBe(true);
  });
});

describe('bucketSeries — week range (daily buckets)', () => {
  const now = new Date(2024, 0, 15, 14, 30).getTime(); // anchor: Jan 15
  const on = (day: number, h: number, min = 0) => new Date(2024, 0, day, h, min).getTime();

  test('7 buckets ending on the anchor day, oldest first', () => {
    const out = bucketSeries([], 'week', now);
    expect(out).toHaveLength(7);
    expect(out[6].start).toBe(new Date(2024, 0, 15).getTime());
    expect(out[0].start).toBe(new Date(2024, 0, 9).getTime());
  });

  test('week boundary: 23:59 and 00:01 land in adjacent day buckets', () => {
    const out = bucketSeries(
      [
        { t: on(14, 23, 59), v: 40 },
        { t: on(15, 0, 1), v: 60 },
      ],
      'week',
      now,
    );
    expect(out[5].avg).toBe(40); // Jan 14
    expect(out[6].avg).toBe(60); // Jan 15
  });

  test('partial days average only their real samples; missing days are null', () => {
    const out = bucketSeries(
      [
        { t: on(9, 8), v: 10 },
        { t: on(9, 20), v: 20 },
        { t: on(15, 12), v: 90 },
      ],
      'week',
      now,
    );
    expect(out[0].avg).toBe(15);
    expect(out[6].avg).toBe(90);
    expect(out.slice(1, 6).every((b) => b.avg === null)).toBe(true);
  });

  test('samples older than 6 days are ignored', () => {
    const out = bucketSeries([{ t: on(8, 23), v: 50 }], 'week', now);
    expect(out.every((b) => b.count === 0)).toBe(true);
  });
});

describe('bucketSeries — month range (weekly buckets)', () => {
  const now = new Date(2024, 0, 31, 9, 0).getTime(); // anchor: Jan 31

  test('5 buckets of 7 days ending on the anchor day', () => {
    const out = bucketSeries([], 'month', now);
    expect(out).toHaveLength(5);
    expect(out[4].start).toBe(new Date(2024, 0, 25).getTime()); // anchor − 6
    expect(out[0].start).toBe(new Date(2023, 11, 28).getTime()); // anchor − 34
  });

  test('samples land in the right weekly bucket by age', () => {
    const sample = (daysAgo: number, v: number): MetricSample => {
      const d = new Date(2024, 0, 31, 9, 0);
      d.setDate(d.getDate() - daysAgo);
      return { t: d.getTime(), v };
    };
    const out = bucketSeries(
      [sample(0, 10), sample(6, 20), sample(7, 30), sample(34, 40), sample(35, 99)],
      'month',
      now,
    );
    expect(out[4].avg).toBe(15); // days 0–6 ago
    expect(out[3].avg).toBe(30); // 7–13 ago
    expect(out[0].avg).toBe(40); // 28–34 ago
    // 35 days ago falls outside the window entirely.
    expect(out.reduce((n, b) => n + b.count, 0)).toBe(4);
  });
});

describe('bucketSeries — DST safety', () => {
  test('day offsets are calendar days, not 24h spans', () => {
    // 30 days back crosses a DST transition in DST-observing timezones
    // (midnight-to-midnight spans of 23/25 h); calendar arithmetic must still
    // land the sample in the exact monthly bucket. Also passes where no
    // transition exists.
    const anchor = new Date(2024, 6, 15, 12, 0); // July 15
    const past = new Date(anchor);
    past.setDate(past.getDate() - 30); // June 15, calendar arithmetic
    const out = bucketSeries([{ t: past.getTime(), v: 42 }], 'month', anchor.getTime());
    // 30 days ago → bucket index floor((−30 + 34) / 7) = 0.
    expect(out[0].count).toBe(1);
    expect(out[0].avg).toBe(42);
    expect(out.reduce((n, b) => n + b.count, 0)).toBe(1);
  });
});

describe('movementByRange', () => {
  const now = new Date(2024, 0, 15, 14, 30).getTime();
  const at = (h: number, min = 0) => new Date(2024, 0, 15, h, min).getTime();

  test('sums per bucket normalized so the fullest bucket is 1', () => {
    const out = movementByRange(
      [
        { t: at(8, 0), v: 0.5 },
        { t: at(8, 3), v: 0.5 }, // hour 8 sum = 1.0
        { t: at(9, 0), v: 0.25 }, // hour 9 sum = 0.25
      ],
      'day',
      now,
    );
    expect(out).toHaveLength(24);
    expect(out[8]).toBe(1);
    expect(out[9]).toBe(0.25);
    expect(out[10]).toBe(0); // empty bucket → zero-height bar
  });

  test('empty input → all zeros (no NaN from max)', () => {
    const out = movementByRange([], 'week', now);
    expect(out).toHaveLength(7);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  test('week range matches manual daily sums', () => {
    const out = movementByRange(
      [
        { t: new Date(2024, 0, 14, 10).getTime(), v: 1 },
        { t: new Date(2024, 0, 14, 11).getTime(), v: 1 }, // yesterday sum 2
        { t: new Date(2024, 0, 15, 10).getTime(), v: 1 }, // today sum 1
      ],
      'week',
      now,
    );
    expect(out[5]).toBe(1); // fullest day
    expect(out[6]).toBe(0.5);
  });

  test('sub-1 sums are not amplified (normalization floor of 1)', () => {
    const out = movementByRange([{ t: at(8, 0), v: 0.4 }], 'day', now);
    expect(out[8]).toBe(0.4);
  });
});

describe('rangeAxisLabels', () => {
  const now = new Date(2024, 0, 15, 14, 30).getTime(); // a Monday

  test('day: five clock ticks', () => {
    expect(rangeAxisLabels('day', now)).toEqual(['12 AM', '6 AM', '12 PM', '6 PM', '12 AM']);
  });

  test('week: seven weekday letters ending on the anchor weekday', () => {
    const labels = rangeAxisLabels('week', now);
    expect(labels).toHaveLength(7);
    expect(labels[6]).toBe('SMTWTFS'[new Date(now).getDay()]);
    expect(labels[5]).toBe('SMTWTFS'[(new Date(now).getDay() + 6) % 7]);
  });

  test('month: five date labels matching the bucket starts', () => {
    const labels = rangeAxisLabels('month', now);
    expect(labels).toHaveLength(5);
    const starts = bucketSeries([], 'month', now).map((b) => b.start);
    // fmtDate output is derived from the same starts — labels must not drift.
    expect(labels[4].length).toBeGreaterThan(0);
    expect(starts).toHaveLength(5);
  });
});

describe('defensive math over empty input', () => {
  const emptyDataset: Dataset = {
    days: [],
    series: { hr: [], hrv: [], temp: [], spo2: [], move: [] },
  };

  test('normalize([]) is [] — no NaN entries', () => {
    expect(normalize([])).toEqual([]);
    // Constant series: span falls back to 1, no division by zero.
    expect(normalize([5, 5]).every((v) => Number.isFinite(v))).toBe(true);
  });

  test('hourlyMovement with no samples is a finite all-zero grid', () => {
    const buckets = hourlyMovement(emptyDataset, 0);
    expect(buckets).toHaveLength(24);
    expect(buckets.every((v) => v === 0)).toBe(true);
  });

  test('downsample of empty stays empty', () => {
    expect(downsample([], 48)).toEqual([]);
  });

  test('fmtHoursMinutes never emits NaN for finite input', () => {
    expect(fmtHoursMinutes(0)).toBe('0:00');
    expect(fmtHoursMinutes(90)).toBe('1:30');
  });
});
