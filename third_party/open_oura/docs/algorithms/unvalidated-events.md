# Event decoders ported from the native parser — validation status

These decoders were ported from `libringeventparser.so` (the byte layouts are the
parser's ground truth) but most haven't appeared in our captures, so their field
*mapping* is confirmed by code, not by real data. Each unvalidated decoder emits
`"_status":"unvalidated"` in its JSON; drop it once a real sample confirms the
fields. The handler `@ address` is cited in `crates/oura-protocol/src/events.rs`.

## Validated (confirmed against captured bytes)

| Tag / subtype | Event | How confirmed |
| --- | --- | --- |
| `0x61`/`0x24` | `battery_level_changed` | captured: `battery_pct` 92–100 %, `voltage_mv` 4280–4391 mV (Li-ion). |
| `0x61`/`0x04` | `debug_text` | captured 64×: subtype byte + ASCII tail (`bb_acq;0;5`, `Igte;1;0`). |
| `0x6b` | `motion_period` | decodes the captured packed 2-bit streams. |
| `0x6c` | `feature_session` | captured balanced start/stop pairs. |

## debug_data (tag 0x61) binary subtypes — structure mapped from a real capture

Reverse-engineered from 2,446 `debug_data` events captured from a COR_08
("cooper", fw 2.1.20) sync on 2026-08-02/03 (see
`tools/analyze_debug_data.py`; trimmed fixture:
`crates/oura-protocol/tests/fixtures/debug_data_capture.json`). All bodies are
fixed-length per subtype. Fields listed as validated have quantitative evidence;
the rest are structural, so these decoders keep `"_status":"unvalidated"`.

| Subtype | n | Len | Kind / layout | Evidence |
| --- | --- | --- | --- | --- |
| `0x09` | 252 | 14 | `measurement_session`: `session_start` u32, `aux_counter` u32, `session_duration` u32, `status` u8 | invariant `start + duration ≈ 0x0d.session_end` (median residual −4, 361/405 within ±220 counts); `status` == `0x0c.status` in 405/405 clusters. Counter clock rate unresolved (see negative results below). |
| `0x0a` | 252 | 13 | session-cluster companion: `reserved` u32 (always 0), `value` u32 (0–2332), `aux` u32 (∈ {0,23,24,29,48}) | interleaved with 0x09/0x0c/0x0d (same 252 clusters); field semantics unresolved. |
| `0x0c` | 252 | 10 | `session_counter` u32, `interval_ds` u16, `status` u8 | **`interval_ds` validated**: matches the real gap to the previous cluster within ±5 ds in 247/251 pairs. |
| `0x0d` | 252 | 13 | two reserved u32 (0), `session_end` u32 | invariant with 0x09 above. |
| `0x14` | 77 | 14 | `fuel_gauge`: byte1, byte2, **`voltage_mv` u16@3**, `current_raw` i16@5, `0xff 0xff`, byte9, `temp_c` u16@10, 0x00, byte13 | **voltage validated**: within 5 mV of the nearest `0x24` battery voltage on all 77 events (mean 1.2 mV). `temp_c` 35–36 on a worn ring (plausible °C). bytes 1/2/9/13 decrease monotonically (gauge internals) → surfaced as `gauge_raw`. |
| `0x28` | 500 | 14 | `afe_stats`: `flag` u8, three u32 `counters` | only two distinct bodies (`flag` 0/1, counters all 0 — no AFE errors in window). |
| `0x33` | 383 | 8/14 | `flag` u8, then 1–2 fixed 6-byte records (hex) | record bytes take few distinct values (b0 0x70/0x80/0x81, b3 0x8c/0xcc, b5 0/1/8). |
| `0x35` | 90 | 5–7 | `ppg_signal_quality`: `config` [u8;2], `data` hex | 1 Hz bursts of 4 records ~10×/hour; two forms (byte3 `0x1e`, or `0x03 0x04` for len 7). |
| `0x3b` | 214 | 7 | two zero bytes, `value` u32 (40000 or 20000), two zero bytes | only two distinct bodies; plausibly a duration in µs. |
| `0x04` | 64 | 9/11 | `debug_text`: ASCII tail | see Validated table. |
| `0x29` | 60 | 8 | `mode_a`,`mode_b` u8, zeros, `flag` u8, marker 25 | two alternating forms; form `(2,3,…,2)` follows state_change "timeout", `(3,7,…,0)` follows "motion det" (wake/accel config log). |
| `0x3c` | 18 | 13 | `0xff`, `part` u8 (0/1), 10 bytes `data` | 9 pairs 1 ds apart, recurring hourly (~36000 ds). |
| `0x30` | 13 | 13 | six u16 `values` | constant body in the capture. |
| `0x24` | 9 | 5 | `battery_level_changed` | see Validated table. |
| `0x15` | 9 | 9 | four u16 `values` | hourly record; semantics unresolved. |
| `0x3f` | 1 | 8 | left raw | single occurrence — no statistics possible. |

Note: 0x28/0x3b bodies consist only of zero/printable bytes and were previously
mis-decoded as ASCII ("(", "; N") by the naive printable check; binary subtype
dispatch now runs first.

## 7-day follow-up (ring-capture-2026-08-08-full.json): 0x09 is NOT a sleep record

Hypothesis tested: subtype `0x09` sessions bracket sleep periods. Verdict:
**rejected**. Anchor: ring-ds → wall via `syncCursor`/`lastSyncAt` of the
contemporaneous 2026-08-08 sync (the full capture's own cursor disagrees by
~22 h — cursors lag/are unreliable; the verdict is identical under either).

> **Capture blind-spot caveat.** The "105 h inert gap" first reported here was
> an artifact of the input, not of the ring: this capture's audit walk
> terminated early (~8.4M ring-ds) and its pass 2 only covered cursor−1day, so
> the file **lacks the 8.41M→12.19M region entirely** — every multi-event dump
> shows the same 4.38-day ts discontinuity (e.g. state_change 8413214→12194590).
> The app's full resync the same day (same ring, pre-factory-reset) proves the
> ring recorded continuously: a continuous 704-batch walk from 0→13.09M at 255
> events/batch with ZERO gaps > 5.5 h between consecutive batch timestamps
> (~179k events; debug_data ×36,712 vs this capture's 4,167). The battery
> 87 %→46 % drift across the blind spot is ordinary multi-day wear, and the
> app's sleep windows/days rows are consistent with that continuous record
> (110–188 HR points inside each window). Do not draw absence-of-activity
> conclusions from this capture; `tools/analyze_debug_data.py` now warns when
> an input has such a blind spot.

Alignment (405 sessions visible in this capture, cluster split at gaps >
20000 ds ≈ 33 min):

| Period (UTC) | 0x09 sessions | Note |
| --- | --- | --- |
| cluster 0: 08-02 17:40Z → 08-03 06:56Z | 334, median spacing 109 s | complete data region; contains the only `bedtime_period` (19:41→22:43Z, 3.03 h) and all spo2/hrv events (20:11Z→07:05Z) |
| capture blind spot: 08-03 06:56Z → 08-07 15:58Z | (no input data — see caveat) | NOT ring inactivity |
| cluster 1: 08-07 15:58Z → 19:19Z | 71, median spacing 122 s | awake activity (MET up to 4.7) |
| verified app sleep windows 08-03…08-08 | **0 inside 5 of 6 windows; 5 inside the tail of 08-07** | no bracketing in the complete regions: cluster 0 stops ~2 h before window 08-03 starts |

What the sessions actually correlate with: state-machine toggles. Every session
fires ~1 ds after a `state_change` (`hr enable` 149×, `fea off` 146×,
`timeout` 55×, `motion det` 54×) — 0x09/0x0a/0x0c/0x0d are per-burst
measurement bookkeeping for the daytime-HR/sensing pipeline, awake and asleep
alike, not per-night sleep statistics. The `kind` was renamed
`sleep_statistics` → `measurement_session` accordingly. (This verdict stands:
it rests on cluster-0 data, which the 704-batch resync confirms is complete.)

Clock rate: unresolved by design — per-gap `Δsession_start/Δt` rates spread
19.5k–30.9k counts/s, so the counter is not a free-running clock (it accrues
only while the sensor pipeline is active). `session_start`/`session_duration`
stay raw counts.

`bedtime_period` cross-check: only 1 event visible in this capture (08-02
19:41→22:43Z, logged 4 h later at 02:42Z — ring analysis ran post-wake). It
matches none of the app's windows (nearest window starts ~30 h later); it is a
separate, shorter ring-side detection (3.03 h vs the app's 7–8 h windows).

## Unvalidated (layout from parser, awaiting a real sample)

| Tag | Event | Field confidence | How to trigger / validate |
| --- | --- | --- | --- |
| `0x49` | sleep_summary_1 | offsets only (abs time needs header) | after a processed sleep period |
| `0x4c` | sleep_summary_2 | structure only (u64/u16/u32, names TBD) | after a processed sleep period |
| `0x4f` | sleep_summary_3 | structure (3 fields are ÷8 fixed-point) | after a processed sleep period |
| `0x58` | sleep_summary_4 | structure only | after a processed sleep period |
| `0x7e`/`0x7f` | real_steps_features | bit-unpacked fields, names TBD | walk with the step feature on |
| `0x86` | aohr_event | fields (bpm, quality, 1920 ms interval) | no toggle — rides on daytime HR (enabled); appears when worn |
| `0x84` | ambient_event | i16 @ 5 min, units TBD | appears with ambient sensing |
| `0x87` | atlas_metadata | start-stream control msg | **backend-gated** (`sensing_discovery/atlas` FeatureDefinition, cloud-delivered) — not enableable from an independent client |
| `0x88` | atlas_raw_bioz_data | delta-coded i32 stream | same backend gate as `0x87` |
| `0x61`/`0x11` | charging_time | u32 (units TBD) | **not emitted in normal use** — charge-end comes via `charging_ended_statistics` (0x20/0x27) instead; likely needs a full low→full cycle or is Ring-3-only |

## Not decoded (low value / diagnostic only)

Raw-PPG streams (`0x67/0x68/0x81`) and on-demand measurements (`0x62/0x65/0x66`)
are decoded elsewhere via the RData path or not yet needed. Unknown `0x61`
subtypes stay tagged `{kind:"debug_data", subtype, raw}`.
