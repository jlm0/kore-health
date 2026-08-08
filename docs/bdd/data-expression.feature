# How each data group is expressed: immediate vs. over-time
#
# Every metric has THREE distinct kinds of value, and the UI must never blur
# them:
#
#   NOW     — the freshest immediate reading (live stream, ring's cached
#             latest, or newest sample). Available whenever the ring has
#             reported at least once.
#   TODAY   — the current day's raw series (24h curve, min/max). Available
#             with any data today.
#   TREND   — derived, longitudinal insight (nightly averages, baselines,
#             scores). Only meaningful after enough history exists.
#
# Each group therefore has a maturity state, and every card/screen renders
# according to it:
#
#   none        → numeric 0 + when it arrives ("Measured during sleep")
#   collecting  → NOW + TODAY shown raw; TREND shows what it needs
#                 ("Baseline builds over 2+ nights")
#   ready       → full derived values
#
# Absent values always render as a numeric 0 — never a dash and never an
# invented non-zero. The unlock copy next to the 0 explains why it is 0.
#
# Groups:
#
#   Heart rate   NOW: live/latest bpm. TODAY: 24h curve + range.
#                TREND: resting HR (night-derived — needs 1 night).
#   HRV          NOW: none (night-only measurement).
#                TREND: nightly RMSSD avg + 14d trend (needs 1 night).
#   Temperature  NOW: latest absolute skin temp. TODAY: 24h absolute curve.
#                TREND: nightly deviation vs 7-night baseline (needs 2 nights).
#   SpO2         NOW: latest %. TREND: nightly average (needs ring to emit
#                summarized events — may stay none; never invented).
#   Sleep        TREND only: window, stages, efficiency, score (needs 1
#                detected sleep window).
#   Activity     TODAY: calories, active minutes, movement curve.
#                TREND: daily totals over time.
#   Readiness    TREND only: composite score + contributors (needs 1 night —
#                a sleep window alone unlocks it; missing signals score as
#                neutral contributors).

@expression
Feature: Data-expression maturity

  Scenario Outline: Cards and detail screens follow the maturity model
    Given a metric group in state <maturity>
    When its home card or detail screen renders
    Then NOW and TODAY values show real data when they exist
    And absent values render as numeric 0 with their unlock copy — never a
    dash, never an invented number

    Examples:
      | group     | none display              | collecting unlock        | ready requires |
      | HR        | 0 bpm                     | resting HR after 1 night | 1 night      |
      | HRV       | 0 ms + "Measured during sleep" | —                   | 1 night      |
      | Temp      | 0.0 °                     | baseline after 2 nights  | 2 nights     |
      | SpO2      | 0 %                       | —                      | 1 summarized event |
      | Sleep     | score 0                   | —                      | 1 sleep window |
      | Activity  | score 0                   | —                      | any movement data |
      | Readiness | score 0 + "Wear your ring tonight" | —           | 1 night (window, HRV, or RHR) |

  Scenario: A day-1 user sees honest collecting states everywhere
    Given only daytime data from a first partial day
    When the user opens home and every sub-route
    Then HR/temp/activity show real NOW+TODAY data
    And HRV/SpO2/readiness show 0 with copy explaining they arrive after tonight
    And no screen invents a non-zero value, a flat line, or a fake trend

  Scenario: Night-backed headlines agree between home and detail
    Given at least one night where HRV or resting HR was measured
    Then the home card and the metric detail headline show the SAME latest
    nightly value — never today's 0 while a previous night has a real one
    And a raw daytime HR sample never poses as the resting-HR headline

  Scenario: A live HR session never shows a placeholder 0
    Given a live heart-rate session
    Then no "0 bpm" readout appears before the first valid beat — 0 is a
    reading, not a placeholder
    And the ring's CONNECTED_LIVE mode switch is confirmed by response —
    a rejected switch fails the session immediately instead of waiting
    And a full session with zero valid beats ends with an explicit
    "no signal" error, not a silent 0

  Scenario: Charts carry real axis labels and scrubbing
    Given any chart on a metric, sleep, activity, or trends screen
    Then the x axis shows real clock times (or day labels for multi-day trends)
    # never relative offsets like "-6h" — always the phone's local time
    And value charts show min/max y labels where they read cleanly
    When the user taps or drags across an interactive chart
    Then a guide line + tooltip show the exact value and time at that point
    And a haptic tick fires as the selection moves between points
    And a mostly-vertical drag scrolls the page instead of scrubbing

  Scenario: Every touch interaction has haptic feedback
    Given any interactive element (pill, card, circle button, toggle)
    When the user taps it
    Then a Pulsar preset plays — peck for taps, snap for selections,
    strike for primary confirmations, flick for chart scrubbing

  Scenario: Every touch target meets the 48pt floor
    Given any interactive element
    Then its effective touch target is at least 48×48 pt — small visuals
    (pills, circle icons, text links) reach it via hitSlop, never by
    shrinking below the floor (shared helper: ui/touch.ts)
