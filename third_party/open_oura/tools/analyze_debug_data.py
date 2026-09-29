#!/usr/bin/env python3
"""Statistical analysis of `debug_data` (tag 0x61) binary subtypes from a real
ring capture.

Used to reverse-engineer the subtype layouts decoded in
`crates/oura-protocol/src/events.rs` (`decode_debug_data`). Reads a capture JSON
of the shape produced by the kore-health sync audit:

    {"dumps": {"dump.0x61.debug_data": [{"ts": <ring ds>, "body": "<hex>", ...}]}}

Usage: python3 tools/analyze_debug_data.py <capture.json>

Prints, per subtype: count, body lengths, per-byte entropy, and the structural
correlations that ground the decoders (session-counter invariant
0x09.start + 0x09.duration ~= 0x0d.end, 0x0c interval vs inter-event gap,
0x14 voltage vs the validated 0x24 battery voltage).
"""

import bisect
import collections
import datetime
import json
import statistics
import struct
import sys


def u16(b, i):
    return struct.unpack_from("<H", b, i)[0]


def u32(b, i):
    return struct.unpack_from("<I", b, i)[0]


def is_printable(b):
    return all(x == 0 or 0x20 <= x < 0x7F for x in b)


def detect_blind_spots(doc):
    """Find >1-day ts discontinuities between consecutive events in each dump.

    CAUTION: a capture whose audit walk terminated early (or whose pass 2 only
    re-covered a recent window) has *blind spots* — ring-ts regions with no
    events at all. Any time-alignment analysis (e.g. sleep_alignment below) is
    INVALID across such regions: absence of events there means missing input,
    not ring inactivity. (Real instance: ring-capture-2026-08-08-full.json
    lacks 8.41M→12.19M ring-ds — a 4.38-day blind spot in every dump — while
    the app's 704-batch full resync of the same ring shows continuous
    recording, zero gaps > 5.5 h.)
    """
    spots = []
    for name, evs in doc.get("dumps", {}).items():
        ts = sorted(e["ts"] for e in evs)
        for a, b in zip(ts, ts[1:]):
            if b - a > 864_000:  # > 1 day in ring deciseconds
                spots.append((name, a, b, (b - a) / 864_000))
    return spots


