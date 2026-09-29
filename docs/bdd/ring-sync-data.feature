# Data sync, normalization, and long-term aggregation
#
# open_oura gives us raw decoded events and a byte-level protocol. Turning that
# into the app's dataset is OUR layer (src/data/ring.ts, src/data/scores.ts,
# src/ring/sync.ts) and these behaviors are its contract.
#
# Key facts that shape the contract:
#   - The ring does NOT compute Oura's 0–100 scores; we derive our own from raw
#     streams via documented heuristics.
#   - The ring DOES run an on-device sleep analysis that can emit its own
#     hypnogram (sleep_phase_* events); when it syncs we prefer it over the
#     local actigraphy heuristic (stagesSource "ring" vs "local").
#   - Ring event timestamps are ring-clock deciseconds; wall-clock mapping needs
#     an anchor (time_sync events; the app calls syncTime before every drain).
#   - The sync cursor is in ring-time deciseconds and persists per batch.

@sync
Feature: History sync

  Scenario: First sync drains from the beginning
    Given a freshly paired ring (sync cursor = 0)
    When sync runs
    Then events are drained in batches of up to 255 from cursor 0
    And the cursor is persisted after EVERY batch (crash-safe resume)
    And the drain stops when the ring reports nothing left (bytesLeft = 0)

  Scenario: Incremental sync resumes at the cursor
    Given a previous sync persisted cursor C
    When the next sync runs
    Then draining starts at C — no events before C are requested again

  Scenario: Stranded data self-heals via an automatic deep resync
    Given the persisted dataset shows stranded-data damage — a missing
      interior date (> 1 day) OR an interior stream hole > 6 h in temp/move
      with data on both sides (the cursor ran ahead of newly stamped events)
    When the next sync runs
    Then it drains from cursor 0 with forward probing and rebuilds the dataset
    And the rebuild commits only if its walk reaches the old cursor (± 1 day)
    And this auto-trigger fires at most once per app session (circuit breaker)
    And a forced deep resync (ring-debug) bypasses the breaker, and replaces
      days the ring no longer holds

  Scenario: Clock is synced before every drain
    Given any sync
    When the drain starts
    Then the ring clock has been set to phone time (with timezone) immediately before
    And event timestamps are converted via time_sync anchors in the stream

  Scenario: Clock anchor fallback
    Given a drained batch contains no time_sync event
    When timestamps are converted
    Then the newest event is treated as "now" (same fallback oura-cli uses)
    And the fold result records which anchor was used (time_sync | newest_event)

  Scenario: Interrupted sync keeps its progress
    Given a sync that completed 3 batches before the link dropped
    When the user syncs again
    Then only events after the 3rd batch's cursor are requested
    And already-folded data is preserved (fold seeds from the persisted dataset)

  Scenario: One atomic persist per sync
    Given any sync
    When events are folded
    Then AsyncStorage is written ONCE (atomic applySyncResult)
    And no per-sample or per-batch dataset writes occur

@normalization
Feature: Normalization onto the dataset grid
  All series share a 3-minute grid; events are aggregated per bucket (mean).

  Scenario: Per-beat heart rate is bucketed
    Given ibi_and_amplitude / green_ibi_quality events (per-beat IBI)
    When folded
    Then plausible IBIs (300–2000 ms → bpm) average into 3-min hr buckets

  Scenario: HRV windows map to the grid
    Given an hrv_event (avg HR + RMSSD at 5-min intervals)
    When folded
    Then each window lands at event-time + i×interval on hr and hrv series

  Scenario: Temperature becomes deviation from a personal baseline
    Given temp events (i16 LE /100 °C, kept only in 25–40 °C)
    When folded
    Then nightly means (20:00–12:00 samples, keyed to the wake day) are computed
    And a night enters the baseline only with ≥20 overnight samples AND a
    plausible on-finger mean (33–37 °C) — charging/off-wrist nights are gated out
    And each night's baseline is the median of the up-to-7 preceding nightly means
    And the temp series stores deviation vs baseline — 0 until a baseline exists

  Scenario: Temperature shows absolute values before the baseline exists
    Given fewer than 2 recorded nights (no baseline yet — deviation is 0 by design)
    When the temp card or temp metric screen renders
    Then it shows the real ABSOLUTE skin temperature (°C), never a flat "+0.0"
    And notes that the display switches to deviation once the baseline builds

  Scenario: SpO2 uses Oura's documented cooper calibration
    Given spo2_r_pi raw R-ratio events (per-sample r + perfusion index)
    When folded
    Then each r converts via the cooper quadratic −12.1·r² − 6.9·r + 106.3,
    clamped to [85, 100] (third_party/open_oura/docs/spo2-calibration.md)
    And samples with r ≤ 0 or pi ≤ 0 are dropped (not measuring blood)
    And summarized spo2_event samples feed the same spo2 series directly

  Scenario: Steps are reported as zero until validated
    Given activity data
    When a DaySummary is built
    Then steps and kmEquiv are 0 (the real_steps records are unvalidated)
    # documented gap, not a bug — do not estimate steps from motion

  Scenario: Movement blends the ring's motion signals
    Given motion_event, sleep_acm_period, motion_period and activity_information events
    When folded
    Then move intensity is normalized to 0..1 per bucket using the documented
    blends (duty cycle + intensity nibbles; MAD/4; (MET−1)/8)
    And motion_period adds one grid point (mean 2-bit level / 3) — its epoch
    length is undocumented, so no intra-event placement is invented

  Scenario: Calories come from MET bins
    Given activity_information MET bins (assumed 1 min per bin — documented)
    When folded
    Then active calories accrue as (MET−1) × 3.5 × 70kg / 200 per bin, MET ≥ 1.5
    And active minutes count bins at MET ≥ 3

