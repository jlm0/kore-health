import { describe, expect, it } from 'bun:test';
import { BATCH_QUIET_MS, RESPONSE_QUIET_MS } from '../constants';
import { dedupeEvents, hasInteriorDateGap, shouldWaitForSleepAnalysis } from '../resync';

// Tests for the pure deep-resync helpers in resync.ts: interior date-gap
// detection (the deep-resync trigger) and event dedupe (the fold is not
// idempotent, so overlapping multi-segment walks must not re-feed events).

describe('hasInteriorDateGap', () => {
  const days = (...dates: string[]) => dates.map((date) => ({ date }));

  it('is false for empty, single-day and contiguous day lists', () => {
    expect(hasInteriorDateGap([])).toBe(false);
    expect(hasInteriorDateGap(days('2026-08-01'))).toBe(false);
    expect(hasInteriorDateGap(days('2026-08-01', '2026-08-02', '2026-08-03'))).toBe(false);
  });

  it('is false for a single missing day (may be legitimate: ring unworn)', () => {
    expect(hasInteriorDateGap(days('2026-08-01', '2026-08-03'))).toBe(false);
  });

  it('is true when more than one full day is missing between rows', () => {
    expect(hasInteriorDateGap(days('2026-08-01', '2026-08-04'))).toBe(true);
  });

  it('detects the proven 10-day hole (2026-07-27 → 2026-08-06)', () => {
    expect(
      hasInteriorDateGap(days('2026-07-25', '2026-07-26', '2026-07-27', '2026-08-06', '2026-08-07')),
    ).toBe(true);
  });

  it('ignores unsorted input', () => {
    expect(hasInteriorDateGap(days('2026-08-06', '2026-07-27', '2026-07-26'))).toBe(true);
    expect(hasInteriorDateGap(days('2026-08-02', '2026-08-01'))).toBe(false);
  });
});

describe('dedupeEvents', () => {
  const ev = (tag: number, timestamp: number, decoded: unknown = null) => ({
    tag,
    name: `tag_${tag.toString(16)}`,
    timestamp,
    decoded,
  });

  it('drops exact duplicates, keeping first-seen order', () => {
    const a = ev(0x55, 100, { bpm: 60 });
    const b = ev(0x55, 200, { bpm: 61 });
    const out = dedupeEvents([a, b, ev(0x55, 100, { bpm: 60 }), a]);
    expect(out).toEqual([a, b]);
  });

  it('keeps distinct events that share tag and timestamp but differ in body', () => {
    const out = dedupeEvents([ev(0x55, 100, { bpm: 60 }), ev(0x55, 100, { bpm: 61 })]);
    expect(out).toHaveLength(2);
  });

  it('keeps events with the same timestamp but different tags', () => {
    const out = dedupeEvents([ev(0x55, 100), ev(0x56, 100)]);
    expect(out).toHaveLength(2);
  });
});

describe('shouldWaitForSleepAnalysis', () => {
  it('never waits when analysis is complete or its progress is unknown', () => {
    expect(shouldWaitForSleepAnalysis({ progress: 100, hasSleepEvents: false })).toBe(false);
    expect(shouldWaitForSleepAnalysis({ progress: null, hasSleepEvents: false })).toBe(false);
  });

  it('waits only when analysis is genuinely mid-flight (1–99) with no sleep events', () => {
    expect(shouldWaitForSleepAnalysis({ progress: 40, hasSleepEvents: false })).toBe(true);
    expect(shouldWaitForSleepAnalysis({ progress: 1, hasSleepEvents: false })).toBe(true);
    expect(shouldWaitForSleepAnalysis({ progress: 99, hasSleepEvents: false })).toBe(true);
  });

  it('never waits when the drain already delivered sleep events', () => {
    expect(shouldWaitForSleepAnalysis({ progress: 40, hasSleepEvents: true })).toBe(false);
  });

  it('never waits at progress=0 — idle means not started, however much was drained', () => {
    // Proven on-device: a ring that never starts on-demand analysis reports
    // progress=0 indefinitely; waiting burns the full bounded wait per sync.
    expect(shouldWaitForSleepAnalysis({ progress: 0, hasSleepEvents: false })).toBe(false);
  });
});

describe('request quiet windows', () => {
  it('uses the tuned quiet values verified on-device', () => {
    // Small request/response ops answer in a few hundred ms; batches pause
    // >1500ms between get_event calls.
    expect(RESPONSE_QUIET_MS).toBe(500);
    expect(BATCH_QUIET_MS).toBe(400);
  });
});
