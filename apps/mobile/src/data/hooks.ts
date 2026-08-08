import { useMemo } from 'react';
import { useHealthStore, useLiveStore } from '../store/health';
import { deriveMaturities, type GroupMaturity, type MetricGroup } from './maturity';
import { emptyDataset } from './ring';
import { downsample, seriesWindow, windowSamples } from './selectors';
import type { Dataset, DaySummary, MetricSample, SeriesId } from './types';
import type { Units } from './units';

const EMPTY_DATASET = emptyDataset();

/** Persisted display-units preference ('imperial' default). */
export function useUnits(): Units {
  return useHealthStore((s) => s.units);
}

export function useDataset(): Dataset {
  return useHealthStore((s) => s.dataset) ?? EMPTY_DATASET;
}

/** The most recent day with data, or null before the first sync. */
export function useToday(): DaySummary | null {
  const dataset = useDataset();
  return dataset.days[dataset.days.length - 1] ?? null;
}

export function useDays(): DaySummary[] {
  return useDataset().days;
}

export function useSeriesWindow(id: SeriesId, hours: number, maxPoints = 48): number[] {
  const dataset = useDataset();
  const liveHr = useLiveStore((s) => s.liveHr);
  return useMemo(() => {
    if (id === 'hr' && liveHr.length > 0) {
      const merged: Dataset = {
        ...dataset,
        series: { ...dataset.series, hr: [...dataset.series.hr, ...liveHr] },
      };
      return seriesWindow(merged, id, hours, maxPoints);
    }
    return seriesWindow(dataset, id, hours, maxPoints);
  }, [dataset, id, hours, maxPoints, liveHr]);
}

// "Current" value for a series, freshest source first: an active live HR
// stream, then the ring's cached latest vitals from the last sync, then the
// newest synced sample. null = no current value (never a fake 0).
export function useLatestSample(id: SeriesId): number | null {
  const dataset = useDataset();
  const liveHr = useLiveStore((s) => s.liveHr);
  const latestVitals = useHealthStore((s) => s.latestVitals);
  return useMemo(() => {
    if (id === 'hr' && liveHr.length > 0) return liveHr[liveHr.length - 1].v;
    if (id === 'hr' && latestVitals?.bpm != null) return latestVitals.bpm;
    if (id === 'spo2' && latestVitals?.spo2Percent != null) return latestVitals.spo2Percent;
    const samples = dataset.series[id];
    return samples[samples.length - 1]?.v ?? null;
  }, [dataset, id, liveHr, latestVitals]);
}

/**
 * Temperature in "absolute mode": until a personal baseline exists (needs 2+
 * recorded nights), the deviation series is all zeros by design and useless to
 * display. These hooks expose the raw absolute skin-temp readings instead.
 */
export function useHasTempBaseline(): boolean {
  return useHealthStore((s) => s.tempNights.length >= 2);
}

/** NOW/TODAY/TREND maturity for every metric group (see data/maturity.ts). */
export function useMaturities(): Record<MetricGroup, GroupMaturity> {
  const dataset = useDataset();
  const tempNightCount = useHealthStore((s) => s.tempNights.length);
  const tempAbsCount = useHealthStore((s) => s.tempAbsSeries.length);
  const latestSpo2 = useHealthStore((s) => s.latestVitals?.spo2Percent ?? null);
  return useMemo(
    () => deriveMaturities({ dataset, tempNightCount, tempAbsCount, latestSpo2 }),
    [dataset, tempNightCount, tempAbsCount, latestSpo2],
  );
}

export function useTempAbsSeries(): MetricSample[] {
  return useHealthStore((s) => s.tempAbsSeries);
}

/** Absolute-mode current value + 24h window for the temp screens. */
export function useTempAbsWindow(hours: number, maxPoints = 56): {
  latest: number | null;
  window: number[];
} {
  const tempAbs = useTempAbsSeries();
  return useMemo(() => {
    if (tempAbs.length === 0) return { latest: null, window: [] };
    const to = tempAbs[tempAbs.length - 1].t;
    return {
      latest: tempAbs[tempAbs.length - 1].v,
      window: downsample(
        windowSamples(tempAbs, to - hours * 3600_000, to).map((s) => s.v),
        maxPoints,
      ),
    };
  }, [tempAbs, hours, maxPoints]);
}
