import type { RingEventLike } from '../data/ring';

// Pure helpers backing sync.ts's deep resync. Kept in their own module (no
// BLE / store imports) so the walk-and-rebuild policy is unit-testable in
// isolation.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Interior stream-hole size that triggers an automatic deep resync. Six
 * hours: healthy worn-ring captures are gap-free at the 3-min grid for days
 * on end, while the proven stranded-data hole (2026-08-09) ran 8.9 h. Long
 * enough that an unworn afternoon does not trigger a rebuild.
 */
export const STREAM_GAP_TRIGGER_MS = 6 * HOUR_MS;

/**
 * True when a full-cadence series (temp/move — 3-min grid) has an interior
 * hole larger than STREAM_GAP_TRIGGER_MS between two EXISTING samples. This
 * is the intra-day signature of events stranded below the sync cursor (the
 * ring clock is re-aligned by syncTime every sync; when it had run ahead,
 * newly recorded events get decisecond timestamps below the persisted cursor
 * and the forward-only walk can never reach them). hasInteriorDateGap cannot
 * see this — the day rows exist on both sides of the hole. Leading/trailing
 * absence never counts: only holes with data on both sides.
 */
export function hasInteriorStreamGap(dataset: {
  series: Record<string, readonly { t: number }[]>;
}): boolean {
  for (const id of ['temp', 'move']) {
    const s = dataset.series[id] ?? [];
    for (let i = 1; i < s.length; i++) {
      if (s[i].t - s[i - 1].t > STREAM_GAP_TRIGGER_MS) return true;
    }
  }
  return false;
}

/**
 * How close a deep rebuild's final cursor must get to the expected end (the
 * pre-rebuild cursor) for the rebuilt dataset to be committed, in ring-clock
 * deciseconds. One day: the forward probes step in whole days and never pass
 * the evidence, so a walk that terminates in the final partial-day window
 * below the evidence is still a complete-enough rebuild.
 */
export const DEEP_RESYNC_REACH_TOLERANCE_DS = 864_000;

/**
 * Whether to wait (bounded) for the ring's sleep analysis after a drain and
 * re-drain for the fresh sleep events. Firmware semantics of
 * sleepAnalysisProgress (proven on-device): 0 = not started/idle (a ring
 * that never starts on-demand analysis reports 0 INDEFINITELY), 1–99 =
 * running, 100 = done. Waiting only ever helps when analysis is actually
 * running, so progress=0 never waits — and neither does a drain that
 * already picked up sleep events.
 */
export function shouldWaitForSleepAnalysis(input: {
  progress: number | null;
  hasSleepEvents: boolean;
}): boolean {
  if (input.progress == null || input.progress <= 0 || input.progress >= 100) return false;
  return !input.hasSleepEvents;
}

/**
 * True when the persisted day list has an interior hole of more than one
 * full day (e.g. …, 2026-07-27, 2026-08-06, …) — the signature of ring data
 * stranded below the sync cursor by the legacy walk's early segment
 * termination, which the forward-only cursor can never reach. Only gaps
 * BETWEEN two existing day rows count: a missing leading/trailing day may be
 * legitimate (ring unworn, not yet synced) and must not trigger a rebuild.
 */
export function hasInteriorDateGap(days: readonly { date: string }[]): boolean {
  const dates = days.map((d) => d.date).sort();
  for (let i = 1; i < dates.length; i++) {
    const prev = Date.parse(`${dates[i - 1]}T00:00:00Z`);
    const cur = Date.parse(`${dates[i]}T00:00:00Z`);
    if (Number.isNaN(prev) || Number.isNaN(cur)) continue;
    if (cur - prev > 2 * DAY_MS) return true;
  }
  return false;
}

/**
 * Exact-duplicate filter for drained events (key: tag + timestamp + decoded
 * body). Multi-segment walks intentionally overlap by up to a day, and the
 * fold in data/ring.ts is NOT idempotent — re-fed events would double-count —
 * so duplicates must never reach it.
 */
export function dedupeEvents(events: RingEventLike[]): RingEventLike[] {
  const seen = new Set<string>();
  const out: RingEventLike[] = [];
  for (const e of events) {
    const key = `${e.tag}:${e.timestamp}:${JSON.stringify(e.decoded)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
