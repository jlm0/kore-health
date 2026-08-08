import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { useHealthStore } from '../store/health';
import { syncRing } from './sync';

// Periodic background sync: the system wakes the app on its own cadence
// (iOS BGTaskScheduler / Android WorkManager — minimumInterval is a hint, not
// a schedule) and this task runs syncRing() headless. BLE works in this
// context because the process is fully booted; no UI is involved.
//
// iOS caveat: this app's Info.plist declares UIBackgroundModes = fetch,
// processing — NOT bluetooth-central — so CoreBluetooth will not service a
// connect while the app is backgrounded. Attempting a full BLE sync from a
// headless wake would burn the OS's ~30s task window on a connect that can
// never deliver. Until the entitlement is added (and the flag below flipped),
// the task fails fast with a clear log line instead.

// Flip to true when ios/Kore/Info.plist gains the bluetooth-central
// UIBackgroundModes entry.
const HAS_BACKGROUND_BLE = false;
// Hard wall-clock budget for a background sync once BLE is entitled — the OS
// window is short; better to abandon (the next foreground sync resumes from
// the persisted cursor) than to be killed mid-write.
const BACKGROUND_SYNC_BUDGET_MS = 25_000;

export const RING_SYNC_TASK = 'kore-ring-background-sync';

TaskManager.defineTask(RING_SYNC_TASK, async () => {
  try {
    // A headless boot starts with an empty store — rehydrate persisted state
    // (ring id, key, cursor) from AsyncStorage before deciding anything.
    await useHealthStore.persist.rehydrate();
    const { ringDeviceId } = useHealthStore.getState();
    if (!ringDeviceId) return BackgroundTask.BackgroundTaskResult.Success;
    if (!HAS_BACKGROUND_BLE) {
      console.log(
        '[sync] background sync skipped: no bluetooth-central background mode in Info.plist',
      );
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    console.log('[sync] background task firing');
    // syncRing never throws (it reports via the store), so the race only
    // bounds how long we hold the OS window open — a sync still running when
    // the budget closes keeps its per-batch cursor progress.
    await Promise.race([
      syncRing(),
      new Promise<void>((resolve) =>
        setTimeout(() => {
          console.log(`[sync] background budget (${BACKGROUND_SYNC_BUDGET_MS}ms) exhausted`);
          resolve();
        }, BACKGROUND_SYNC_BUDGET_MS),
      ),
    ]);
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
    if (!HAS_BACKGROUND_BLE) {
      console.log('[sync] background task registered (will no-op: no background BLE entitlement)');
    }
  } catch (error) {
    console.log(
      `[sync] background task registration failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
