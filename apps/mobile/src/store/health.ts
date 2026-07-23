import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { generateDataset, generateNextSamples } from '../data/generator';
import type { Dataset, SeriesId } from '../data/types';

export const STREAM_INTERVAL_MS = 15_000;

interface HealthState {
  seed: number;
  activityGoalCal: number;
  lastOpenedAt: number | null;
  dataset: Dataset | null;
  streamTick: number;
  ensureDataset: () => Dataset;
  appendLiveSample: () => void;
}

export const useHealthStore = create<HealthState>()(
  persist(
    (set, get) => ({
      seed: Math.floor(Math.random() * 0xffffffff),
      activityGoalCal: 500,
      lastOpenedAt: null,
      dataset: null,
      streamTick: 0,

      ensureDataset: () => {
        const existing = get().dataset;
        if (existing) return existing;
        const dataset = generateDataset(get().seed);
        set({ dataset, lastOpenedAt: Date.now() });
        return dataset;
      },

      appendLiveSample: () => {
        const dataset = get().dataset;
        if (!dataset) return;
        const t = Date.now();
        const next = generateNextSamples(dataset, t);
        const series = { ...dataset.series };
        (Object.keys(next) as SeriesId[]).forEach((k) => {
          series[k] = [...series[k], next[k]];
        });
        set({
          dataset: { ...dataset, series },
          streamTick: get().streamTick + 1,
        });
      },
    }),
    {
      name: 'kore-health',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        seed: state.seed,
        activityGoalCal: state.activityGoalCal,
        lastOpenedAt: state.lastOpenedAt,
      }),
    },
  ),
);
