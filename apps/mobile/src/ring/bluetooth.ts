import { BleManager, State } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';
import { BLE_READY_TIMEOUT_MS } from './constants';

// Shared BLE readiness gating: Android runtime permissions plus waiting for
// the adapter to reach PoweredOn before any scan/connect is attempted. Used
// by sync.ts, the pairing screen and the debug console so the "BluetoothLE is
// in Unknown state" first-run failure cannot happen.

export class BluetoothNotReadyError extends Error {}

/**
 * True when the peripheral wiped its bond ("Peer removed pairing
 * information") — the expected state right after a factory reset. iOS usually
 * re-bonds on a plain retry, so callers should retry once before surfacing it.
 */
export function isPairingInfoRemoved(error: unknown): boolean {
  const reason = (error as Record<string, unknown> | null)?.reason;
  return typeof reason === 'string' && /pairing information/i.test(reason);
}

// ble-plx's native layer is a process-wide singleton: destroy() on ANY
// BleManager instance kills the native client for every instance ("BleManager
// was destroyed" on all further calls). Sync/pairing create short-lived
// BleTransports per operation, so the manager must be shared and never
// destroyed mid-session.
let sharedManager: BleManager | null = null;

/** The one BleManager for the app process. */
export function getBleManager(): BleManager {
  if (!sharedManager) sharedManager = new BleManager();
  return sharedManager;
}

/**
 * Android runtime BLE permissions: BLUETOOTH_SCAN/CONNECT on API 31+,
 * ACCESS_FINE_LOCATION below. iOS needs no runtime request — creating the
 * BleManager / querying state triggers the system prompt.
 */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const api =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);
  if (api >= 31) {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(result).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Resolve once Bluetooth is ready for scanning/connecting; reject with a
 * human-readable BluetoothNotReadyError otherwise:
 * - Android permission denied → "Bluetooth permission denied — …"
 * - adapter Unauthorized (iOS denial) → same message
 * - adapter PoweredOff → "Turn on Bluetooth to sync your ring"
 * - adapter Unsupported → "Bluetooth LE is not available on this device"
 * - still not PoweredOn after `timeoutMs` → timeout error
 *
 * Uses the shared process-wide BleManager (getBleManager) — never destroyed,
 * since ble-plx destroy() kills the native layer for every instance.
 */
export async function waitForBluetoothReady(
  timeoutMs = BLE_READY_TIMEOUT_MS,
): Promise<void> {
  if (Platform.OS === 'android' && !(await ensureBlePermissions())) {
    throw new BluetoothNotReadyError(
      'Bluetooth permission denied — enable it in Settings',
    );
  }
  const manager = getBleManager();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.remove();
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new BluetoothNotReadyError(
              'Timed out waiting for Bluetooth — make sure it is on and try again',
            ),
          ),
        ),
      timeoutMs,
    );
    // `true` emits the current state immediately, so a ready adapter
    // resolves synchronously and a PoweredOff/Unauthorized one fails fast.
    const subscription = manager.onStateChange((state) => {
      switch (state) {
        case State.PoweredOn:
          finish(resolve);
          break;
        case State.PoweredOff:
          finish(() =>
            reject(
              new BluetoothNotReadyError('Turn on Bluetooth to sync your ring'),
            ),
          );
          break;
        case State.Unauthorized:
          finish(() =>
            reject(
              new BluetoothNotReadyError(
                'Bluetooth permission denied — enable it in Settings',
              ),
            ),
          );
          break;
        case State.Unsupported:
          finish(() =>
            reject(
              new BluetoothNotReadyError(
                'Bluetooth LE is not available on this device',
              ),
            ),
          );
          break;
        // Unknown / Resetting: keep waiting until PoweredOn or timeout.
      }
    }, true);
  });
}

/** Reject `promise` with `message` if it does not settle within `timeoutMs`. */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Human-readable version of any error, unwrapping ble-plx's BleError, whose
 * `message` is often the useless "Unknown error occurred … Check reason
 * property". Includes the numeric errorCode and the platform `reason` when
 * present so sync/pair logs say what actually failed.
 */
export function describeBleError(error: unknown): string {
  if (error == null) return 'unknown error';
  if (error instanceof BluetoothNotReadyError) return error.message;
  const e = error as Record<string, unknown>;
  const reason = typeof e.reason === 'string' && e.reason.length > 0 ? e.reason : null;
  const code = typeof e.errorCode === 'number' ? `code ${e.errorCode}` : null;
  const message = error instanceof Error ? error.message : String(error);
  const generic = message.includes('Unknown error occurred');
  const parts = [reason ?? (generic ? null : message), code].filter(Boolean);
  if (parts.length === 0) return message;
  return generic ? `${parts.join(' · ')} [${message}]` : parts.join(' · ');
}
