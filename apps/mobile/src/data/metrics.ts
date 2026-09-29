import { palette, type IconBadgeName, type IconTint } from '@kore/ui';
import type { DaySummary, SeriesId } from './types';

export type MetricId = 'hrv' | 'rhr' | 'temp' | 'spo2';

export interface MetricConfig {
  id: MetricId;
  title: string;
  unit: string;
  seriesId: SeriesId;
  color: string;
  icon: IconBadgeName;
  tint: IconTint;
  decimals: number;
  signed: boolean;
  dailyValue: (day: DaySummary) => number;
  insight: string;
  rangeLabel: string;
}

export const METRICS: Record<MetricId, MetricConfig> = {
  hrv: {
    id: 'hrv',
    title: 'HRV',
    unit: 'ms',
    seriesId: 'hrv',
    color: palette.mint.base,
    icon: 'heart-pulse',
    tint: 'mint',
    decimals: 0,
    signed: false,
    dailyValue: (d) => d.hrvAvg,
    insight:
      'Heart rate variability reflects how well your nervous system is recovering. Higher overnight averages usually follow restful sleep and light training days.',
    rangeLabel: 'Typical range 40–80 ms',
  },
  rhr: {
    id: 'rhr',
    title: 'Resting HR',
    unit: 'bpm',
    seriesId: 'hr',
    color: palette.indigo.base,
    icon: 'heart',
    tint: 'indigo',
    decimals: 0,
    signed: false,
    dailyValue: (d) => d.restingHr,
    insight:
      'Resting heart rate is measured while you sleep. A downward trend signals improving recovery; late meals, alcohol or stress often push it up.',
    rangeLabel: 'Typical range 46–60 bpm',
  },
  temp: {
    id: 'temp',
    title: 'Body temp',
    unit: '°C',
    seriesId: 'temp',
    color: palette.lavender.base,
    icon: 'thermometer',
    tint: 'lavender',
    decimals: 1,
    signed: true,
    dailyValue: (d) => d.tempDeviation,
    insight:
      'Skin temperature deviation compares each night to your personal baseline. Sustained rises can flag strain, illness or hormonal cycle phases.',
    rangeLabel: 'Baseline ± 0.3 °C',
  },
  spo2: {
    id: 'spo2',
    title: 'SpO2',
    unit: '%',
    seriesId: 'spo2',
    color: palette.indigo.deep,
    icon: 'lungs',
    tint: 'peach',
    decimals: 0,
    signed: false,
    dailyValue: (d) => d.spo2,
    insight:
      'Blood oxygen saturation is sampled throughout the night. Values consistently above 95% are considered healthy at low altitude.',
    rangeLabel: 'Healthy above 95%',
  },
};

export const METRIC_IDS = Object.keys(METRICS) as MetricId[];
