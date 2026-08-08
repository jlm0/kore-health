import { BleManager, type Device, type State, type Subscription } from 'react-native-ble-plx';
import { base64ToHex, hexToBase64 } from './bytes';
import { getBleManager } from './bluetooth';
import {
  OURA_SERVICE_UUID,
  OURA_WRITE_UUID,
  REQUEST_MTU,
  RING_NAME_MATCH,
  SCAN_TIMEOUT_MS,
} from './constants';

export interface DiscoveredRing {
  id: string;
  name: string;
  rssi: number | null;
}

export type FrameListener = (frameHex: string) => void;

/**
 * BLE link to a ring, wrapping BleManager. Mirrors BleTransport in
 * third_party/open_oura/crates/oura-link/src/ble.rs: notifications from every
 * notify/indicate characteristic in the Oura service are merged into one
 * frame stream, and each notification is delivered as one complete protocol
 * frame (no reassembly — same as the btleplug pump).
 */
export class BleTransport {
  // Shared process-wide manager — see getBleManager() for why this is never
  // a per-transport instance and never destroyed here.
  private manager: BleManager = getBleManager();
  private device: Device | null = null;
  private subscriptions: Subscription[] = [];
  private listeners = new Set<FrameListener>();

  get deviceId(): string | null {
    return this.device?.id ?? null;
  }

  get isConnected(): boolean {
    return this.device != null;
  }

  // Adapter state (e.g. iOS permission/power status), for debug tooling.
  bluetoothState(): Promise<State> {
    return this.manager.state();
  }

  // Scan for rings advertising the Oura service, filtered by case-insensitive
  // name substring. Strongest signal first — mirrors scan() in ble.rs.
  scanForRing(timeoutMs = SCAN_TIMEOUT_MS): Promise<DiscoveredRing[]> {
    const found = new Map<string, DiscoveredRing>();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.manager.stopDeviceScan();
        resolve(
          [...found.values()].sort((a, b) => (b.rssi ?? -Infinity) - (a.rssi ?? -Infinity)),
        );
      }, timeoutMs);
      this.manager.startDeviceScan([OURA_SERVICE_UUID], null, (error, device) => {
        if (error) {
          clearTimeout(timer);
          this.manager.stopDeviceScan();
          reject(error);
          return;
        }
        const name = device?.name ?? '';
        if (device && name.toLowerCase().includes(RING_NAME_MATCH)) {
          found.set(device.id, { id: device.id, name, rssi: device.rssi });
        }
      });
    });
  }

  // Continuous scan variant for the pairing screen: reports every discovered
  // ring (updated per advertisement) until stopScan() is called. The caller
  // must have waited for the adapter to be PoweredOn (waitForBluetoothReady).
  startScan(onRing: (ring: DiscoveredRing) => void, onError?: (error: unknown) => void): void {
    this.manager.startDeviceScan([OURA_SERVICE_UUID], null, (error, device) => {
      if (error) {
        this.manager.stopDeviceScan();
        onError?.(error);
        return;
      }
      const name = device?.name ?? '';
      if (device && name.toLowerCase().includes(RING_NAME_MATCH)) {
        onRing({ id: device.id, name, rssi: device.rssi });
      }
    });
  }

  stopScan(): void {
    this.manager.stopDeviceScan();
  }

  async connect(deviceId: string): Promise<void> {
    console.log(`[ble] connectToDevice ${deviceId}`);
    const device = await this.manager.connectToDevice(deviceId);
    console.log('[ble] link up, negotiating MTU');
    this.device = device;
    try {
      await device.requestMTU(REQUEST_MTU);
      console.log('[ble] mtu ok');
    } catch {
      // Best effort — iOS auto-negotiates and does not support this call.
    }
    console.log('[ble] discovering services');
    await device.discoverAllServicesAndCharacteristics();
    const characteristics = await device.characteristicsForService(OURA_SERVICE_UUID);
    console.log(`[ble] discovered, ${characteristics.length} characteristics`);
    for (const c of characteristics) {
      if (!c.isNotifiable && !c.isIndicatable) continue;
      this.subscriptions.push(
        device.monitorCharacteristicForService(OURA_SERVICE_UUID, c.uuid, (error, ch) => {
          if (error || !ch?.value) return;
          const frameHex = base64ToHex(ch.value);
          for (const listener of this.listeners) listener(frameHex);
        }),
      );
    }
    console.log(`[ble] subscribed to ${this.subscriptions.length} notify characteristics`);
  }

  // Returns an unsubscribe function.
  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Write with response, mirroring WriteType::WithResponse in ble.rs.
  async writeFrame(frameHex: string): Promise<void> {
    if (!this.device) throw new Error('not connected');
    await this.device.writeCharacteristicWithResponseForService(
      OURA_SERVICE_UUID,
      OURA_WRITE_UUID,
      hexToBase64(frameHex),
    );
  }

  // Abort a pending connectToDevice the caller gave up on (e.g. after a
  // withTimeout): on iOS the OS-level connect keeps running after the JS
  // promise is abandoned, and stacked pending connects wedge CoreBluetooth.
  async cancelPending(deviceId: string): Promise<void> {
    try {
      await this.manager.cancelDeviceConnection(deviceId);
    } catch {
      // Nothing pending / already disconnected.
    }
  }

  async disconnect(): Promise<void> {
    for (const s of this.subscriptions) s.remove();
    this.subscriptions = [];
    const device = this.device;
    this.device = null;
    if (device) {
      try {
        await this.manager.cancelDeviceConnection(device.id);
      } catch {
        // Already disconnected.
      }
    }
  }

  destroy(): void {
    for (const s of this.subscriptions) s.remove();
    this.subscriptions = [];
    this.listeners.clear();
    // Do NOT destroy the shared BleManager — ble-plx destroy() kills the
    // native layer for every instance in the process.
  }
}
