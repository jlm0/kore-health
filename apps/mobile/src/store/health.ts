import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { RingFoldState, TempNight } from '../data/ring';
import type { DayActivityTotals } from '../data/scores';
import type { Dataset, MetricSample } from '../data/types';
import type { Units } from '../data/units';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'syncing';

// Ring measurement features are not user-toggleable: everything the hardware
// tracks is enabled at pairing and kept on by every sync (see sync.ts).

// The ring's cached latest measurements, read via featureLatest at the end of
// every sync. null = the ring had no current value (e.g. off the finger) —
// never 0. History fills charts; this fills the "right now" readouts.
export interface LatestVitals {
  bpm: number | null;
  spo2Percent: number | null;
}

// Live HR beats arrive per heartbeat while a live stream is active; cap the
// buffer at ~10 minutes of beats. Kept OUT of the persisted store so a beat
// never triggers an AsyncStorage write — persistence happens only when a sync
// completes (or the cursor advances per batch).
const LIVE_HR_CAP = 600;

interface LiveState {
  liveHr: MetricSample[];
  appendLiveHr: (bpm: number) => void;
  clearLiveHr: () => void;
}

export const useLiveStore = create<LiveState>()((set, get) => ({
  liveHr: [],
  appendLiveHr: (bpm) => {
    const next = [...get().liveHr, { t: Date.now(), v: bpm }];
    if (next.length > LIVE_HR_CAP) next.splice(0, next.length - LIVE_HR_CAP);
    set({ liveHr: next });
  },
  clearLiveHr: () => set({ liveHr: [] }),
}));

interface HealthState {
  activityGoalCal: number;
  lastOpenedAt: number | null;
  ringAuthKey: string | null;
  ringDeviceId: string | null;
  /** Advertised name at pairing ("Oura 20380B…") — the stable identity used to
   * re-discover the ring when its BLE address (and peripheral id) rotates. */
  ringDeviceName: string | null;
  /** Display units preference. Store/data stay °C; converted only at display. */
  units: Units;
  /** Synced dataset (days + series). Persisted; written only at sync end. */
  dataset: Dataset | null;
  /** Absolute °C grid points, for re-baselining temp deviations each sync. */
  tempAbsSeries: MetricSample[];
  tempNights: TempNight[];
  activityByDay: Record<string, DayActivityTotals>;
  /** History-drain cursor in ring-clock deciseconds. */
  syncCursor: number;
  lastSyncAt: number | null;
  /** Latest HR/SpO2 from featureLatest at the end of the last sync. */
  latestVitals: LatestVitals | null;
  connectionStatus: ConnectionStatus;
  syncError: string | null;
  setRingAuthKey: (key: string | null) => void;
  setRingDeviceId: (id: string | null) => void;
  setRingDeviceName: (name: string | null) => void;
  setUnits: (units: Units) => void;
  /** Unpair: drop the saved device + auth key and reset the history cursor. */
  forgetRing: () => void;
  /** Fresh start: forget the ring and drop all synced data; keeps display preferences. */
  resetAll: () => void;
  setConnectionStatus: (status: ConnectionStatus, error?: string | null) => void;
  setSyncCursor: (cursorDs: number) => void;
  setLatestVitals: (vitals: LatestVitals) => void;
  /** Single atomic commit of a completed sync fold → one AsyncStorage write. */
  applySyncResult: (result: RingFoldState) => void;
}

export const useHealthStore = create<HealthState>()(
  persist(
    (set) => ({
      activityGoalCal: 500,
      lastOpenedAt: null,
      ringAuthKey: null,
      ringDeviceId: null,
      ringDeviceName: null,
      units: 'imperial',
      dataset: null,
      tempAbsSeries: [],
      tempNights: [],
      activityByDay: {},
      syncCursor: 0,
      lastSyncAt: null,
      latestVitals: null,
      connectionStatus: 'disconnected',
      syncError: null,

      setRingAuthKey: (key) => set({ ringAuthKey: key }),
      setRingDeviceId: (id) => set({ ringDeviceId: id }),
      setRingDeviceName: (name) => set({ ringDeviceName: name }),
      setUnits: (units) => set({ units }),
      forgetRing: () =>
        set({ ringDeviceId: null, ringDeviceName: null, ringAuthKey: null, syncCursor: 0 }),
      resetAll: () =>
        set({
          ringAuthKey: null,
          ringDeviceId: null,
          ringDeviceName: null,
          dataset: null,
          tempAbsSeries: [],
          tempNights: [],
          activityByDay: {},
          syncCursor: 0,
          lastSyncAt: null,
          lastOpenedAt: null,
          latestVitals: null,
          connectionStatus: 'disconnected',
          syncError: null,
        }),
      setConnectionStatus: (status, error = null) =>
        set({ connectionStatus: status, syncError: error }),
      setSyncCursor: (cursorDs) => set({ syncCursor: cursorDs }),
      setLatestVitals: (vitals) => set({ latestVitals: vitals }),
      applySyncResult: (result) =>
        set({
          dataset: result.dataset,
          tempAbsSeries: result.tempAbsSeries,
          tempNights: result.tempNights,
          activityByDay: result.activityByDay,
          lastSyncAt: Date.now(),
          lastOpenedAt: Date.now(),
        }),
    }),
    {
      name: 'kore-health',
      storage: createJSONStorage(() => AsyncStorage),
      // Persisted: the synced dataset + everything needed to resume the fold
      // and the BLE session. Not persisted: connectionStatus/syncError
      // (transient) and the live HR buffer (separate store, see above).
      partialize: (state) => ({
        activityGoalCal: state.activityGoalCal,
        lastOpenedAt: state.lastOpenedAt,
        ringAuthKey: state.ringAuthKey,
        ringDeviceId: state.ringDeviceId,
        ringDeviceName: state.ringDeviceName,
        units: state.units,
        dataset: state.dataset,
        tempAbsSeries: state.tempAbsSeries,
        tempNights: state.tempNights,
        activityByDay: state.activityByDay,
        syncCursor: state.syncCursor,
        lastSyncAt: state.lastSyncAt,
        latestVitals: state.latestVitals,
      }),
    },
  ),
);
