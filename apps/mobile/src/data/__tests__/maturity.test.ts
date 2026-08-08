import { describe, expect, test } from 'bun:test';
import { deriveMaturity, deriveMaturities, MATURITY_COPY } from '../maturity';
import type { MaturityInput } from '../maturity';
import type { Dataset, DaySummary } from '../types';

function day(overrides: Partial<DaySummary> = {}): DaySummary {
  return {
    date: '2026-07-25',
    dayStart: 0,
    readiness: 0,
    sleepScore: 0,
    activityScore: 0,
    contributors: {
      hrvBalance: 0.5,
      bodyTemp: 0.5,
      sleep: 0.5,
      restingHr: 0.5,
      recovery: 0.5,
      activityBalance: 0.5,
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
    hrvAvg: 0,
    restingHr: 0,
    tempDeviation: 0,
    spo2: 0,
    ...overrides,
  };
}

function dataset(days: DaySummary[], series: Partial<Dataset['series']> = {}): Dataset {
  return {
    days,
    series: { hr: [], hrv: [], temp: [], spo2: [], move: [], ...series },
  };
}

const EMPTY: MaturityInput = {
  dataset: null,
  tempNightCount: 0,
  tempAbsCount: 0,
  latestSpo2: null,
};

describe('deriveMaturity — fresh install (no data)', () => {
  test('every group is none', () => {
    const all = deriveMaturities(EMPTY);
    for (const m of Object.values(all)) {
      expect(m.state).toBe('none');
      expect(m.trendReady).toBe(false);
    }
  });

  test('copy is defined for every group and state', () => {
    expect(MATURITY_COPY.hrv.none).toBe('Measured during sleep');
    expect(MATURITY_COPY.temp.unlock).toBe('Baseline builds over 2+ nights');
    expect(MATURITY_COPY.readiness.none).toBe('Wear your ring tonight');
    for (const c of Object.values(MATURITY_COPY)) {
      expect(c.empty.length).toBeGreaterThan(0);
    }
  });
});

describe('deriveMaturity — hr', () => {
  test('none without series points', () => {
    const m = deriveMaturity('hr', { ...EMPTY, dataset: dataset([day()]) });
    expect(m.state).toBe('none');
    expect(m.trendReady).toBe(false);
  });

  test('ready with points; trend waits for a night-derived resting HR', () => {
    const input = { ...EMPTY, dataset: dataset([day()], { hr: [{ t: 1, v: 62 }] }) };
    const m = deriveMaturity('hr', input);
    expect(m.state).toBe('ready');
    expect(m.trendReady).toBe(false);
    expect(m.copy.unlock).toBe('Resting HR after 1 night of sleep');
  });

  test('trend ready once any day has restingHr > 0', () => {
    const input = {
      ...EMPTY,
      dataset: dataset([day({ restingHr: 54 })], { hr: [{ t: 1, v: 62 }] }),
    };
    expect(deriveMaturity('hr', input).trendReady).toBe(true);
  });
});

describe('deriveMaturity — hrv', () => {
  test('none until a night has hrvAvg > 0', () => {
    const input = { ...EMPTY, dataset: dataset([day()]) };
    const m = deriveMaturity('hrv', input);
    expect(m.state).toBe('none');
    expect(m.copy.none).toBe('Measured during sleep');
  });

  test('ready with a nightly average', () => {
    const input = { ...EMPTY, dataset: dataset([day({ hrvAvg: 48 })]) };
    const m = deriveMaturity('hrv', input);
    expect(m.state).toBe('ready');
    expect(m.trendReady).toBe(true);
  });
});

describe('deriveMaturity — temp', () => {
  test('none with no absolute points', () => {
    expect(deriveMaturity('temp', EMPTY).state).toBe('none');
  });

  test('collecting with absolute points but fewer than 2 nights', () => {
    const m = deriveMaturity('temp', { ...EMPTY, tempAbsCount: 12, tempNightCount: 1 });
    expect(m.state).toBe('collecting');
    expect(m.trendReady).toBe(false);
    expect(m.copy.unlock).toBe('Baseline builds over 2+ nights');
  });

  test('ready at 2+ nights', () => {
    const m = deriveMaturity('temp', { ...EMPTY, tempAbsCount: 12, tempNightCount: 2 });
    expect(m.state).toBe('ready');
    expect(m.trendReady).toBe(true);
  });
});

describe('deriveMaturity — spo2', () => {
  test('none with no series and no cached latest', () => {
    const input = { ...EMPTY, dataset: dataset([day()]) };
    expect(deriveMaturity('spo2', input).state).toBe('none');
  });

  test('ready from the ring cached latest even without series points', () => {
    const m = deriveMaturity('spo2', { ...EMPTY, latestSpo2: 97 });
    expect(m.state).toBe('ready');
    expect(m.trendReady).toBe(false);
  });

  test('trend ready only from real series points', () => {
    const input = { ...EMPTY, dataset: dataset([day()], { spo2: [{ t: 1, v: 96 }] }) };
    const m = deriveMaturity('spo2', input);
    expect(m.state).toBe('ready');
    expect(m.trendReady).toBe(true);
  });
});

describe('deriveMaturity — sleep', () => {
  test('none until a detected sleep window', () => {
    const input = { ...EMPTY, dataset: dataset([day()]) };
    expect(deriveMaturity('sleep', input).state).toBe('none');
  });

  test('ready with sleep.durationMin > 0', () => {
    const d = day();
    d.sleep.durationMin = 420;
    const input = { ...EMPTY, dataset: dataset([d]) };
    const m = deriveMaturity('sleep', input);
    expect(m.state).toBe('ready');
    expect(m.trendReady).toBe(true);
  });
});

describe('deriveMaturity — activity', () => {
  test('none without movement or calories', () => {
    const input = { ...EMPTY, dataset: dataset([day()]) };
    expect(deriveMaturity('activity', input).state).toBe('none');
  });

  test('ready from movement samples', () => {
    const input = { ...EMPTY, dataset: dataset([day()], { move: [{ t: 1, v: 0.4 }] }) };
    expect(deriveMaturity('activity', input).state).toBe('ready');
  });

  test('ready from active calories', () => {
    const d = day();
    d.activity.activeCal = 120;
    const input = { ...EMPTY, dataset: dataset([d]) };
    expect(deriveMaturity('activity', input).state).toBe('ready');
  });
});

describe('deriveMaturity — readiness', () => {
  test('none without night data on the latest day', () => {
    const input = { ...EMPTY, dataset: dataset([day({ hrvAvg: 50 }), day()]) };
    expect(deriveMaturity('readiness', input).state).toBe('none');
  });

  test('ready when the latest day has hrvAvg or restingHr', () => {
    const a = { ...EMPTY, dataset: dataset([day({ hrvAvg: 50 })]) };
    expect(deriveMaturity('readiness', a).state).toBe('ready');
    const b = { ...EMPTY, dataset: dataset([day({ restingHr: 55 })]) };
    expect(deriveMaturity('readiness', b).state).toBe('ready');
  });

  test('ready when the latest day has a sleep window but no HR metrics yet', () => {
    const d = day();
    d.sleep.durationMin = 420;
    const input = { ...EMPTY, dataset: dataset([d]) };
    const m = deriveMaturity('readiness', input);
    expect(m.state).toBe('ready');
    expect(m.trendReady).toBe(true);
  });

  test('none copy says to wear the ring tonight', () => {
    const m = deriveMaturity('readiness', EMPTY);
    expect(m.copy.none).toBe('Wear your ring tonight');
  });
});
