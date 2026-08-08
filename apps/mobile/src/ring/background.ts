import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useHealthStore } from '../store/health';
import { syncRing } from './sync';

// Periodic background sync: the system wakes the app on its own cadence
// (iOS BGTaskScheduler / Android WorkManager — minimumInterval is a hint, not
// a schedule) and this task runs syncRing() headless. BLE works in this
// context because the process is fully booted; no UI is involved.

export const RING_SYNC_TASK = 'kore-ring-background-sync';

TaskManager.defineTask(RING_SYNC_TASK, async () => {
  try {
    // A headless boot starts with an empty store — rehydrate persisted state
    // (ring id, key, cursor) from AsyncStorage before deciding anything.
    await useHealthStore.persist.rehydrate();
    const { ringDeviceId } = useHealthStore.getState();
    if (!ringDeviceId) return BackgroundTask.BackgroundTaskResult.Success;
    console.log('[sync] background task firing');
    await syncRing();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    console.log(
      `[sync] background task failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Register the periodic task (~hourly hint; the OS picks real times). */
export async function registerBackgroundSync(): Promise<void> {
  try {
    await BackgroundTask.registerTaskAsync(RING_SYNC_TASK, { minimumInterval: 60 });
  } catch (error) {
    console.log(
      `[sync] background task registration failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
