import { describe, expect, it, mock } from 'bun:test';
import type { BleTransport } from '../transport';

// Tests for the drainEvents walk in client.ts: batching, cursor advance,
// request pipelining, multi-segment continuation and dedupe. The OuraCore
// native bridge and the BLE transport are mocked; frames are real-shaped hex
// protocol frames ([tag][len][payload…]) so the client's first-byte tag
// sniffing and payload parsing run for real.

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const hexByte = (n: number) => n.toString(16).padStart(2, '0');
// u32 LE, matching the ring's envelope timestamp encoding.
const leTs = (ts: number) =>
  [0, 8, 16, 24].map((s) => hexByte((ts >>> s) & 0xff)).join('');

function eventFrame(tag: number, ts: number, body = '01'): string {
  const payload = leTs(ts) + body;
  return `${hexByte(tag)}${hexByte(payload.length / 2)}${payload}`;
}

// Batch summary (0x11) with eventsReceived + bytesLeft packed into the
// payload; the OuraCore mock below decodes the same layout.
function summaryFrame(eventsReceived: number, bytesLeft: number): string {
  const payload =
    hexByte(eventsReceived) +
    hexByte(bytesLeft & 0xff) +
    hexByte((bytesLeft >> 8) & 0xff) +
    hexByte((bytesLeft >> 16) & 0xff);
  return `1104${payload}`;
}

mock.module('@kore/oura-core', () => ({
  OuraCore: {
    buildRequest: (op: string, paramsJson: string) =>
      JSON.stringify({ op, params: JSON.parse(paramsJson) }),
    parsePacket: (frameHex: string) => {
      if (frameHex.length < 4) return '';
      const tag = parseInt(frameHex.slice(0, 2), 16);
      const len = parseInt(frameHex.slice(2, 4), 16);
      return JSON.stringify({ tag, payloadHex: frameHex.slice(4, 4 + len * 2) });
    },
    parseEventBatch: (frameHex: string) => {
      if (frameHex.length < 12 || frameHex.slice(0, 2) !== '11') return '';
      const b = (i: number) => parseInt(frameHex.slice(4 + i * 2, 6 + i * 2), 16);
      return JSON.stringify({
        eventsReceived: b(0),
        sleepAnalysisProgress: 0,
        bytesLeft: b(1) | (b(2) << 8) | (b(3) << 16),
      });
    },
    decodeEvent: () => '',
    eventName: (tag: number) => `tag_${tag.toString(16)}`,
  },
}));

type FrameListener = (frameHex: string) => void;

// Scripted transport: each get_event write replays the frames the script
// returns for that startDs, one every `frameGapMs`, like a ring streaming a
// batch over BLE.
class MockTransport {
  writes: { startDs: number; at: number }[] = [];
  private listeners = new Set<FrameListener>();

  constructor(
    private script: (startDs: number) => string[],
    private frameGapMs = 2,
  ) {}

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async writeFrame(frameHex: string): Promise<void> {
    const req = JSON.parse(frameHex) as { op: string; params: { startDs: number } };
    if (req.op !== 'get_event') return;
    this.writes.push({ startDs: req.params.startDs, at: Date.now() });
    for (const frame of this.script(req.params.startDs)) {
      await new Promise((r) => setTimeout(r, this.frameGapMs));
      for (const l of this.listeners) l(frame);
    }
  }
}

const { OuraRingClient } = await import('../client');

// Short timers for behavioral tests; the short-quiet test overrides the
// default quiet window with a long one to prove batches resolve on the
// batch quiet window instead.
function makeClient(transport: MockTransport, quietMs = 60, batchQuietMs = 15) {
  return new OuraRingClient(transport as unknown as BleTransport, quietMs, batchQuietMs);
}

describe('drainEvents — batching and cursor advance', () => {
  it('drains batches until bytesLeft=0, advancing the cursor per batch', async () => {
    const transport = new MockTransport((startDs) => {
      if (startDs === 0)
        return [eventFrame(0x55, 100), eventFrame(0x55, 200), summaryFrame(2, 500)];
      if (startDs === 201) return [eventFrame(0x55, 300), summaryFrame(1, 0)];
      return [summaryFrame(0, 0)];
    });
    const client = makeClient(transport);
    const events: number[] = [];
    const batches: number[] = [];
    const outcome = await client.drainEvents(
      0,
      (e) => events.push(e.timestamp),
      (c) => batches.push(c),
    );
    expect(events).toEqual([100, 200, 300]);
    expect(batches).toEqual([201, 301]);
    expect(outcome).toEqual({ eventsSynced: 3, nextCursor: 301 });
    expect(transport.writes.map((w) => w.startDs)).toEqual([0, 201]);
  });

  it('stops when a batch makes no progress even with bytesLeft>0', async () => {
    const transport = new MockTransport(() => [summaryFrame(0, 500)]);
    const client = makeClient(transport);
    const outcome = await client.drainEvents(42, () => {});
    expect(outcome).toEqual({ eventsSynced: 0, nextCursor: 42 });
    expect(transport.writes).toHaveLength(1);
  });
});