@aggregation
Feature: Aggregation over time

  Scenario: Dataset is trimmed to 30 days
    Given a dataset with older data
    When a sync folds new events
    Then series and day rows older than 30 days are dropped

  Scenario: Sleep windows come from the ring's bedtime detection
    Given a bedtime_period event (plausible 1–16 h window)
    When folded
    Then the night is attributed to the wake day (t + 12 h local midnight)
    And implausible windows are ignored

  Scenario: Sleep staging is a documented actigraphy heuristic
    Given a sleep window with movement and HR data covering ≥ half the window
    When the SleepSummary is built
    Then each 3-min epoch is staged: movement ≥ 0.12 → awake; still + HR near
    night minimum → deep; still + HR near night maximum → REM; else light
    And latency is the first run of 3 consecutive asleep epochs
    And efficiency = asleep / time-in-bed
    And stagesSource is "local"
    And the UI labels stages as an estimate (from heart rate & movement)

  Scenario: The ring's own hypnogram is preferred when it syncs
    Given sleep_phase_* events whose 30-s epoch span fits the bedtime window
    When folded
    Then stage segments anchor to the window and stagesSource is "ring"
    And a hypnogram with an implausible span or no window is rejected
    And ring staging survives later incremental folds (re-seeded from the store)

  Scenario: A window without enough HR coverage claims duration only
    Given a sleep window with < 10 HR epochs or HR in < half of its epochs
    When the SleepSummary is built
    Then it reports time-in-bed duration only: no stages, no efficiency, no latency

  Scenario: Scores are transparent composites with neutral fallbacks
    Given a day with partial data
    When readiness/sleep/activity scores are computed
    Then each is a documented weighted blend clamped to 0–100
    And missing contributors fall back to neutral 0.5 — never invented data

  Scenario: Resting HR and HRV averages are night-derived
    Given overnight HR/HRV data
    When a DaySummary is built
    Then restingHr is the lowest 30-min rolling mean of night HR
    And hrvAvg is the mean of night RMSSD windows

  Scenario: Re-folding the same sync is stable
    Given a sync result already applied
    When a later sync returns zero new events
    Then the dataset is unchanged (no drift from re-aggregation)

@ux
Feature: Connection state and header affordances

  Scenario: Connection state is visible at a glance
    Given the home screen
    Then a status element always shows the ring situation without tapping:
    not paired / syncing now / synced X ago / last sync failed (with reason)
    And tapping it syncs now (paired) or opens pairing (unpaired)
    And the header Ring icon always opens ring management

  Scenario: We never claim a persistent connection
    # the app connects → syncs → disconnects by design; status reflects sync
    # health, never a fake "connected now" dot
    Given a sync finished 2 minutes ago
    When the user looks at the status
    Then it reads "Synced 2m ago" — not "Connected"

  Scenario: Header controls meet touch standards
    Given any header icon button
    Then its touch target is at least 44×44 pt (icon may stay small — hitSlop
    or padding makes up the difference)
    And its purpose is obvious without tapping (icon + label or clear glyph)

  Scenario: Latest values are automatic on every sync
    Given a paired ring with data
    When any sync completes (foreground, background, or manual)
    Then the ring's cached latest HR / SpO2 (featureLatest) are also read
    And the home cards' "current" values update immediately from them
    # history fills charts; featureLatest fills "right now"

  Scenario: Live streaming is one tap away, never silent
    Given a paired ring
    When the user wants true real-time HR
    Then the HR metric screen's Live card streams it for 60 s
    And no background live stream runs without the user starting it

  Scenario: One ring at a time, re-pair is explicit
    Given a paired ring
    When the user wants to pair a different ring
    Then the only path is Forget (disconnect + clear credentials + cursor)
    And the ring itself must be factory-reset before the new pairing works

  Scenario: Empty states never show fake zeros
    Given a screen or card whose data has not been synced yet
    When it renders
    Then it shows an explicit "no data yet" state (EmptyDataCard or dash)
    And never 0 scores, 0% gauges, or empty charts presented as real values

@live
Feature: Live heart rate
  Live data exists only while connected and never touches persisted storage.

  Scenario: Live HR streams only while connected
    Given a connected, authenticated ring
    When live HR is requested
    Then the ring's daytime-HR feature is set to CONNECTED_LIVE for the duration
    And per-beat bpm samples land in the NON-persisted live buffer
    And the feature is restored to AUTOMATIC on exit

  Scenario: Live data never persists
    Given live HR samples in the live buffer
    When the app persists state
    Then live samples are excluded (AsyncStorage writes stay sync-time only)

  Scenario: Live HR is started from the HR metric screen
    Given a paired ring
    When the user taps the live button on the heart-rate metric screen
    Then a 60-second live session starts with a visible per-beat bpm readout
    And stopping (or completion) restores the ring to AUTOMATIC mode
    And a failure surfaces the readable sync error — never a stuck spinner

  Scenario: Live HR requires a paired ring
    Given no paired ring
    When the user taps the live button
    Then they are routed to pairing — no blind scan

@ring-info
Feature: Ring device info
  Data the ring exposes (battery, firmware, serial) must be visible in the app,
  not just in the debug console.

  Scenario: Paired ring shows device info
    Given a paired ring
    When the user opens the pairing screen
    Then the paired-ring card offers to read ring info
    And shows battery percent (+ charging state), firmware version, and serial
    And the read is bounded (readiness + connect timeouts) with inline errors
