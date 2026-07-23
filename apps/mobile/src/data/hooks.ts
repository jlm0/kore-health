import { useEffect, useMemo } from 'react';
import { STREAM_INTERVAL_MS, useHealthStore } from '../store/health';
import { seriesWindow } from './selectors';
import type { Dataset, DaySummary, SeriesId } from './types';

export function useDataset(): Dataset {
  const dataset = useHealthStore((s) => s.dataset);
  const ensureDataset = useHealthStore((s) => s.ensureDataset);
  return dataset ?? ensureDataset();
}

export function useToday(): DaySummary {
  const dataset = useDataset();
  return dataset.days[dataset.days.length - 1];
}

export function useDays(): DaySummary[] {
  return useDataset().days;
}

export function useSeriesWindow(id: SeriesId, hours: number, maxPoints = 48): number[] {
  const dataset = useDataset();
  const streamTick = useHealthStore((s) => s.streamTick);
  return useMemo(
    () => seriesWindow(dataset, id, hours, maxPoints),
    [dataset, id, hours, maxPoints, streamTick],
  );
}

export function useLatestSample(id: SeriesId): number {
  const dataset = useDataset();
  const streamTick = useHealthStore((s) => s.streamTick);
  return useMemo(() => {
    const samples = dataset.series[id];
    return samples[samples.length - 1]?.v ?? 0;
  }, [dataset, id, streamTick]);
}

export function useLiveStream(): void {
  const appendLiveSample = useHealthStore((s) => s.appendLiveSample);
  useEffect(() => {
    const interval = setInterval(appendLiveSample, STREAM_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [appendLiveSample]);
}
