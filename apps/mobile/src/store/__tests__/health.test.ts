import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { emptyFoldState } from '../../data/ring';

// Tests for the persistence contract in docs/bdd (ring-connection.feature
// "Forget ring returns to new-user state"; ring-sync-data.feature "One atomic
// persist per sync" and "Live data never persists"). AsyncStorage is replaced
// with an in-memory Map — no BLE layer is involved anywhere here.

const storageData = new Map<string, string>();
let setItemCount = 0;

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(storageData.get(key) ?? null),
    setItem: (key: string, value: string) => {
      setItemCount++;
      storageData.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      storageData.delete(key);
      return Promise.resolve();
    },
  },
}));

const { useHealthStore, useLiveStore } = await import('../health');

const STORE_KEY = 'kore-health';

function persistedState(): Record<string, unknown> {
  const raw = storageData.get(STORE_KEY);
  if (!raw) throw new Error('nothing persisted yet');
  return (JSON.parse(raw) as { state: Record<string, unknown> }).state;
}

beforeEach(() => {
  setItemCount = 0;
  useLiveStore.getState().clearLiveHr();
});

describe('useHealthStore — atomic sync persist', () => {
  it('applySyncResult commits the fold with a single AsyncStorage write', () => {
    const result = emptyFoldState();
    useHealthStore.getState().applySyncResult(result);
    expect(setItemCount).toBe(1);
    const s = useHealthStore.getState();
    expect(s.dataset).toEqual(result.dataset);
    expect(s.lastSyncAt).not.toBeNull();
  });

  it('persists only the sync/BLE state — never status, error, or live data', () => {
    useHealthStore.getState().setConnectionStatus('syncing');
    useHealthStore.getState().applySyncResult(emptyFoldState());
    const keys = Object.keys(persistedState()).sort();
    expect(keys).toEqual([
      'activityByDay',
      'activityGoalCal',
      'dataset',
      'featurePrefs',
      'lastOpenedAt',
      'lastSyncAt',
      'latestVitals',
      'ringAuthKey',
      'ringDeviceId',
      'ringDeviceName',
      'syncCursor',
      'tempAbsSeries',
      'tempNights',
      'units',
    ]);
    expect(persistedState().connectionStatus).toBeUndefined();
    expect(persistedState().syncError).toBeUndefined();
    expect(persistedState().liveHr).toBeUndefined();
  });

  it('setSyncCursor persists cursor progress per batch', () => {
    useHealthStore.getState().setSyncCursor(123456);
    expect(setItemCount).toBe(1);
    expect(persistedState().syncCursor).toBe(123456);
  });

  it('setLatestVitals persists the latest readings (nulls stay null, never 0)', () => {
    useHealthStore.getState().setLatestVitals({ bpm: 58, spo2Percent: null });
    expect(persistedState().latestVitals).toEqual({ bpm: 58, spo2Percent: null });
  });
});

describe('useHealthStore — forgetRing', () => {
  it('clears device id, auth key and sync cursor (new-user state)', () => {
    useHealthStore.getState().setRingDeviceId('DEVICE-1');
    useHealthStore.getState().setRingAuthKey('deadbeef');
    useHealthStore.getState().setSyncCursor(999);
    useHealthStore.getState().forgetRing();
    const s = useHealthStore.getState();
    expect(s.ringDeviceId).toBeNull();
    expect(s.ringAuthKey).toBeNull();
    expect(s.syncCursor).toBe(0);
    const p = persistedState();
    expect(p.ringDeviceId).toBeNull();
    expect(p.ringAuthKey).toBeNull();
    expect(p.syncCursor).toBe(0);
  });
});

describe('useLiveStore — live HR never persists', () => {
  it('appends and clears beats without any AsyncStorage write', () => {
    useLiveStore.getState().appendLiveHr(62);
    useLiveStore.getState().appendLiveHr(64);
    expect(useLiveStore.getState().liveHr).toHaveLength(2);
    expect(setItemCount).toBe(0);
    useLiveStore.getState().clearLiveHr();
    expect(useLiveStore.getState().liveHr).toHaveLength(0);
    expect(setItemCount).toBe(0);
  });

  it('caps the buffer at 600 beats (~10 min)', () => {
    for (let i = 0; i < 650; i++) useLiveStore.getState().appendLiveHr(60 + (i % 20));
    const hr = useLiveStore.getState().liveHr;
    expect(hr).toHaveLength(600);
    expect(hr[hr.length - 1].v).toBe(60 + (649 % 20));
    expect(setItemCount).toBe(0);
    useLiveStore.getState().clearLiveHr();
  });
});