describe('drainEvents — pipelined batch requests', () => {
  it('resolves each batch on the short batch quiet window, not the default quiet', async () => {
    // 4 batches; the default quiet window is 2s, so a drain on it would take
    // ~8s. With the 20ms batch quiet window it finishes in well under one
    // default quiet window.
    const transport = new MockTransport((startDs) => {
      const base = startDs;
      return [
        eventFrame(0x55, base + 100),
        eventFrame(0x55, base + 200),
        summaryFrame(2, base >= 600 ? 0 : 1000),
      ];
    });
    const client = makeClient(transport, 2_000, 20);
    const events: number[] = [];
    const t0 = Date.now();
    const outcome = await client.drainEvents(0, (e) => events.push(e.timestamp));
    const elapsed = Date.now() - t0;
    expect(outcome.eventsSynced).toBe(8);
    expect(transport.writes.length).toBe(4);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('resolves a summary-less batch on the batch quiet window and ends the walk', async () => {
    // A batch with event frames but no summary: the batch quiet window
    // resolves the request, and bytesLeft stays 0 so the walk ends.
    const transport = new MockTransport(() => [eventFrame(0x55, 100)]);
    const client = makeClient(transport, 50, 10);
    const t0 = Date.now();
    const outcome = await client.drainEvents(0, () => {});
    const elapsed = Date.now() - t0;
    expect(outcome).toEqual({ eventsSynced: 1, nextCursor: 101 });
    expect(elapsed).toBeLessThan(500);
  });

  it('keeps walking when a glued batch ends with bytesLeft>0 (last summary wins)', async () => {
    // Two batches glued into one request (the 15s cap case): both summaries
    // arrive in the same collection window. All event frames are delivered,
    // and the LAST summary's bytesLeft decides whether the walk continues.
    const transport = new MockTransport((startDs) => {
      if (startDs === 0)
        return [
          eventFrame(0x55, 100),
          summaryFrame(1, 500),
          eventFrame(0x55, 200),
          summaryFrame(1, 500), // last summary: more bytes left
        ];
      if (startDs === 201) return [eventFrame(0x55, 300), summaryFrame(1, 0)];
      return [summaryFrame(0, 0)];
    });
    const client = makeClient(transport);
    const events: number[] = [];
    const outcome = await client.drainEvents(0, (e) => events.push(e.timestamp));
    expect(events).toEqual([100, 200, 300]);
    expect(outcome).toEqual({ eventsSynced: 3, nextCursor: 301 });
    expect(transport.writes.map((w) => w.startDs)).toEqual([0, 201]);
  });

  it('terminates a glued batch only when the LAST summary says bytesLeft=0', async () => {
    const transport = new MockTransport((startDs) => {
      if (startDs === 0)
        return [
          eventFrame(0x55, 100),
          summaryFrame(1, 500),
          eventFrame(0x55, 200),
          summaryFrame(1, 0), // last summary: drained
        ];
      return [summaryFrame(0, 0)];
    });
    const client = makeClient(transport);
    const events: number[] = [];
    const outcome = await client.drainEvents(0, (e) => events.push(e.timestamp));
    expect(events).toEqual([100, 200]);
    expect(outcome).toEqual({ eventsSynced: 2, nextCursor: 201 });
    expect(transport.writes.map((w) => w.startDs)).toEqual([0]);
  });
});

describe('drainEvents — multi-segment walk', () => {
  it('without a hint, stops at an early bytesLeft=0 (legacy behavior)', async () => {
    const transport = new MockTransport(() => [
      eventFrame(0x55, 8_000_000),
      summaryFrame(1, 0),
    ]);
    const client = makeClient(transport);
    const outcome = await client.drainEvents(0, () => {});
    expect(outcome).toEqual({ eventsSynced: 1, nextCursor: 8_000_001 });
    expect(transport.writes).toHaveLength(1);
  });

  it('with a hint, probes forward day by day until it finds the next segment', async () => {
    // Pass from 0 ends at 8.02M with bytesLeft=0; the hint (persisted cursor)
    // proves data exists at 13M. The drain probes in one-day steps; four
    // probes land in the gap (empty), the fifth finds the newer segment.
    const transport = new MockTransport((startDs) => {
      if (startDs === 0)
        return [
          eventFrame(0x55, 8_000_000),
          eventFrame(0x55, 8_000_100),
          summaryFrame(2, 0),
        ];
      if (startDs === 12_320_101)
        return [
          eventFrame(0x55, 8_000_100), // replayed frame — same identity
          eventFrame(0x55, 12_500_000),
          eventFrame(0x55, 13_000_000),
          summaryFrame(3, 0),
        ];
      return [summaryFrame(0, 0)]; // empty probe
    });
    const client = makeClient(transport);
    const events: number[] = [];
    const outcome = await client.drainEvents(
      0,
      (e) => events.push(e.timestamp),
      undefined,
      { expectEndAtLeast: 13_000_000 },
    );
    expect(events).toEqual([8_000_000, 8_000_100, 12_500_000, 13_000_000]);
    expect(outcome).toEqual({ eventsSynced: 4, nextCursor: 13_000_001 });
    expect(transport.writes.map((w) => w.startDs)).toEqual([
      0,
      8_864_101, // 8_000_101 + 864000: probe 1 (empty)
      9_728_101, // probe 2 (empty)
      10_592_101, // probe 3 (empty)
      11_456_101, // probe 4 (empty)
      12_320_101, // probe 5 — finds the segment
    ]);
  });

  it('crosses multiple gaps: resumes walking after data, then probes again', async () => {
    // The stalemate from the live logs: a segment found by probing terminates
    // at ANOTHER boundary below the evidence — the walk must keep probing
    // forward from there, not compute a target behind itself.
    const transport = new MockTransport((startDs) => {
      if (startDs === 0) return [eventFrame(0x55, 8_000_000), summaryFrame(1, 0)];
      if (startDs === 8_864_001) return [eventFrame(0x55, 9_000_000), summaryFrame(1, 0)];
      if (startDs === 10_728_001) return [eventFrame(0x55, 11_000_000), summaryFrame(1, 0)];
      return [summaryFrame(0, 0)];
    });
    const client = makeClient(transport);
    const events: number[] = [];
    const outcome = await client.drainEvents(0, (e) => events.push(e.timestamp), undefined, {
      expectEndAtLeast: 13_000_000,
    });
    expect(events).toEqual([8_000_000, 9_000_000, 11_000_000]);
    expect(outcome).toEqual({ eventsSynced: 3, nextCursor: 11_000_001 });
    expect(transport.writes.map((w) => w.startDs)).toEqual([
      0,
      8_864_001, // probe 1 — finds segment 2 (ends 9M)
      9_864_001, // probe 2 (empty)
      10_728_001, // probe 3 — finds segment 3 (ends 11M)
      11_864_001, // probe 4 (empty)
      12_728_001, // probe 5 (empty); next probe 13,592,001 > evidence → stop
    ]);
  });

  it('a probe that would overshoot the evidence stops cleanly', async () => {
    // The walk ends at 12.4M, evidence is 13M — less than one probe step
    // away. Probing is never allowed past the evidence, so the drain ends
    // with the committed cursor at the last event-backed position.
    const transport = new MockTransport((startDs) => {
      if (startDs === 0) return [eventFrame(0x55, 12_400_000), summaryFrame(1, 0)];
      return [summaryFrame(0, 0)];
    });
    const client = makeClient(transport);
    const events: number[] = [];
    const outcome = await client.drainEvents(0, (e) => events.push(e.timestamp), undefined, {
      expectEndAtLeast: 13_000_000,
    });
    expect(events).toEqual([12_400_000]);
    expect(outcome).toEqual({ eventsSynced: 1, nextCursor: 12_400_001 });
    expect(transport.writes.map((w) => w.startDs)).toEqual([0]);
  });

  it('empty probes never move the committed cursor', async () => {
    // Stale hint: the ring's data really ends at 8M, but the hint claims 13M.
    // Every probe comes back empty — nextCursor must stay at the last
    // position backed by delivered events, not a speculative probe target.
    const transport = new MockTransport((startDs) => {
      if (startDs === 0) return [eventFrame(0x55, 8_000_000), summaryFrame(1, 0)];
      return [summaryFrame(0, 0)];
    });
    const client = makeClient(transport);
    const events: number[] = [];
    const outcome = await client.drainEvents(0, (e) => events.push(e.timestamp), undefined, {
      expectEndAtLeast: 13_000_000,
    });
    expect(events).toEqual([8_000_000]);
    expect(outcome).toEqual({ eventsSynced: 1, nextCursor: 8_000_001 });
    expect(transport.writes.map((w) => w.startDs)).toEqual([
      0,
      8_864_001,
      9_728_001,
      10_592_001,
      11_456_001,
      12_320_001, // last probe within evidence; 13,184,001 > 13M → stop
    ]);
  });

  it('delivers identical frames within one batch only once', async () => {
    const transport = new MockTransport(() => [
      eventFrame(0x55, 100),
      eventFrame(0x55, 100), // exact duplicate frame
      summaryFrame(2, 0),
    ]);
    const client = makeClient(transport);
    const events: number[] = [];
    const outcome = await client.drainEvents(0, (e) => events.push(e.timestamp));
    expect(events).toEqual([100]);
    expect(outcome).toEqual({ eventsSynced: 1, nextCursor: 101 });
  });

  it('never probes backward onto already-drained data', async () => {
    // Batch at 0 delivers events up to 11M; the evidence (max ts seen) is
    // below the advanced cursor, so termination must not probe at all.
    const transport = new MockTransport((startDs) => {
      if (startDs === 0)
        return [
          eventFrame(0x55, 5_000_000),
          eventFrame(0x56, 11_000_000, '02'),
          summaryFrame(2, 0),
        ];
      return [summaryFrame(0, 0)];
    });
    const client = makeClient(transport);
    const events: number[] = [];
    const outcome = await client.drainEvents(0, (e) => events.push(e.timestamp));
    expect(events).toEqual([5_000_000, 11_000_000]);
    expect(outcome.nextCursor).toBe(11_000_001);
    expect(transport.writes.map((w) => w.startDs)).toEqual([0]);
  });
});