def main(path):
    doc = json.load(open(path))
    evs = doc["dumps"]["dump.0x61.debug_data"]
    by_sub = collections.defaultdict(list)
    for e in evs:
        b = bytes.fromhex(e["body"])
        if not b:
            continue
        by_sub[b[0]].append((e["ts"], b))

    spots = detect_blind_spots(doc)
    if spots:
        print("WARNING: capture has walk blind spots (>1-day ts discontinuities);")
        print("time-alignment results across these regions are INVALID (missing")
        print("input data, not ring inactivity):")
        for name, a, b, days in spots:
            print(f"  {name}: no events between ring-ds {a} and {b} ({days:.2f} days)")
        print()

    print(f"{len(evs)} debug_data events, {len(by_sub)} leading-byte values\n")
    for sub, arr in sorted(by_sub.items(), key=lambda kv: -len(kv[1])):
        lens = collections.Counter(len(b) for _, b in arr)
        printable = sum(1 for _, b in arr if is_printable(b))
        print(f"subtype 0x{sub:02x}: n={len(arr)} lengths={dict(lens)} printable={printable}")

    # ── 0x09 / 0x0d session-counter invariant ────────────────────────────
    # Within every measurement cluster, 0x0d's trailing u32 (session end
    # counter) equals 0x09's start counter + duration counter (±wrap).
    e09 = by_sub.get(0x09, [])
    e0d = by_sub.get(0x0D, [])
    ts0d = [t for t, _ in e0d]
    resid = []
    for ts, b in e09:
        j = bisect.bisect_left(ts0d, ts)
        if j < len(e0d) and ts0d[j] - ts < 100:
            resid.append(u32(e0d[j][1], 9) - u32(b, 1) - u32(b, 9))
    if resid:
        print(f"\n0x09.start + 0x09.duration - 0x0d.end: "
              f"median {statistics.median(resid)}, "
              f"|resid|<=220 in {sum(abs(r) <= 220 for r in resid)}/{len(resid)} clusters")

    # ── 0x0c interval field vs actual inter-cluster gap ──────────────────
    e0c = by_sub.get(0x0C, [])
    errs = []
    for (t0, _), (t1, b1) in zip(e0c, e0c[1:]):
        errs.append((t1 - t0) - u16(b1, 5))
    if errs:
        print(f"0x0c.interval_ds vs real gap: median err {statistics.median(errs)} ds, "
              f"|err|<=5 in {sum(abs(e) <= 5 for e in errs)}/{len(errs)}")

    # 0x09 status byte == 0x0c status byte per cluster
    same = sum(1 for (_, b9), (_, bc) in zip(e09, e0c) if b9[13] == bc[9])
    print(f"0x09.status == 0x0c.status in {same}/{min(len(e09), len(e0c))} clusters")

    # ── 0x14 fuel gauge vs validated 0x24 battery ────────────────────────
    e14 = by_sub.get(0x14, [])
    e24 = by_sub.get(0x24, [])
    ts24 = [t for t, _ in e24]
    diffs = []
    for ts, b in e14:
        j = bisect.bisect_left(ts24, ts)
        cand = [e24[k] for k in (j - 1, j) if 0 <= k < len(e24)]
        if cand:
            _, b2 = min(cand, key=lambda x: abs(x[0] - ts))
            diffs.append(abs(u16(b, 3) - u16(b2, 2)))
    if diffs:
        print(f"0x14.voltage_mv (bytes 3-4) vs nearest 0x24: max |diff| {max(diffs)} mV, "
              f"mean {sum(diffs) / len(diffs):.1f} mV over {len(diffs)} events")

    # ── ASCII false positives ────────────────────────────────────────────
    fp = collections.Counter(
        b[0] for _, b in by_sub.get(0x28, []) + by_sub.get(0x3B, []) if is_printable(b)
    )
    print(f"\nprintable-looking binary bodies (mis-decoded as ASCII by the naive "
          f"printable check): {dict(fp)}")

    # ── Sleep-window alignment (needs store.days / bedtime_period) ───────
    # CAUTION: this analysis is only as good as the input capture. If the
    # capture's audit walk has blind spots (see detect_blind_spots warning
    # above), sessions/windows inside those regions are MISSING INPUT, not
    # ring inactivity — do not conclude "the ring was off-wrist/inert" from
    # event absence. (That mistake was made here once on
    # ring-capture-2026-08-08-full.json, which lacks 8.41M→12.19M ring-ds.)
    #
    # Result on the complete regions of that capture: 0x09 sessions do NOT
    # bracket sleep. Anchoring ring-ds via store.scalars.syncCursor/lastSyncAt,
    # the visible sessions form two clusters (08-02 17:40Z -> 08-03 06:56Z,
    # n=334; 08-07 15:58Z -> 19:19Z, n=71, median spacing ~2 min) and zero
    # sessions fall inside any verified store sleep window in complete data.
    # The ring's own bedtime_period lands INSIDE cluster 0 but covers 3.03 h
    # of its 13.3 h span — clusters are awake+sleep measurement bookkeeping,
    # not sleep sessions. The counter "clock rate" is not a fixed clock:
    # per-gap rates spread 19.5k-30.9k counts/s.
    sleep_alignment(doc, by_sub.get(0x09, []), spots)


def sleep_alignment(doc, e09, blind_spots=()):
    dumps = doc.get("dumps", {})
    scalars = doc.get("store", {}).get("scalars", {})
    cursor, synced = scalars.get("syncCursor"), scalars.get("lastSyncAt")
    if not e09 or not cursor or not synced:
        return
    if blind_spots:
        print("\n!! sleep-window alignment SKIPPED: capture has walk blind spots")
        print("   (>1-day ts discontinuities listed above). Conclusions drawn across")
        print("   them would be invalid (missing input, not ring inactivity).")
        return
    anchor_wall = datetime.datetime.fromisoformat(synced.replace("Z", "+00:00")).timestamp()

    def wall(t):
        return anchor_wall - (cursor - t) / 10

    def iso(t):
        return datetime.datetime.fromtimestamp(wall(t), datetime.timezone.utc).strftime("%m-%d %H:%M")

    print("\n-- 0x09 sleep-window alignment (anchor: syncCursor/lastSyncAt) --")
    clusters = [[e09[0]]]
    for x in e09[1:]:
        if x[0] - clusters[-1][-1][0] <= 20000:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    for i, c in enumerate(clusters):
        gaps = [c[j + 1][0] - c[j][0] for j in range(len(c) - 1)]
        med = statistics.median(gaps) / 10 if gaps else 0
        print(f"  cluster {i}: {iso(c[0][0])}Z -> {iso(c[-1][0])}Z  n={len(c)} "
              f"median spacing {med:.1f}s")
    for day in doc.get("store", {}).get("days", []):
        s = day.get("sleep", {})
        if not s.get("start"):
            continue
        n = sum(1 for t, _ in e09 if s["start"] / 1000 <= wall(t) <= s["end"] / 1000)
        print(f"  window {day['date']}: 0x09 sessions inside = {n}")
    for e in dumps.get("dump.0x76.bedtime_period", []):
        dec = e.get("decoded", {})
        print(f"  bedtime_period: {iso(dec['bedtime_start_ds'])}Z -> "
              f"{iso(dec['bedtime_end_ds'])}Z ({dec['duration_hours']} h), "
              f"event logged {iso(e['ts'])}Z")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "capture.json")
