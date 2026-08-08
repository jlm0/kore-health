# BDD compliance — Oura ring integration

Compliance of `apps/mobile/src/{ring,data,store,app}` against the behavior
contracts in `ring-connection.feature`, `ring-sync-data.feature` and
`data-expression.feature`.
Automatable scenarios are verified by `bun test` (see test names); BLE/OS-level
scenarios are verified by code review and marked @manual where real hardware
is required to exercise them end to end.

## ring-connection.feature

| Scenario | Status | Evidence |
| --- | --- | --- |
| Bluetooth stack must be ready before any scan | PASS (code review) + @manual | `waitForBluetoothReady()` gates every scan/connect (`src/app/pair.tsx:78`, `src/ring/sync.ts:58`); constructing the BleManager triggers the iOS prompt, Android runtime perms via `ensureBlePermissions` (`src/ring/bluetooth.ts:17`). OS prompt itself needs a device |
| Bluetooth turned off | PASS (code review) | Exact message "Turn on Bluetooth to sync your ring" thrown before any scan (`src/ring/bluetooth.ts:88`) |
| Permission denied | PASS (code review) | Exact message "Bluetooth permission denied — enable it in Settings" for Android denial + iOS Unauthorized (`src/ring/bluetooth.ts:53,96`) |
| Multiple rings nearby | PASS (code review) + @manual | List shows name, short id, RSSI bars; user taps to pick, no auto-pick (`src/app/pair.tsx:264`); sync with no saved id refuses to scan (`src/ring/sync.ts:21`) |
| No rings found | PASS (code review) | 10 s window (`SCAN_TIMEOUT_MS`, `src/ring/constants.ts:9`) → "No rings found…" + Rescan (`src/app/pair.tsx:246-261`) |
| Pair a factory-reset ring | PASS (code review) + @manual | Steps Connecting → Pairing → Authenticating → Syncing time (`src/app/pair.tsx:137-163`); fresh 16-byte key installed and persisted after auth; first sync starts automatically (`pair.tsx:169`) |
| Ring already onboarded to the official Oura app | FIXED | Auth failure now names the rejection AND tells the user to factory-reset / extract the key (`src/app/pair.tsx:158-163`); fresh key is persisted only after auth succeeds — no partial pairing (`pair.tsx:166-168`) |
| Every pairing step is bounded | PASS (code review) + @manual | Connect 30 s `withTimeout` (`pair.tsx:138-142`); each request bounded by the 1.5 s response quiet window (`src/ring/client.ts:178-201`); inline error + Retry, scanning resumes (`pair.tsx:170-181`) |
| App relaunch remembers the ring | PASS (code review) | zustand persist restores `ringDeviceId`/`ringAuthKey` via partialize (`src/store/health.ts:96-107`); home offers one-tap sync (`src/app/index.tsx:66-75`) |
| One-tap sync re-authenticates | PASS (code review) | `authenticateClient` runs on every sync (`src/ring/sync.ts:65`) |
| Ring out of range | PASS (code review) | 30 s timeout with "keep the ring nearby … or re-pair" (`src/ring/sync.ts:24-28`); status line "Sync failed — tap to retry" (`src/app/index.tsx:82`); catch path never clears the pairing |
| Forget ring returns to new-user state | PASS (`useHealthStore — forgetRing`) | `forgetRing` clears id + key + cursor (`src/store/health.ts:76`); persisted payload verified |
| Same ring, different phone | PASS (code review) + @manual | Pairing reuses a stored key instead of installing a new one (`src/app/pair.tsx:146`); identity is the key, per-phone device id |
| Ring disconnects mid-sync | PASS (code review) + @manual | Cursor persisted per batch via `onBatch` → `setSyncCursor` (`src/ring/sync.ts:76`, `src/ring/client.ts:341-344`); error surfaces via `syncError`; next sync resumes at the cursor |
| Sync always releases the status | PASS (code review) | try/catch/finally always returns to `'disconnected'` with readable `syncError` (`src/ring/sync.ts:99-115`) |
| User leaves the app mid-sync | @manual | OS backgrounding drops the link; the finally block tears the transport down and the persisted cursor carries progress — needs a device to exercise |

## ring-sync-data.feature

