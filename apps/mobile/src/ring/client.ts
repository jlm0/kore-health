import { OuraCore } from '@kore/oura-core';
import { hexToBytes, randomKeyHex } from './bytes';
import {
  BATCH_QUIET_MS,
  EVENT_BATCH_TAG,
  EXT_TAG,
  FEATURE,
  FEATURE_MODE,
  HISTORY_EVENT_PREFIX,
  MAX_SEGMENT_PROBES,
  RESPONSE_QUIET_MS,
  SEGMENT_PROBE_STEP_DS,
} from './constants';
import type { BleTransport } from './transport';

// JSON shapes returned by the OuraCore bridge (see packages/oura-core).
export interface DeviceInfo {
  api_version: string;
  firmware_version: string;
  bootloader_version: string;
  bt_stack_version: string;
  mac: string;
}

export interface Battery {
  percent: number;
  charging_progress: number;
  charging_recommended: number;
}

export interface Capability {
  feature: number;
  value: number;
}

export interface FeatureStatus {
  feature: number;
  mode: number;
  status: number;
  state: number;
  subscription: number;
}

export interface LatestValues {
  bpm: number | null;
  spo2Percent: number | null;
}

export interface RingEvent {
  tag: number;
  name: string;
  /** Envelope timestamp (deciseconds), as reported by the ring. */
  timestamp: number;
  bodyHex: string;
  /** Best-effort structured decode, when the body format is known. */
  decoded: unknown;
}

export interface SyncOutcome {
  eventsSynced: number;
  nextCursor: number;
  /** Batch requests issued, including empty probes. */
  batches: number;
  /**
   * sleepAnalysisProgress (0–100) from the last batch summary seen during
   * the drain; null when no summary arrived. Tells the caller whether the
   * ring was still generating sleep events when the drain ended.
   */
  sleepAnalysisProgress: number | null;
}

export interface DrainOptions {
  /**
   * Evidence that history extends at least to this ring-clock decisecond —
   * e.g. the persisted cursor when rebuilding from 0. The ring's legacy
   * GetEvent walk stops with bytesLeft=0 at segment boundaries while newer
   * segments exist (proven on a live ring: a walk from 0 ended at ts 8.02M
   * with events present at 12.86M+). When the walk terminates with its end
   * still below the evidence, the drain probes forward in one-day steps
   * (never past the evidence) until it finds the next segment and resumes.
   */
  expectEndAtLeast?: number;
  /** Checked before each batch request; true ends the walk at the last completed batch. */
  shouldStop?: () => boolean;
}

export interface HeartRateSample {
  bpm: number;
  ibiMs: number;
}

export interface AuthResult {
  code: number;
  name: string;
  success: boolean;
}

// Mirrors AuthResult::from in auth.rs.
const AUTH_RESULT_NAME: Record<number, string> = {
  0: 'success',
  1: 'authentication_error',
  2: 'in_factory_reset',
  3: 'not_original_onboarded_device',
};

interface RingPacket {
  frameHex: string;
  tag: number;
  payloadHex: string;
}

function toPackets(frameHexes: string[]): RingPacket[] {
  const packets: RingPacket[] = [];
  for (const frameHex of frameHexes) {
    const json = OuraCore.parsePacket(frameHex);
    if (!json) continue;
    const { tag, payloadHex } = JSON.parse(json) as { tag: number; payloadHex: string };
    packets.push({ frameHex, tag, payloadHex });
  }
  return packets;
}

// Extended ops ride outer tag 0x2f with the sub-op as the first payload byte.
function extTag(p: RingPacket): number | null {
  return p.tag === EXT_TAG && p.payloadHex.length >= 2
    ? parseInt(p.payloadHex.slice(0, 2), 16)
    : null;
}

function payloadByte(p: RingPacket, i: number): number | undefined {
  return p.payloadHex.length >= (i + 1) * 2
    ? parseInt(p.payloadHex.slice(i * 2, i * 2 + 2), 16)
    : undefined;
}

function payloadTailHex(p: RingPacket, from: number): string {
  return p.payloadHex.slice(from * 2);
}

function hexByte(n: number): string {
  return `0x${n.toString(16).padStart(2, '0')}`;
}

// Compute bpm from an inter-beat interval, ignoring implausible values.
function bpmFromIbi(ibiMs: number): number | null {
  return ibiMs >= 300 && ibiMs <= 2000 ? Math.floor(60000 / ibiMs) : null;
}

