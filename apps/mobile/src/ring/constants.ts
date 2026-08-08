// GATT layout shared by all Oura ring generations. Ring 5 may add extra
// notify characteristics (…0004/0005/0006) in the same service — the
// transport subscribes to every notify/indicate characteristic it finds.
export const OURA_SERVICE_UUID = '98ED0001-A541-11E4-B6A0-0002A5D5C51B';
export const OURA_WRITE_UUID = '98ED0002-A541-11E4-B6A0-0002A5D5C51B';
export const OURA_NOTIFY_UUID = '98ED0003-A541-11E4-B6A0-0002A5D5C51B';

export const RING_NAME_MATCH = 'oura';
export const SCAN_TIMEOUT_MS = 10_000;
// How long to wait for the BLE adapter to reach PoweredOn before failing.
export const BLE_READY_TIMEOUT_MS = 12_000;
// Bound on a single connect attempt (link-up + service discovery).
export const CONNECT_TIMEOUT_MS = 30_000;
// client.rs relies on the host stack's default MTU; ble-plx needs an explicit
// request on Android (iOS auto-negotiates and ignores this).
export const REQUEST_MTU = 185;
// Quiet window for collecting responses. Verified on-device: the simple
// request/response ops (auth nonce + authenticate, featureStatus, feature-
// Latest, syncTime, battery, capabilities, device info, check_sleep_analysis)
// all get their complete answer — one or two frames — within a few hundred
// ms, so 500ms of silence is a safe end-of-response signal (was 1500ms).
// The multi-frame candidates are all covered: capabilities answers one frame
// per page request, device-info/battery/serial one frame each, and get_event
// batches use the even shorter BATCH_QUIET_MS below. The 15s cap stays as
// the backstop for a chattering ring.
export const RESPONSE_QUIET_MS = 500;
// Shorter quiet window for get_event batch requests: the ring pauses
// >1500ms between batches while it waits for the next get_event, so 400ms
// of silence after the last frame is a safe end-of-batch signal — ~1.1s per
// batch faster than the default quiet window. (A previous count-sniffing
// fast finish on the 0x11 summary was removed: when its trigger condition
// missed, no quiet ever happened — the ring kept pace with the immediate
// re-requests — so the 15s cap fired and glued multiple batches into one
// request, corrupting per-batch bookkeeping.)
export const BATCH_QUIET_MS = 400;

// The legacy GetEvent walk can report bytesLeft=0 at a segment boundary while
// newer segments exist (proven: a walk from 0 ended at ring-ts 8.02M with
// events present at 12.86M+, and the ring's history is fragmented into many
// segments separated by sparse unworn gaps). When there is evidence of newer
// data, the walk probes forward from its current position in one-day steps
// (deciseconds) until a probe returns events, then walks normally from there.
// A single fixed jump target provably cannot cross multiple gaps (observed:
// jump to evidence−1day landed in a segment that terminated at a second
// boundary, leaving the next target BEHIND the walk — a stalemate).
export const SEGMENT_PROBE_STEP_DS = 864_000;
// Bound on forward probes per drain so a stale/wrong hint cannot loop forever.
export const MAX_SEGMENT_PROBES = 50;

// History-event frames have tag >= 0x41; batch summaries ride tag 0x11;
// extended ops use outer tag 0x2f with the sub-op as the first payload byte.
export const HISTORY_EVENT_PREFIX = 0x41;
export const EVENT_BATCH_TAG = 0x11;
export const EXT_TAG = 0x2f;

export const FEATURE = {
  DAYTIME_HR: 0x02,
  EXERCISE_HR: 0x03,
  SPO2: 0x04,
  RESTING_HR: 0x08,
} as const;

export const FEATURE_MODE = {
  OFF: 0,
  AUTOMATIC: 1,
  REQUESTED: 2,
  CONNECTED_LIVE: 3,
} as const;
