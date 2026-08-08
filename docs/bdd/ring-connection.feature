# Ring discovery, pairing, and connection lifecycle
#
# Actors:
#   New user       — no ringDeviceId / ringAuthKey stored (fresh install, or after Forget)
#   Returning user — ringDeviceId + ringAuthKey persisted from an earlier pairing
#
# Glossary:
#   "paired"  — the app holds a device id + 16-byte AES auth key for the ring
#   "factory-reset ring" — a ring with no auth key installed (pairing possible)
#   "onboarded ring"     — a ring whose key belongs to the official Oura app

@discovery
Feature: Ring discovery
  The app must never scan before the Bluetooth stack is ready, and must let the
  user identify their own ring when several are nearby.

  Scenario: Bluetooth stack must be ready before any scan
    Given the app has never requested Bluetooth permission
    When the user starts pairing
    Then the OS Bluetooth permission prompt is shown first
    And no scan starts until the adapter state is PoweredOn

  Scenario: Bluetooth turned off
    Given Bluetooth is off on the phone
    When the user starts pairing
    Then the error reads "Turn on Bluetooth to sync your ring"
    And no scan is attempted

  Scenario: Permission denied
    Given the user denied Bluetooth permission
    When the user starts pairing
    Then the error reads "Bluetooth permission denied — enable it in Settings"

  Scenario: Multiple rings nearby
    Given two or more Oura rings are advertising nearby
    When the scan runs
    Then each ring is listed with its name, short id, and signal strength
    And the user chooses which ring to pair — the app never auto-picks

  Scenario: No rings found
    Given no ring is advertising nearby
    When the scan window (10 s) elapses
    Then the message says no rings were found and offers Rescan

@pairing @new-user
Feature: Pairing (new user)

  Scenario: Pair a factory-reset ring
    Given a factory-reset ring is advertising
    When the user taps it in the scan list
    Then the app shows progress: Connecting → Pairing → Authenticating → Syncing time → Enabling sensors
    And a fresh 16-byte key is installed on the ring and persisted locally
    And every measurement feature (daytime HR, resting HR, SpO2) is set AUTOMATIC
    # self-paired rings ship with features OFF — pairing turns all of them on
    # and resets the user's feature prefs to all-enabled
    And the first history sync starts automatically afterwards

  Scenario: Ring wiped its bond (post factory reset)
    Given the ring just factory-reset and removed its pairing information
    When the app connects and iOS reports "peer removed pairing information"
    Then the app retries the connect once automatically — iOS re-bonds
    And if it persists, the error says to remove the ring in Settings → Bluetooth
    # apps cannot delete iOS bonds programmatically — detection + guidance is
    # the best available UX

  Scenario: Pairing recovers from a lost key-install response
    Given the ring applied our key but its response never arrived
    # happens when an OS bonding dialog blocks BLE traffic mid-exchange
    When set_auth_key fails or is refused
    Then the client authenticates with the same generated key as a probe
    And if auth succeeds the key is kept — the ring is never left holding an
    unknown key (which would force another factory reset)

  Scenario: Ring already onboarded to the official Oura app
    Given an onboarded ring whose key belongs to the official app
    When the user tries to pair
    Then authentication fails with a readable "ring rejected authentication" message
    And the user is told the ring must be factory-reset (or its existing key extracted)
    And no partial pairing is persisted

  Scenario: Every pairing step is bounded
    Given the ring stops responding mid-pairing
    When any step exceeds its timeout (connect 30 s, request quiet window)
    Then the error is shown inline with a Retry option
    And scanning resumes so another ring can be picked