// Build an event from a history-event packet — mirrors RingEvent::from_packet.
function ringEventFromPacket(p: RingPacket): RingEvent {
  const bytes = hexToBytes(p.payloadHex);
  const timestamp =
    bytes.length >= 4
      ? (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0
      : 0;
  const bodyHex = bytes.length > 4 ? p.payloadHex.slice(8) : '';
  const decodedJson = OuraCore.decodeEvent(p.tag, bodyHex);
  return {
    tag: p.tag,
    name: OuraCore.eventName(p.tag),
    timestamp,
    bodyHex,
    decoded: decodedJson ? JSON.parse(decodedJson) : null,
  };
}

// Daytime-HR live subscription notification (tag 0x2f, sub-tag 0x28), ported
// from parse_live_hr_frame in client.rs:
// [0]=0x2f [1]=len [2]=0x28 [3]=feature [4]=status [5]=state [6..8]=timeSince
// [8..10]=IBI — 12-bit interval (ms) plus a 4-bit validity nibble (1 = VALID).
function parseLiveHrFrame(frameHex: string): HeartRateSample | null {
  const f = hexToBytes(frameHex);
  if (f.length < 10 || f[0] !== EXT_TAG || f[2] !== 0x28) return null;
  if (f[3] !== FEATURE.DAYTIME_HR) return null;
  const ibiMs = ((f[9] & 0x0f) << 8) | f[8];
  const validity = (f[9] >> 4) & 0x0f;
  if (validity !== 1) return null;
  const bpm = bpmFromIbi(ibiMs);
  return bpm == null ? null : { bpm, ibiMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * High-level ring client, mirroring OuraClient in
 * third_party/open_oura/crates/oura-link/src/client.rs. All wire
 * encoding/decoding goes through the OuraCore native module.
 */
export class OuraRingClient {
  // Highest event timestamp seen on this connection across all drains —
  // evidence of newer data for the multi-segment walk (see drainEvents).
  private maxEventTsSeen = 0;
  // Drain sequence number, so interleaved [sync] batch lines from log
  // streams are attributable to a specific drain and batch.
  private drainSeq = 0;

  constructor(
    private transport: BleTransport,
    private quietMs = RESPONSE_QUIET_MS,
    private batchQuietMs = BATCH_QUIET_MS,
  ) {}

  private build(op: string, params: Record<string, unknown> = {}): string {
    return OuraCore.buildRequest(op, JSON.stringify(params));
  }

  // Write one request and collect notification frames until the link has been
  // quiet for `quietMs` — mirrors transact() in transport.rs. Subscribing
  // per-request means there is no stale backlog to drain. A continuously
  // chattering ring (e.g. a leftover live stream) would keep the quiet timer
  // re-arming forever, so a hard cap resolves with whatever has arrived.
  //
  // get_event batch requests pass the shorter BATCH_QUIET_MS via `quietMs`:
  // the ring pauses >1500ms between batches waiting for the next get_event,
  // so 400ms of silence is a safe end-of-batch signal. There is deliberately
  // NO frame-content fast finish — a summary/count-sniffing early resolve
  // provably misfires (missed trigger → no quiet ever → cap fires → glued
  // batches; late frames bleed into the next batch's window). The quiet
  // window and the 15s cap are the only completion mechanisms.
  private request(
    requestHex: string,
    maxWaitMs = 15_000,
    quietMs = this.quietMs,
  ): Promise<RingPacket[]> {
    return new Promise<RingPacket[]>((resolve, reject) => {
      const frames: string[] = [];
      let timer: ReturnType<typeof setTimeout>;
      const finish = (reason: string) => {
        clearTimeout(timer);
        clearTimeout(capTimer);
        unsubscribe();
        const packets = toPackets(frames);
        if (__DEV__) {
          const tags = new Map<number, number>();
          for (const p of packets) tags.set(p.tag, (tags.get(p.tag) ?? 0) + 1);
          const hist = [...tags.entries()]
            .map(([t, c]) => `0x${t.toString(16)}×${c}`)
            .join(' ');
          console.log(
            `[ble] request resolved (${reason}): ${frames.length} frames ${hist || '∅'}`,
          );
        }
        resolve(packets);
      };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => finish('quiet'), quietMs);
      };
      const capTimer = setTimeout(() => finish('cap'), maxWaitMs);
      const unsubscribe = this.transport.subscribe((frameHex) => {
        frames.push(frameHex);
        arm();
      });
      arm();
      this.transport.writeFrame(requestHex).catch((error) => {
        clearTimeout(timer);
        clearTimeout(capTimer);
        unsubscribe();
        reject(error);
      });
    });
  }

  // --- device info -------------------------------------------------------

  async firmware(): Promise<DeviceInfo> {
    const packets = await this.request(this.build('firmware'));
    const p = packets.find((p) => p.tag === 0x09);
    const json = p ? OuraCore.parseDeviceInfo(p.frameHex) : '';
    if (!json) throw new Error('no firmware response');
    return JSON.parse(json) as DeviceInfo;
  }

  async battery(): Promise<Battery> {
    const packets = await this.request(this.build('battery'));
    const p = packets.find((p) => p.tag === 0x0d);
    const json = p ? OuraCore.parseBattery(p.frameHex) : '';
    if (!json) throw new Error('no battery response (auth required?)');
    return JSON.parse(json) as Battery;
  }

  private async productAscii(op: string, what: string): Promise<string> {
    const packets = await this.request(this.build(op));
    const p = packets.find((p) => p.tag === 0x19);
    const value = p ? OuraCore.parseProductAscii(p.frameHex) : '';
    if (!value) throw new Error(`no ${what} response`);
    return value;
  }

  serial(): Promise<string> {
    return this.productAscii('product_serial', 'serial');
  }

  hardwareId(): Promise<string> {
    return this.productAscii('product_hardware', 'hardware');
  }

  // Read both capability pages. The (feature, value) pair split mirrors
  // device::parse_capabilities, which the OuraCore bridge does not expose.
  async capabilities(): Promise<Capability[]> {
    const caps: Capability[] = [];
    for (let page = 0; page < 2; page++) {
      const packets = await this.request(this.build('capabilities', { page }));
      const p = packets.find((p) => extTag(p) === 0x02);
      if (!p) continue;
      // payload: [0]=ext 0x02, [1]=page count, then (feature, value) pairs.
      const bytes = hexToBytes(payloadTailHex(p, 2));
      for (let i = 0; i + 1 < bytes.length; i += 2) {
        caps.push({ feature: bytes[i], value: bytes[i + 1] });
      }
    }
    return caps;
  }

  // --- auth & session ----------------------------------------------------

  // App-auth challenge; must be repeated per connection on rings that have a
  // key installed. Nonce response: ext 0x2c; auth result: ext 0x2e.
  async authenticate(keyHex: string): Promise<AuthResult> {
    const noncePackets = await this.request(this.build('auth_nonce'));
    const noncePacket = noncePackets.find((p) => extTag(p) === 0x2c);
    const nonceHex = noncePacket ? payloadTailHex(noncePacket, 1) : '';
    if (!nonceHex) throw new Error('no nonce response');

    const encryptedHex = OuraCore.encryptNonce(keyHex, nonceHex);
    const authPackets = await this.request(this.build('authenticate', { encryptedHex }));
    const resultPacket = authPackets.find((p) => extTag(p) === 0x2e);
    const state = resultPacket ? payloadByte(resultPacket, 1) : undefined;
    if (state === undefined) throw new Error('no authenticate response');
    return {
      code: state,
      name: AUTH_RESULT_NAME[state] ?? `unknown_${state}`,
      success: state === 0,
    };
  }

  // Install a fresh 16-byte auth key — only valid on a factory-reset ring.
  // Returns the key hex; the caller must persist it.
  // Race recovery: if the install response is lost (e.g. an OS bonding dialog
  // blocked traffic) or refused, the ring may STILL have applied the key —
  // verify by authenticating with it before giving up, otherwise the ring is
  // left holding a key nobody knows (forcing a factory reset).
  async pair(): Promise<string> {
    const keyHex = randomKeyHex();
    try {
      const packets = await this.request(this.build('set_auth_key', { keyHex }));
      const p = packets.find((p) => p.tag === 0x25);
      const status = p ? payloadByte(p, 0) : undefined;
      if (status === undefined) throw new Error('no set_auth_key response');
      if (status !== 0) throw new Error(`set_auth_key status ${hexByte(status)}`);
      return keyHex;
    } catch (installError) {
      console.log(`[ble] set_auth_key failed (${installError}); verifying via auth`);
      try {
        const result = await this.authenticate(keyHex);
        if (result.success) {
          console.log('[ble] ring had already applied the key — recovered');
          return keyHex;
        }
      } catch {
        // Fall through to the original error.
      }
      throw installError;
    }
  }

  // Align the ring clock to host time.
  async syncTime(): Promise<void> {
    const unixSecs = Math.floor(Date.now() / 1000);
    // Half-hours east of UTC (getTimezoneOffset is minutes *west* of UTC).
    const tzHalfHours = Math.round(-new Date().getTimezoneOffset() / 30);
    await this.request(this.build('sync_time', { unixSecs, tzHalfHours }));
  }

  // Ask the ring to run its sleep analysis (0x28, response tag 0x29). Without
  // this, bedtime_period / sleep events never enter the history stream — the
  // official app triggers it on open; we trigger it before every drain.
  async checkSleepAnalysis(force = false): Promise<void> {
    await this.request(this.build('check_sleep_analysis', { force }));
  }

  // Enable the async notification flags so the ring pushes events.
  async setNotification(flags: number): Promise<void> {
    await this.request(this.build('set_notification', { flags }));
  }

  // --- history events ----------------------------------------------------

  // Resumable history sync, mirroring drain_events in client.rs: request
  // batches of up to 255 events of all types (flags -1) starting at `cursor`
  // deciseconds, fire onEvent per history frame, advance the cursor past the
  // newest timestamp of each fully-drained batch (onBatch fires so callers can
  // persist incrementally), and stop when the ring reports no bytes left or a
  // batch makes no progress.
  //
  // Two hardening layers on top of the legacy walk, both proven against a
  // live ring (see docs/captures/ring-capture-2026-08-08.json):
  //
  // - Multi-segment: the walk can report bytesLeft=0 at a segment boundary
  //   while newer segments exist, and history is fragmented into MANY
  //   segments (sparse unworn gaps between them). When there is evidence of
  //   newer data (the caller's expectEndAtLeast hint, or a higher event ts
  //   already seen on this connection), the drain probes forward from its
  //   current position in one-day steps — never past the evidence — until a
  //   probe returns events, then walks normally from there. (A single fixed
  //   jump target cannot cross multiple gaps: observed live, a jump to
  //   evidence−1day terminated at a second boundary and the next target
  //   computed behind the walk — a stalemate.)
  // - Dedupe: overlapping segments replay events; each event is delivered to
  //   onEvent at most once per drain, keyed by (tag, timestamp, bodyHex).
  //
  // nextCursor only ever reflects positions backed by delivered events: a
  // probe moves the walk's start speculatively, but the committed cursor
  // advances only when a batch makes progress — an empty probe must not
  // strand real data below a speculative cursor.
  async drainEvents(
    cursor: number,
    onEvent: (event: RingEvent) => void,
    onBatch?: (nextCursor: number) => void,
    options?: DrainOptions,
  ): Promise<SyncOutcome> {
    let start = cursor;
    let committed = cursor;
    let total = 0;
    let probes = 0;
    let batches = 0;
    let sleepProgress: number | null = null;
    const drainId = ++this.drainSeq;
    const seen = new Set<string>();
    const emit = (event: RingEvent): void => {
      this.maxEventTsSeen = Math.max(this.maxEventTsSeen, event.timestamp);
      const key = `${event.tag}:${event.timestamp}:${event.bodyHex}`;
      if (seen.has(key)) return;
      seen.add(key);
      total++;
      onEvent(event);
    };
    // Safety bound against a misbehaving ring that never reports drained.
    for (let i = 0; i < 100_000; i++) {
      if (options?.shouldStop?.()) break;
      const t0 = Date.now();
      batches++;
      const packets = await this.request(
        this.build('get_event', { startDs: start, maxEvents: 255, flags: -1 }),
        15_000,
        this.batchQuietMs,
      );

      let bytesLeft = 0;
      let summaries = 0;
      let maxTs = start;
      let batchEvents = 0;
      for (const p of packets) {
        if (p.tag === EVENT_BATCH_TAG) {
          summaries++;
          // When the 15s cap glues multiple batches into one request, several
          // summaries arrive — the LAST one's bytesLeft describes the ring's
          // state after the final glued batch. All event frames are still
          // processed; the summaries= count in the log makes tangling
          // visible.
          const json = OuraCore.parseEventBatch(p.frameHex);
          if (json) {
            const summary = JSON.parse(json) as {
              bytesLeft: number;
              sleepAnalysisProgress?: number;
            };
            bytesLeft = summary.bytesLeft;
            sleepProgress = summary.sleepAnalysisProgress ?? sleepProgress;
          }
        } else if (p.tag >= HISTORY_EVENT_PREFIX) {
          const event = ringEventFromPacket(p);
          maxTs = Math.max(maxTs, event.timestamp);
          batchEvents++;
          emit(event);
        }
      }
      // One-line backlog estimate from the first batch: how much history the
      // ring reported pending when this drain started (multi-day backlog
      // visibility after a return-from-days away).
      if (i === 0 && summaries > 0) {
        console.log(`[sync] backlog estimate: ~${bytesLeft} bytes of ring history after first batch`);
      }

      // Advance the cursor past the newest event seen.
      const next = maxTs + 1;
      const progressed = batchEvents > 0 && next > start;
      console.log(
        `[sync] batch d${drainId}#${i}: start=${start} events=${batchEvents} summaries=${summaries} bytesLeft=${bytesLeft} maxTs=${maxTs} progressed=${progressed} elapsed=${Date.now() - t0}ms`,
      );
      if (progressed) {
        start = next;
        committed = next;
        onBatch?.(next);
        if (bytesLeft !== 0) continue;
      } else if (bytesLeft !== 0) {
        // Bytes reported but no forward progress — the ring is stuck; stop.
        break;
      }
      // Termination (bytesLeft=0). When evidence says newer segments exist
      // beyond the walk's end, probe forward one day at a time (bounded,
      // never past the evidence) until a probe finds the next segment.
      // Empty probes resolve on the quiet timer and move nothing.
      const evidence = Math.max(options?.expectEndAtLeast ?? 0, this.maxEventTsSeen);
      const probeTarget = start + SEGMENT_PROBE_STEP_DS;
      if (probes < MAX_SEGMENT_PROBES && probeTarget <= evidence) {
        probes++;
        console.log(
          `[sync] walk terminated at ${start} below expected end >=${evidence} — probing forward at ${probeTarget} (#${probes})`,
        );
        start = probeTarget;
        continue;
      }
      break;
    }
    return {
      eventsSynced: total,
      nextCursor: committed,
      batches,
      sleepAnalysisProgress: sleepProgress,
    };
  }

  // Lightweight sleep-analysis progress probe: a get_event at an up-to-date
  // cursor returns no event frames, just the batch summary, which carries
  // sleepAnalysisProgress. Any events that DO arrive are safe to ignore here
  // — the caller's cursor is not past them, so a later drain re-fetches them.
  async probeSleepAnalysis(cursorDs: number): Promise<number | null> {
    const packets = await this.request(
      this.build('get_event', { startDs: cursorDs, maxEvents: 255, flags: -1 }),
      15_000,
      this.batchQuietMs,
    );
    let progress: number | null = null;
    for (const p of packets) {
      if (p.tag !== EVENT_BATCH_TAG) continue;
      const json = OuraCore.parseEventBatch(p.frameHex);
      if (json) {
        progress =
          (JSON.parse(json) as { sleepAnalysisProgress?: number }).sleepAnalysisProgress ??
          progress;
      }
    }
    return progress;
  }

  // --- live / latest -----------------------------------------------------

  // A feature's latest cached values (HR / SpO2). Reflects the last automatic
  // measurement; meaningful only when the ring is worn.
  async featureLatest(featureId: number): Promise<LatestValues> {
    const packets = await this.request(this.build('feature_latest', { feature: featureId }));
    const p = packets.find((p) => extTag(p) === 0x25);
    if (!p) throw new Error('no feature-latest response');
    // payload: [0]=0x25,[1]=feature,[2]=result,[3]=status,[4]=state,
    // [5..7]=counter, [7..]=feature-specific data (mirrors client.rs).
    const data = hexToBytes(payloadTailHex(p, 7));
    // Diagnostic: the status/state bytes say WHY data is empty (off-wrist vs
    // never measured) — without them "no latest vitals" is a guess.
    console.log(
      `[sync] featureLatest(0x${featureId.toString(16)}): result=${payloadByte(p, 2)} ` +
        `status=${payloadByte(p, 3)} state=${payloadByte(p, 4)} data=${payloadTailHex(p, 7) || '∅'}`,
    );
    const out: LatestValues = { bpm: null, spo2Percent: null };
    if (featureId === FEATURE.DAYTIME_HR) {
      // data[0..2] = rr-corrected IBI (ms); bpm = 60000 / ibi.
      if (data.length >= 2) out.bpm = bpmFromIbi(data[0] | (data[1] << 8));
    } else if (featureId === FEATURE.EXERCISE_HR) {
      // data[4] = last HR value (bpm).
      if (data.length > 4 && data[4] > 0) out.bpm = data[4];
    } else if (featureId === FEATURE.SPO2) {
      // data[3] = SpO2 %, data[4] = HR bpm.
      if (data.length > 3 && data[3] > 0) out.spo2Percent = data[3];
      if (data.length > 4 && data[4] > 0) out.bpm = data[4];
    }
    return out;
  }

  async featureStatus(featureId: number): Promise<FeatureStatus> {
    const packets = await this.request(this.build('feature_status', { feature: featureId }));
    const p = packets.find((p) => extTag(p) === 0x21 && p.payloadHex.length >= 12);
    if (!p) throw new Error('no feature-status response');
    return {
      feature: payloadByte(p, 1) ?? 0,
      mode: payloadByte(p, 2) ?? 0,
      status: payloadByte(p, 3) ?? 0,
      state: payloadByte(p, 4) ?? 0,
      subscription: payloadByte(p, 5) ?? 0,
    };
  }

  async setFeatureMode(featureId: number, mode: number): Promise<void> {
    const packets = await this.request(
      this.build('set_feature_mode', { feature: featureId, mode }),
    );
    const p = packets.find((p) => extTag(p) === 0x23);
    const result = p ? payloadByte(p, 2) : undefined;
    if (result === undefined) throw new Error('no set_feature_mode response');
    if (result !== 0) throw new Error(`set_feature_mode result ${hexByte(result)}`);
  }

  // Live daytime HR (CONNECTED_LIVE), mirroring live_heart_rate in client.rs:
  // enable the feature, forward valid beats until the deadline (or until
  // shouldStop() reports an early stop), then restore AUTOMATIC mode. The
  // ring must be worn for samples to appear. Unlike the Rust original we go
  // through setFeatureMode so a rejected mode switch throws instead of
  // silently waiting out the deadline with zero beats.
  async liveHeartRate(
    durationSeconds: number,
    onSample: (sample: HeartRateSample) => void,
    shouldStop?: () => boolean,
  ): Promise<void> {
    let frames = 0;
    let beats = 0;
    const unsubscribe = this.transport.subscribe((frameHex) => {
      frames++;
      const sample = parseLiveHrFrame(frameHex);
      if (sample) {
        beats++;
        onSample(sample);
      } else if (frames <= 5) {
        // Diagnostic: what DOES the ring send during a live session? Answers
        // "zero beats" reports from the Metro log without a packet sniffer.
        console.log(`[live] non-beat frame: ${frameHex}`);
      }
    });
    const deadline = Date.now() + durationSeconds * 1000;
    try {
      await this.setFeatureMode(FEATURE.DAYTIME_HR, FEATURE_MODE.CONNECTED_LIVE);
      console.log('[live] CONNECTED_LIVE confirmed by ring');
      // Probe what the ring thinks it is doing — the status/state bytes
      // distinguish "measuring" from "off-wrist" when zero beats arrive.
      try {
        const st = await this.featureStatus(FEATURE.DAYTIME_HR);
        console.log(
          `[live] daytime-HR status: mode=${st.mode} status=${st.status} state=${st.state} sub=${st.subscription}`,
        );
      } catch {
        // Non-fatal: the status probe must never break a live session.
      }
      while (Date.now() < deadline && !shouldStop?.()) {
        await sleep(Math.min(250, deadline - Date.now()));
      }
      console.log(`[live] session done: ${beats} beats from ${frames} frames`);
      // An early user stop with no beats yet is a choice, not a failure.
      if (beats === 0 && !shouldStop?.()) {
        throw new Error(
          'No heart-rate signal — make sure the ring is on your finger and snug, then retry',
        );
      }
    } finally {
      unsubscribe();
      // Best-effort restore to automatic mode.
      try {
        await this.setFeatureMode(FEATURE.DAYTIME_HR, FEATURE_MODE.AUTOMATIC);
      } catch {
        // Link may already be down.
      }
    }
  }

  // Stop all real-time measurements (mandatory teardown for realtime streams).
  async stopRealtime(): Promise<void> {
    await this.transport.writeFrame(this.build('realtime_off'));
  }
}
