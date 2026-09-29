import { describe, expect, it } from 'bun:test';
import { BATCH_QUIET_MS, RESPONSE_QUIET_MS } from '../constants';
import { dedupeEvents, hasInteriorDateGap, hasInteriorStreamGap, shouldWaitForSleepAnalysis } from '../resync';

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

describe('hasInteriorStreamGap', () => {
  const GRID = 3 * 60_000;
  // Series of contiguous 3-min samples over `hours`, starting at t0.
  const series = (t0: number, hours: number) =>
    Array.from({ length: (hours * 60) / 3 }, (_, i) => ({ t: t0 + i * GRID }));
  const ds = (temp: { t: number }[], move: { t: number }[] = []) => ({
    series: { temp, move },
  });

  it('is false for gap-free, empty and single-sample series', () => {
    expect(hasInteriorStreamGap(ds(series(0, 48)))).toBe(false);
    expect(hasInteriorStreamGap(ds([]))).toBe(false);
    expect(hasInteriorStreamGap(ds([{ t: 0 }]))).toBe(false);
  });

  it('is false for holes under the 6 h trigger (e.g. an unworn afternoon)', () => {
    const t0 = 0;
    const s = [...series(t0, 4), ...series(t0 + 9 * 3_600_000, 4)]; // 5 h hole
    expect(hasInteriorStreamGap(ds(s))).toBe(false);
  });

  it('detects the proven 8.9 h stranded-data hole (2026-08-09 overnight)', () => {
    const t0 = 0;
    const s = [...series(t0, 4), ...series(t0 + 4 * 3_600_000 + 8.9 * 3_600_000, 4)];
    expect(hasInteriorStreamGap(ds(s))).toBe(true);
  });

  it('flags a hole in EITHER full-cadence series', () => {
    const t0 = 0;
    const gappy = [...series(t0, 4), ...series(t0 + 11 * 3_600_000, 4)]; // 7 h hole
    expect(hasInteriorStreamGap(ds(series(0, 48), gappy))).toBe(true);
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