@reconnect @returning-user
Feature: Reconnection (returning user)

  Scenario: App relaunch remembers the ring
    Given the user previously paired a ring
    When the app is killed and relaunched
    Then ringDeviceId and ringAuthKey are restored from AsyncStorage
    And the home screen offers one-tap sync (the status line) — no re-pairing

  Scenario: Ring management is always reachable
    Given any pairing state — none, paired, or a stale saved id
    When the user taps the Bluetooth icon in the home header
    Then the pairing screen opens (scan, paired-ring card, Forget)
    # without this, a stale saved id traps the user in failing one-tap syncs
    # with no way back to the scan list

  Scenario: Paired screen is about YOUR ring
    Given a paired ring
    When the pairing screen opens
    Then the paired-ring card is the focus and scanning does NOT auto-start
    And nearby-ring discovery sits behind an explicit "Pair a different ring" action
    And tapping a nearby ring is refused with "Forget your current ring first"

  Scenario: One-tap sync re-authenticates
    Given a paired ring
    When the user taps sync
    Then the app connects to the saved device id and authenticates with the stored key
    # the ring requires re-authentication on EVERY connection

  Scenario: Reconnect survives the ring's rotating address
    Given the ring's BLE address has rotated since pairing (RPA)
    When a sync's connect to the saved id fails
    Then the app re-discovers the ring by its advertised NAME, refreshes the
    saved id, and retries once — the user never re-pairs over address rotation

  Scenario: Sync enables measurement features and triggers sleep analysis
    Given a connected, authenticated ring on any sync
    When the drain begins
    Then each user-enabled feature (daytime HR, resting HR, SpO2) is AUTOMATIC
    # self-paired rings ship with all of these OFF — no resting-HR feature,
    # no overnight HRV/RHR data. Features the user toggled OFF are left off.
    And check_sleep_analysis has been triggered first
    # sleep events (bedtime_period) only enter history after the ring runs
    # its analysis — the official app does this on open

  Scenario: Sensor toggles on the metric routes
    Given a paired ring
    When the user flips a sensor toggle on the HRV, resting-HR, or SpO2 route
    Then the app connects and sets that feature AUTOMATIC or OFF on the ring
    And the choice persists in featurePrefs — later syncs never re-enable it
    And a failed change reverts the toggle and shows the error inline
    # temp has no toggle: skin temperature needs no feature mode

  Scenario: App auto-syncs in the foreground
    Given a paired ring
    When the app launches or returns to the foreground
    Then a sync starts automatically — no tap needed
    But not more than once per 5 minutes (reopening doesn't hammer the ring)
    And never while another sync/connection is in progress
    # a 5-minute cadence timer also retries while the app stays open, so a
    # ring that comes back in range is picked up without user action

  Scenario: Periodic background sync
    Given a paired ring and the expo-background-task entitlement built in
    When the OS wakes the app on its own cadence (hourly hint; OS decides)
    Then a headless sync runs: state rehydrates from storage, ring connects,
    authenticates, drains from the cursor, persists, disconnects
    And with no paired ring the task is a no-op

  Scenario: Ring out of range
    Given a paired ring that is not advertising
    When the user taps sync
    Then connect times out after 30 s with a keep-nearby-or-re-pair message
    And the status line shows "Sync failed — tap to retry"
    And the pairing is NOT forgotten

  Scenario: Forget ring returns to new-user state
    Given a paired ring
    When the user taps "Forget this ring"
    Then ringDeviceId, ringAuthKey, and the sync cursor are cleared
    And the app behaves as a new user on the next sync attempt

  Scenario: Same ring, different phone
    Given a ring paired on the user's iPhone
    When the user pairs the same ring on an Android phone
    Then pairing works with the SAME auth key (the key lives on the ring)
    # note: iOS peripheral UUIDs are per-phone; the Android device id will differ,
    # so each phone stores its own ringDeviceId — identity is the key, not the id

@disconnect
Feature: Disconnection handling

  Scenario: Ring disconnects mid-sync
    Given a sync that has drained several event batches
    When the link drops
    Then every completed batch's cursor progress is already persisted
    And the error is surfaced via the status line
    And the next sync resumes from the last persisted cursor — not from zero

  Scenario: Sync always releases the status
    Given any failure during connect, auth, or drain
    When the failure occurs
    Then connectionStatus returns to 'disconnected' with a readable syncError
    And the UI can never stick at "Syncing…"

  Scenario: Repeated BLE operations never kill the adapter
    Given a completed or failed sync, pairing attempt, or ring-info read
    When the user starts another one
    Then it works — no "BleManager was destroyed" error
    # ble-plx's native layer is a process singleton: the app uses ONE shared
    # BleManager (getBleManager) and never calls destroy() mid-session.

  Scenario: User leaves the app mid-sync
    Given a sync in progress
    When the app is backgrounded and the OS drops the BLE link
    Then the transport is torn down cleanly
    And the next foreground sync resumes from the persisted cursor
