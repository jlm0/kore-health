import { describe, expect, test } from 'bun:test';
import {
  avgPositive,
  dailySeriesAverages,
  downsample,
  fmtHoursMinutes,
  hasNightData,
  hasTempBaselineForDay,
  hourlyMovement,
  latestPositiveDayValue,
  meanOf,
  normalize,
} from '../selectors';
import type { Dataset, DaySummary } from '../types';

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
