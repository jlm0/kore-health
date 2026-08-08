import type { Dataset } from './types';

// NOW / TODAY / TREND maturity model (docs/bdd/data-expression.feature).
//
// Every metric group has a maturity state, and every card/screen renders
// according to it:
//   none       → numeric 0 + when it arrives ("Measured during sleep")
//   collecting → NOW + TODAY shown raw; TREND shows what it needs
//   ready      → full derived values
// All display copy lives here, exactly once — screens never invent their own.

export type MetricGroup =
  | 'hr'
  | 'hrv'
  | 'temp'
  | 'spo2'
  | 'sleep'
  | 'activity'
  | 'readiness';

export type MaturityState = 'none' | 'collecting' | 'ready';

export interface MaturityCopy {
  /** Short explanation shown in state 'none' next to the numeric 0. */
  none: string;
  /** What unlocks TREND while it isn't ready. null = no separate trend gate. */
  unlock: string | null;
  /** Full-sentence message for screen-level empty states. */
  empty: string;
}

export interface GroupMaturity {
  /** NOW/TODAY availability. */
  state: MaturityState;
  /** TREND (derived, longitudinal) values available. */
  trendReady: boolean;
  copy: MaturityCopy;
}

export interface MaturityInput {
  dataset: Dataset | null;
  /** Recorded temperature nights (tempNights.length). */
  tempNightCount: number;
  /** Absolute skin-temp grid points (tempAbsSeries.length). */
  tempAbsCount: number;
  /** Ring's cached latest SpO2 from featureLatest, if any. */
  latestSpo2: number | null;
}

export const MATURITY_COPY: Record<MetricGroup, MaturityCopy> = {
  hr: {
    none: 'Appears after your first sync',
    unlock: 'Resting HR after 1 night of sleep',
    empty: 'Heart rate appears after your first ring sync.',
  },
  hrv: {
    none: 'Measured during sleep',
    unlock: 'Measured during sleep',
    empty: 'HRV is measured overnight — wear your ring tonight and sync in the morning.',
  },
  temp: {
    none: 'Appears after your first sync',
    unlock: 'Baseline builds over 2+ nights',
    empty: 'Skin temperature appears after your first ring sync.',
  },
  spo2: {
    none: 'Measured during sleep',
    unlock: "Nightly average after tonight's sleep",
    empty: 'SpO2 readings appear once the ring reports them — never estimated.',
  },
  sleep: {
    none: 'Wear your ring tonight',
    unlock: "Sleep stages appear after tonight's sleep",
    empty: "Sleep stages and score appear after tonight's sleep — wear your ring and sync in the morning.",
  },
  activity: {
    none: 'Appears after your first sync',
    unlock: 'Daily totals build as you wear your ring',
    empty: 'Activity appears after your first daytime sync.',
  },
  readiness: {
    none: 'Wear your ring tonight',
    unlock: null,
    empty: 'Readiness arrives after your first night — wear your ring tonight and sync in the morning.',
  },
};

export function deriveMaturity(group: MetricGroup, input: MaturityInput): GroupMaturity {
  const days = input.dataset?.days ?? [];
  const series = input.dataset?.series;
  const today = days[days.length - 1] ?? null;
  const copy = MATURITY_COPY[group];

  switch (group) {
    case 'hr': {
      // NOW: live/latest bpm backed by real series points. TREND: resting HR
      // is night-derived — needs 1 night.
      const hasPoints = (series?.hr.length ?? 0) > 0;
      return {
        state: hasPoints ? 'ready' : 'none',
        trendReady: days.some((d) => d.restingHr > 0),
        copy,
      };
    }
    case 'hrv': {
      // Night-only measurement — no NOW; TREND is the nightly RMSSD average.
      const hasNight = days.some((d) => d.hrvAvg > 0);
      return { state: hasNight ? 'ready' : 'none', trendReady: hasNight, copy };
    }
    case 'temp': {
      // Absolute readings are real NOW/TODAY data immediately; the deviation
      // TREND needs a personal baseline (2+ recorded nights).
      const state: MaturityState =
        input.tempAbsCount === 0 ? 'none' : input.tempNightCount >= 2 ? 'ready' : 'collecting';
      return { state, trendReady: state === 'ready', copy };
    }
    case 'spo2': {
      // Never invented: only summarized ring events (or the ring's cached
      // latest) count. TREND (nightly average) needs the series itself.
      const hasSeries = (series?.spo2.length ?? 0) > 0;
      const ready = hasSeries || input.latestSpo2 != null;
      return { state: ready ? 'ready' : 'none', trendReady: hasSeries, copy };
    }
    case 'sleep': {
      // TREND only: needs 1 detected sleep window.
      const hasSleep = days.some((d) => d.sleep.durationMin > 0);
      return { state: hasSleep ? 'ready' : 'none', trendReady: hasSleep, copy };
    }
    case 'activity': {
      // TODAY: calories/movement. TREND: daily totals — any real movement or
      // active calories means there is something to total.
      const hasMovement = series?.move.some((s) => s.v > 0) ?? false;
      const hasCalories = days.some((d) => d.activity.activeCal > 0);
      const ready = hasMovement || hasCalories;
      return { state: ready ? 'ready' : 'none', trendReady: ready, copy };
    }
    case 'readiness': {
      // TREND only: composite score is meaningful only with night data. A
      // detected sleep window counts too — a night can yield its sleep window
      // before the HR-derived metrics (HRV/resting HR) land, and the score
      // treats missing signals as neutral contributors.
      const hasNight =
        today != null && (today.hrvAvg > 0 || today.restingHr > 0 || today.sleep.durationMin > 0);
      return { state: hasNight ? 'ready' : 'none', trendReady: hasNight, copy };
    }
  }
}

export function deriveMaturities(input: MaturityInput): Record<MetricGroup, GroupMaturity> {
  return {
    hr: deriveMaturity('hr', input),
    hrv: deriveMaturity('hrv', input),
    temp: deriveMaturity('temp', input),
    spo2: deriveMaturity('spo2', input),
    sleep: deriveMaturity('sleep', input),
    activity: deriveMaturity('activity', input),
    readiness: deriveMaturity('readiness', input),
  };
}