| Scenario | Status | Evidence |
| --- | --- | --- |
| First sync drains from the beginning | PASS (code review) | `drainEvents(cursor)` batches of ≤255, stops at `bytesLeft = 0` or no progress (`src/ring/client.ts:309-349`); BLE I/O itself @manual |
| Incremental sync resumes at the cursor | PASS (code review) | Drain starts at persisted `syncCursor` (`src/ring/sync.ts:73-74`) |
| Clock is synced before every drain | PASS (code review) | `client.syncTime()` immediately before drain (`src/ring/sync.ts:68`) |
| Clock anchor fallback | PASS (`foldRingEvents — clock anchoring`) | time_sync anchor, newest-event ≈ now fallback, `clockAnchor` records `time_sync \| newest_event \| none` (`src/data/ring.ts:175-191`) |
| Interrupted sync keeps its progress | PASS (code review) | Per-batch cursor + fold seeds from persisted state (`src/data/ring.ts:200-218`) |
| One atomic persist per sync | PASS (`useHealthStore — atomic sync persist`) | Single `applySyncResult` → exactly one AsyncStorage write; partialize verified (`src/store/health.ts:80-107`) |
| Per-beat heart rate is bucketed | PASS (`foldRingEvents — per-beat heart rate grid bucketing`) | 3-min bucket means keyed at bucket start |
| HRV windows map to the grid | PASS (`foldRingEvents — hrv_event windows`) | event-time + i×interval on hr and hrv |
| Temperature becomes deviation from a personal baseline | PASS (`foldRingEvents — temperature baseline and deviation`) | 25–40 °C filter, night-hours means keyed to wake day, median-of-≤7-preceding baseline, 0 until a baseline exists |
| SpO2 is never invented | PASS (`foldRingEvents — SpO2 is never invented`) | `spo2_r_pi` ignored; only `spo2_event` feeds the series |
| Steps are reported as zero until validated | PASS (`buildDaySummary — night-derived metrics`, `computeActivity`) | steps/kmEquiv always 0 (documented gap, not a bug) |
| Movement blends the ring's motion signals | PASS (`foldRingEvents — movement blends and MET calories`) | duty+intensity, MAD/4, (MET−1)/8 blends verified |
| Calories come from MET bins | PASS (`foldRingEvents — movement blends and MET calories`) | (MET−1)×3.5×70/200 at MET ≥ 1.5; active minutes at MET ≥ 3 |
| Dataset is trimmed to 30 days | FIXED + PASS (`foldRingEvents — 30-day trim`) | Series/days/tempNights were trimmed; `activityByDay` now trimmed too (`src/data/ring.ts:402-410`) |
| Sleep windows come from the ring's bedtime detection | PASS (`foldRingEvents — bedtime windows`) | Wake-day attribution (t + 12 h midnight); <1 h / >16 h windows ignored |
| Sleep staging is a documented actigraphy heuristic | PASS (`computeSleep — actigraphy staging heuristic`) | move ≥ 0.12 awake / HR-nadir deep / HR-peak REM / else light; latency = first 3 asleep epochs; efficiency = asleep/in-bed |
| Scores are transparent composites with neutral fallbacks | PASS (`sleepScore`, `computeReadiness`) | Clamped 0–100; missing contributors = neutral 0.5 |
| Resting HR and HRV averages are night-derived | PASS (`buildDaySummary — night-derived metrics`) | Lowest 30-min rolling mean; night RMSSD mean |
| Re-folding the same sync is stable | PASS (`foldRingEvents — refold stability and purity`) | Zero-new-event refold is byte-identical; prior state never mutated |
| Connection state is visible at a glance | PASS (code review) + @manual | Header status element always shows Connect ring / Syncing… / Synced X ago / Sync failed — reason (`src/app/index.tsx:94-113`); tapping it opens `/pair` |
| We never claim a persistent connection | PASS (code review) | Status is derived from `connectionStatus`/`lastSyncAt`/`syncError` only — the "Synced 2m ago" state (`src/app/index.tsx:102-104`); no "Connected" string anywhere in the UI |
| Header controls meet touch standards | PASS (code review) + @manual | GlassCircle hitSlop 10 → 52×52 pt targets on 32 pt visuals (`packages/ui/src/components/GlassCircle.tsx:19`); status Pressable padded+hitSlop to ≥44 pt (`src/app/index.tsx:129-152`); tiny "Ring"/"Trends" labels under both header glyphs |
| Latest values are automatic on every sync | PASS (`mergeLatestVitals`, `useHealthStore — setLatestVitals persists`) + @manual | After the drain, `featureLatest(DAYTIME_HR)` + `featureLatest(SPO2)` merge into persisted `latestVitals` (`src/ring/sync.ts:126-148`, `src/data/vitals.ts`); failures are non-fatal, empty stays null; `useLatestSample` prefers live → latestVitals → last synced sample (`src/data/hooks.ts:41-56`) |
| Live streaming is one tap away, never silent | PASS (code review) | Same evidence as "Live HR is started from the HR metric screen" below — streams only from the Live card, no background stream exists |
| One ring at a time, re-pair is explicit | PASS (code review) | Pairing a second ring is refused until Forget (`src/app/pair.tsx:150-152`); Forget = disconnect + clear credentials + cursor (`src/store/health.ts`, `pair.tsx:460`) |
| Sync enables measurement features and triggers sleep analysis | PASS (code review) + @manual | Every sync sets the user-enabled features AUTOMATIC before the drain and runs `check_sleep_analysis` + 3 s settle (`src/ring/sync.ts:109-133`); features the user toggled off are skipped |
| Empty states render numeric 0, never invented values | PASS (code review) + @manual | Absent values show 0 with the group's unlock copy beside them (home HRV/RHR/temp/SpO2 cards, readiness/sleep/activity rings, metric-screen Current — `src/app/index.tsx`, `src/app/metric/[id].tsx`); no screen invents a non-zero reading, and charts/trends stay hidden until real points exist; trends deltas hidden until a prior week exists (`src/app/trends.tsx`) |
| Sensor toggles on the metric routes | PASS (code review) + @manual | About-card toggle on hrv/rhr/spo2 routes → `setRingFeature` connects + sets AUTOMATIC/OFF (`src/ring/sync.ts:273-310`); optimistic pref in persisted `featurePrefs` reverts on failure with inline error (`src/app/metric/[id].tsx`); sync applies only user-enabled features (`src/ring/sync.ts:114-127`); temp has no toggle — no feature mode exists for it |
| Live HR streams only while connected | PASS (code review) + @manual | CONNECTED_LIVE set for the duration, AUTOMATIC restored in finally (`src/ring/client.ts:403-436`); samples go to the separate non-persisted live store |
| Live data never persists | PASS (`useLiveStore — live HR never persists`) | Live buffer in its own store, excluded from partialize; zero storage writes |
| Live HR is started from the HR metric screen | PASS (code review) + @manual | Live card on the hr-series metric screen (`src/app/metric/[id].tsx:158-240`): start → `streamLiveHeartRate(60)`, per-beat bpm + rolling sparkline from `useLiveStore`; stop via `stopLiveHeartRate()` (`src/ring/sync.ts:20`) or natural completion — both restore AUTOMATIC in the client; failure captured from `syncError` and shown as text, never a stuck spinner |
| Live HR requires a paired ring | PASS (code review) | No `ringDeviceId` → `router.push('/pair')`, no blind scan (`src/app/metric/[id].tsx:80-84`) |
| Paired ring shows device info | PASS (code review) + @manual | "Read ring info" on the paired card (`src/app/pair.tsx:219-276`): readiness gate → connect with 30 s timeout → authenticate with stored key → battery/firmware/serial → disconnect; per-step inline progress in the Pill, readable inline errors, last good read cached in component state (display-only, not persisted) |

