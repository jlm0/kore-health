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
// Quiet window for collecting responses, mirrors DEFAULT_QUIET in client.rs.
export const RESPONSE_QUIET_MS = 1500;
// History-batch fast path: once the batch summary (0x11) has arrived, the
// batch is over — the summary rides with/after the event frames. When the
// summary's eventsReceived count is already satisfied the request resolves
// immediately; otherwise this short settle window covers frames still in
// flight before the next batch is requested (instead of the full quiet wait).
export const BATCH_SETTLE_MS = 400;

// The legacy GetEvent walk can report bytesLeft=0 at a segment boundary while
// newer segments exist (proven: a walk from 0 ended at ring-ts 8.02M with
// events present at 12.86M+). When there is evidence of newer data, the walk
// jumps forward and continues, overlapping by up to one day (deciseconds) for
// continuity — duplicates from the overlap are filtered by event identity.
export const SEGMENT_JUMP_OVERLAP_DS = 864_000;
// Bound on segment jumps per drain so a stale/wrong hint cannot loop forever.
export const MAX_SEGMENT_JUMPS = 50;

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
