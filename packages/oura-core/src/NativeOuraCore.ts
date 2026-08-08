import type { NativeModule } from 'craby-modules';
import { NativeModuleRegistry } from 'craby-modules';

/**
 * OuraCore — byte-oriented bridge over the pure Rust `oura-protocol` crate.
 *
 * Conventions: raw bytes cross the bridge as lowercase hex strings; structured
 * results are returned as JSON strings (or "" when the frame does not parse).
 * All methods are synchronous — every operation is sub-millisecond.
 */
interface Spec extends NativeModule {
  /**
   * AES-128/ECB/PKCS7-encrypt a ring nonce with the 16-byte app-auth key.
   * `keyHex` must decode to exactly 16 bytes. Returns 16 bytes as hex.
   */
  encryptNonce(keyHex: string, nonceHex: string): string;

  /**
   * Parse a raw notification frame. Returns
   * `{"tag": number, "payloadHex": string}`, or "" when too short.
   */
  parsePacket(frameHex: string): string;

  /**
   * Decode a history-event body (payload after the 4-byte timestamp).
   * Returns the decoded JSON, or "" when the layout is unknown.
   */
  decodeEvent(tag: number, bodyHex: string): string;

  /** Map an event tag to its name (e.g. 0x5d -> "hrv_event"). */
  eventName(tag: number): string;

  /**
   * Parse a firmware/device-info response frame (tag 0x09).
   * Returns JSON `DeviceInfo`, or "" when the frame does not match.
   */
  parseDeviceInfo(frameHex: string): string;

  /**
   * Parse a battery response frame (tag 0x0d).
   * Returns JSON `Battery`, or "" when the frame does not match.
   */
  parseBattery(frameHex: string): string;

  /**
   * Parse a product-info response frame (tag 0x19).
   * Returns the ASCII string (serial / hardware id / product code), or "".
   */
  parseProductAscii(frameHex: string): string;

  /**
   * Parse an event-batch summary frame (tag 0x11). Returns JSON
   * `{"eventsReceived": n, "sleepAnalysisProgress": n, "bytesLeft": n}`, or "".
   */
  parseEventBatch(frameHex: string): string;

  /**
   * Build a protocol request frame. `op` selects the request builder,
   * `paramsJson` carries the arguments (see README for the op table).
   * Returns the wire bytes as hex. Throws on unknown op or bad params.
   */
  buildRequest(op: string, paramsJson: string): string;
}

export default NativeModuleRegistry.getEnforcing<Spec>('OuraCore');
