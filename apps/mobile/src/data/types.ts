export type SeriesId = 'hr' | 'hrv' | 'temp' | 'spo2' | 'move';

export interface MetricSample {
  t: number;
  v: number;
}

export type SleepStage = 'deep' | 'rem' | 'light' | 'awake';

export interface SleepStageSegment {
  stage: SleepStage;
  start: number;
  end: number;
}

export interface SleepSummary {
  start: number;
  end: number;
  durationMin: number;
  efficiency: number;
  latencyMin: number;
  stages: SleepStageSegment[];
  deepMin: number;
  remMin: number;
  lightMin: number;
  awakeMin: number;
  lowestHr: number;
  peakHrv: number;
  /**
   * Where `stages` came from: 'ring' = the ring's own hypnogram (sleep_phase_*
   * events), 'local' = the app's actigraphy heuristic. Absent on nights with
   * no staging data (and on data persisted before this field existed).
   */
  stagesSource?: 'ring' | 'local';
}

export interface ActivitySummary {
  steps: number;
  activeCal: number;
  goalCal: number;
  kmEquiv: number;
  inactiveMin: number;
}

export interface ReadinessContributors {
  hrvBalance: number;
  bodyTemp: number;
  sleep: number;
  restingHr: number;
  recovery: number;
  activityBalance: number;
}

export interface DaySummary {
  date: string;
  dayStart: number;
  readiness: number;
  sleepScore: number;
  activityScore: number;
  contributors: ReadinessContributors;
  sleep: SleepSummary;
  activity: ActivitySummary;
  hrvAvg: number;
  restingHr: number;
  tempDeviation: number;
  spo2: number;
}

export interface Dataset {
  days: DaySummary[];
  series: Record<SeriesId, MetricSample[]>;
}

export const SAMPLE_INTERVAL_MS = 3 * 60 * 1000;
export const DATASET_DAYS = 30;