## data-expression.feature

The NOW / TODAY / TREND maturity model is centralized in
`src/data/maturity.ts` (`deriveMaturity` / `deriveMaturities` / `MATURITY_COPY`)
and consumed via `useMaturities()` (`src/data/hooks.ts`). All unlock/empty copy
is defined once in `MATURITY_COPY`.

| Scenario | Status | Evidence |
| --- | --- | --- |
| Cards and detail screens follow the maturity model | PASS (`deriveMaturity — *`, 22 tests) + code review | Per-group state + trend gates verified for hr/hrv/temp/spo2/sleep/activity/readiness (`src/data/__tests__/maturity.test.ts`); home cards render the NOW value or 0 + unlock copy (`src/app/index.tsx` — HRV shows "Measured during sleep", RHR "Resting HR after 1 night of sleep", temp "Baseline builds over 2+ nights"); metric TREND card shows the unlock requirement until `trendReady` (`src/app/metric/[id].tsx`) |
| A day-1 user sees honest collecting states everywhere | PASS (code review) + @manual | Daytime-only data: HR/temp/activity show real NOW+TODAY; HRV/SpO2/readiness show 0 with copy saying data arrives after tonight's sleep (`src/app/index.tsx`, `src/app/readiness.tsx`); sleep/activity empty copy says when data arrives (`src/app/sleep.tsx`, `src/app/activity.tsx`); no screen invents a non-zero value, flat line, or fake trend |
| Readiness unlocks on any night signal | PASS (`deriveMaturity — readiness`, `hasNightData`) | A sleep window alone marks the day night-backed — a night can yield its window before HRV/resting HR land (`src/data/maturity.ts:137-146`, `src/data/selectors.ts:105-113`); home card and readiness route read the same gate, so they always agree |
| Charts carry real axis labels and scrubbing | PASS (code review) + @manual | `Sparkline`/`BarChart` take `xLabels`/`yLabels`; the metric 24h chart shows real clock times via `fmtClock`, never "-6h" offsets (`packages/ui/src/components/Sparkline.tsx`, `src/app/metric/[id].tsx`); `interactive` charts scrub with guide line + tooltip + haptic tick, and bail to scroll on vertical drags |
| Night-backed headlines agree between home and detail | PASS (code review) + @manual | Both surfaces headline HRV/resting HR via `latestPositiveDayValue` — the most recent real nightly value (`src/data/selectors.ts`, `src/app/index.tsx`, `src/app/metric/[id].tsx`); the detail headline is labeled "Latest night" and a raw daytime HR sample can no longer pose as resting HR |
| A live HR session never shows a placeholder 0 | PASS (code review) + @manual | No bpm readout renders before the first valid beat — waiting copy instead (`src/app/metric/[id].tsx`); `liveHeartRate` enables CONNECTED_LIVE via `setFeatureMode` so a rejected mode switch throws immediately, logs non-beat frames for diagnosis, and a full session with zero beats raises an explicit "no signal" error (`src/ring/client.ts`) |
| Every touch interaction has haptic feedback | PASS (code review) + @manual | `haptics` (react-native-pulsar presets) wired into Pill (snap), GlassCard (peck), GlassCircle (peck), header sync (strike) (`packages/ui/src/haptics.ts`); lazily required — missing native module disables haptics, never breaks the tap |
| Every touch target meets the 48pt floor | PASS (code review) + @manual | Shared `MIN_TOUCH_TARGET`/`touchSlop` helper (`packages/ui/src/touch.ts`); Pill hitSlop lifts ~20pt pills to 48 (`Pill.tsx`), GlassCircle computes slop from its size (`GlassCircle.tsx`), header icon+label columns are 48×48 (`src/app/index.tsx`), pair-screen text links 50pt (`src/app/pair.tsx`), debug buttons have real `minHeight: 48` (`src/app/ring-debug.tsx`) |

## Bugs found and fixed in this pass

1. **Partial pairing persisted on auth failure** — `src/app/pair.tsx`: a freshly
   installed key was written to the store *before* authentication; a ring that
   rejected auth left a half-paired key behind. The key is now persisted only
   after auth succeeds, and the failure message tells the user to factory-reset
   the ring (or extract its key).
2. **Fold mutated the prior persisted state** — `src/data/ring.ts`: MET-bin
   accumulation added calories/minutes into the *prior* `DayActivityTotals`
   objects in place (shallow-copied record, shared values), breaking the fold's
   purity contract and risking double-counting after a failed sync. Accumulation
   now copies the totals object first.
3. **`activityByDay` never trimmed** — `src/data/ring.ts`: the persisted
   per-day activity map grew without bound while series/days/tempNights were
   trimmed to 30 days. It is now trimmed to the same 30-day window.

## Running the checks

```sh
bun test            # 65 tests across src/data and src/store (bun's runner)
bun run typecheck   # tsc -p packages/ui && tsc -p apps/mobile
```

Feature files: `ring-connection.feature`, `ring-sync-data.feature`,
`data-expression.feature`.
