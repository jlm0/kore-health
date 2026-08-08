# @kore/oura-core

React Native native module (built with [Craby](https://craby.rs/)) that wraps the
pure Rust crate `oura-protocol` (vendored at
`third_party/open_oura/crates/oura-protocol`) — the Oura ring BLE wire protocol
and event-body decoders. No I/O, no Bluetooth: raw bytes in, parsed data out.

## Conventions

- Raw bytes cross the bridge as lowercase hex strings.
- Structured results are returned as JSON strings; parsers return `""` when the
  frame does not match the expected shape (and `decodeEvent` returns `""` when
  the event-body layout is unknown).
- All methods are synchronous (every operation is sub-millisecond).
- Invalid input (bad hex, wrong key length, unknown op, bad params JSON) throws
  a JS exception.

## API

```ts
import { OuraCore } from '@kore/oura-core';

// AES-128/ECB/PKCS7-encrypt the ring's auth nonce with the 16-byte app key.
// keyHex must decode to exactly 16 bytes; returns 16 bytes as hex.
OuraCore.encryptNonce(keyHex: string, nonceHex: string): string;

// Parse a raw notification frame -> '{"tag":2f,"payloadHex":"2b"}' or "".
OuraCore.parsePacket(frameHex: string): string;

// Decode a history-event body (payload after the 4-byte timestamp) -> JSON or "".
OuraCore.decodeEvent(tag: number, bodyHex: string): string;

// Event tag -> name, e.g. OuraCore.eventName(0x5d) === 'hrv_event'.
OuraCore.eventName(tag: number): string;

// Parse response frames -> JSON or "".
OuraCore.parseDeviceInfo(frameHex: string): string;   // tag 0x09: api/firmware/bootloader/bt versions + MAC
OuraCore.parseBattery(frameHex: string): string;      // tag 0x0d: percent, chargingProgress, chargingRecommended
OuraCore.parseEventBatch(frameHex: string): string;   // tag 0x11: eventsReceived, sleepAnalysisProgress, bytesLeft

// Parse a product-info response (tag 0x19) -> ASCII string (serial / hardware id / product code) or "".
OuraCore.parseProductAscii(frameHex: string): string;

// Build a protocol request frame -> wire bytes as hex. Throws on unknown op / bad params.
OuraCore.buildRequest(op: string, paramsJson: string): string;
```

## `buildRequest` ops

| op | params (`paramsJson`) | wire request |
| --- | --- | --- |
| `firmware` | — | get firmware/API/bootloader/BT-stack/MAC (`0x08`) |
| `battery` | — | get battery level (`0x0c`) |
| `auth_nonce` | — | request the app-auth nonce (`0x2f` ext `0x2b`) |
| `authenticate` | `{"encryptedHex": "<16 bytes>"}` | authenticate with the encrypted nonce (`0x2f` ext `0x2d`) |
| `set_auth_key` | `{"keyHex": "<16 bytes>"}` | install the 16-byte auth key (`0x24`) |
| `sync_time` | `{"unixSecs": u64, "tzHalfHours": u8}` | set the ring clock (`0x12`) |
| `set_notification` | `{"flags": u8}` | async notification flags (`0x1c`) |
| `capabilities` | `{"page": u8}` | get a capabilities page (`0x2f` ext `0x01`) |
| `product_serial` | — | read the serial-number slot (`0x18`) |
| `product_hardware` | — | read the hardware-id slot (`0x18`) |
| `product_code` | — | read the product-code slot (`0x18`) |
| `get_event` | `{"startDs": u32, "maxEvents": u8, "flags": i32}` | history sync from `startDs` deciseconds; app uses `flags: -1` for all types (`0x10`) |
| `feature_status` | `{"feature": u8}` | feature status (`0x2f` ext `0x20`) |
| `feature_latest` | `{"feature": u8}` | feature latest values (`0x2f` ext `0x24`) |
| `set_feature_mode` | `{"feature": u8, "mode": u8}` | set feature mode (`0x2f` ext `0x22`) |
| `set_feature_subscription` | `{"capability": u8, "mode": u8}` | subscribe a feature capability (`0x2f` ext `0x26`) |
| `check_sleep_analysis` | `{"force": bool}` | ask the ring to run sleep analysis (`0x28`) |
| `set_realtime` | `{"bitmask": u32, "maxDurationMin": u16, "delay": u8}` | start a real-time stream (`0x06`) |
| `realtime_off` | — | stop all real-time measurements (`0x06`, bitmask 0) |

Example — history sync from epoch, 8 events, all types:

```ts
const hex = OuraCore.buildRequest(
  'get_event',
  JSON.stringify({ startDs: 0, maxEvents: 8, flags: -1 }),
);
// -> "10090000000008ffffffff"
```

## Development

```bash
bun install                 # from the monorepo root
bun run codegen             # regenerate bindings after editing src/NativeOuraCore.ts
bun run build               # crabygen build (iOS xcframework + Android static libs) && tsdown
cargo test -p oura_core     # Rust unit tests (in packages/oura-core)
```

`crabygen build` needs the iOS Rust targets (`aarch64-apple-ios`,
`aarch64-apple-ios-sim`, `x86_64-apple-ios`) and, for Android, the
`*-linux-android` targets plus an NDK (`ANDROID_HOME` or `ANDROID_NDK_HOME`).
Run `bun x crabygen doctor` to verify the environment.

The Rust wrapper lives in `crates/lib` and depends on `oura-protocol` by path;
the vendored sources under `third_party/` are read-only.
