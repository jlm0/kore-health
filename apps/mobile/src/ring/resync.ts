import type { RingEventLike } from '../data/ring';

// Pure helpers backing sync.ts's deep resync. Kept in their own module (no
// BLE / store imports) so the walk-and-rebuild policy is unit-testable in
// isolation.

const DAY_MS = 86_400_000;

/**
 * How close a deep rebuild's final cursor must get to the expected end (the
 * pre-rebuild cursor) for the rebuilt dataset to be committed, in ring-clock
 * deciseconds. One day: the forward probes step in whole days and never pass
 * the evidence, so a walk that terminates in the final partial-day window
 * below the evidence is still a complete-enough rebuild.
 */
export const DEEP_RESYNC_REACH_TOLERANCE_DS = 864_000;

/**
 * Drain size (events) at or below which a sleepAnalysisProgress of 0 means
 * "nothing to analyze" rather than "analysis pending" — a factory-fresh /
 * near-empty ring reports progress=0 forever, and waiting for it would burn
 * the full bounded wait every sync.
 */
export const NEAR_EMPTY_DRAIN_EVENTS = 10;

/**
 * Whether to wait (bounded) for the ring's sleep analysis after a drain and
 * re-drain for the fresh sleep events. Waits only when analysis was actually
 * RUNNING at drain end (0 < progress < 100), or plausibly pending with real
 * history to chew on — and never when the drain already picked up sleep
 * events. A near-empty drain with progress=0 is a ring with nothing to
 * analyze: skip immediately.
 */
export function shouldWaitForSleepAnalysis(input: {
  progress: number | null;
  drainedEvents: number;
  hasSleepEvents: boolean;
}): boolean {
  if (input.progress == null || input.progress >= 100) return false;
  if (input.hasSleepEvents) return false;
  if (input.progress === 0 && input.drainedEvents <= NEAR_EMPTY_DRAIN_EVENTS) return false;
  return true;
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
