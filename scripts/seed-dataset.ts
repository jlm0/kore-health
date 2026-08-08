// Generate a realistic 7-day dataset by replaying synthetic ring events
// through the REAL fold (apps/mobile/src/data/ring.ts) — the same pipeline
// the live sync uses — and write a store-seed payload for the design loop.
//
//   bun run scripts/seed-dataset.ts /tmp/seed-payload.json
//
// The payload is injected into a running dev app with:
//   __koreStore.setState(<payload>)
import { foldRingEvents, emptyFoldState, type RingEventLike } from '../apps/mobile/src/data/ring';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const nowMs = Date.now();
const localMidnight = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const todayMid = localMidnight(nowMs);

// Fallback clock anchor: newest event ≈ now. Place events by wall time.
const MAX_DS = 1_000_000_000;
const offsetMs = nowMs - MAX_DS * 100;
const ds = (wallMs: number) => Math.round((wallMs - offsetMs) / 100);

// Deterministic PRNG (mulberry32) so the seed is reproducible.
let rngState = 42;
const rnd = () => {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const jitter = (base: number, amp: number) => base + (rnd() - 0.5) * 2 * amp;

const events: RingEventLike[] = [];
const push = (wallMs: number, name: string, decoded: unknown) =>
  events.push({ tag: 0, name, timestamp: ds(wallMs), decoded });

// Per-day personality: weekend-ish variation in sleep/activity.
const NIGHTS = 7;
for (let dayIdx = NIGHTS - 1; dayIdx >= 0; dayIdx--) {
  const dayMid = todayMid - dayIdx * DAY;
  // Sleep 23:10 → 06:55 ± drift.
  const sleepStart = dayMid - HOUR + 10 * MIN + jitter(0, 20 * MIN);
  const sleepEnd = dayMid + 6 * HOUR + 55 * MIN + jitter(0, 25 * MIN);
  push(sleepStart, 'bedtime_period', {
    bedtime_start_ds: ds(sleepStart),
    bedtime_end_ds: ds(sleepEnd),
  });

  // Overnight HRV/HR windows every 30 min: deep-sleep dip toward 03:00.
  for (let t = sleepStart + 30 * MIN; t < sleepEnd - 15 * MIN; t += 30 * MIN) {
    const phase = (t - sleepStart) / (sleepEnd - sleepStart); // 0..1 through the night
    const dip = Math.sin(phase * Math.PI); // 1 mid-night
    const hrBase = 56 - 8 * dip;
    const rmssdBase = 30 + 14 * dip;
    push(t, 'hrv_event', {
      hr_bpm: Array.from({ length: 6 }, () => Math.round(jitter(hrBase, 2))),
      rmssd_ms: Array.from({ length: 6 }, () => Math.round(jitter(rmssdBase, 5))),
      interval_min: 5,
    });
  }

  // Overnight skin temp every 10 min (night mean drifts per night so the
  // deviation chart has content): NIGHT_TEMP gate is 33–37 °C.
  const nightMean = 34.6 + jitter(0, 0.35) + (dayIdx === 2 ? 0.7 : 0); // one warm night
  for (let t = sleepStart; t < sleepEnd; t += 10 * MIN) {
    push(t, 'sleep_temp_event', { temps_c: [Number(jitter(nightMean, 0.12).toFixed(2))] });
  }
  // Daytime temps hourly (excluded from nightly means, kept in abs series).
  for (let t = sleepEnd + HOUR; t < dayMid + 22 * HOUR; t += HOUR) {
    push(t, 'temp_event', { temps_c: [Number(jitter(nightMean + 0.4, 0.2).toFixed(2))] });
  }

  // Overnight SpO2 R/PI bursts every 20 min: r ≈ 0.62–0.75 → ~94–98 %.
  for (let t = sleepStart + 10 * MIN; t < sleepEnd; t += 20 * MIN) {
    push(t, 'spo2_r_pi_event', {
      r: Array.from({ length: 4 }, () => Number(jitter(0.68, 0.05).toFixed(3))),
      perfusion_index: Array.from({ length: 4 }, () => Number(jitter(0.03, 0.01).toFixed(4))),
    });
  }

  // Overnight movement: sleep_acm_period small MADs every 15 min + an
  // occasional turn.
  for (let t = sleepStart; t < sleepEnd; t += 15 * MIN) {
    const turn = rnd() < 0.08 ? 2.2 : 0.5;
    push(t, 'sleep_acm_period', {
      acm_mad: Array.from({ length: 6 }, () => Number(jitter(turn, 0.25).toFixed(2))),
    });
  }

  // Daytime: hourly activity_information (13 × 1-min MET bins). Commute-ish
  // walks morning/evening, one real run on two of the days.
  for (let h = 7; h <= 22; h++) {
    const hourStart = dayMid + h * HOUR;
    if (hourStart > nowMs - 30 * MIN) break;
    let metPeak = 1.3;
    if (h === 8 || h === 18) metPeak = 3.8; // walks
    if ((dayIdx === 1 || dayIdx === 4) && h === 17) metPeak = 8.5; // runs
    if (h >= 12 && h <= 14) metPeak = 2.1; // lunch stroll
    const mets = Array.from({ length: 13 }, (_, i) => {
      const center = Math.abs(i - 6);
      const m = 1.1 + (metPeak - 1.1) * Math.max(0, 1 - center / 5);
      return Number(jitter(m, 0.08).toFixed(2));
    });
    push(hourStart, 'activity_information', { state: 0, met: mets });
    // Motion events to match.
    for (let k = 0; k < 4; k++) {
      push(hourStart + k * 3 * MIN, 'motion_event', {
        motion_seconds: Math.round(Math.min(31, jitter((metPeak - 1) * 9, 3))),
        high_intensity: Math.round(Math.min(63, jitter((metPeak - 1) * 18, 5))),
      });
    }
  }

  // Daytime HR via ibi events every 15 min.
  for (let t = sleepEnd + 30 * MIN; t < dayMid + 23 * HOUR && t < nowMs - 10 * MIN; t += 15 * MIN) {
    push(t, 'ibi_and_amplitude_event', {
      ibi_ms: [900],
      amplitude: [100],
      hr_bpm: [Math.round(jitter(68, 6))],
    });
  }
}

events.sort((a, b) => a.timestamp - b.timestamp);

const result = foldRingEvents({
  prior: emptyFoldState(),
  events,
  goalCal: 500,
  nowMs,
});

const payload = {
  dataset: result.state.dataset,
  tempAbsSeries: result.state.tempAbsSeries,
  tempNights: result.state.tempNights,
  activityByDay: result.state.activityByDay,
  activityGoalCal: 500,
  lastSyncAt: nowMs,
  lastOpenedAt: nowMs,
  syncCursor: MAX_DS,
  latestVitals: { bpm: 67, spo2Percent: 97 },
  ringDeviceName: 'Oura 20380B2623025712',
  units: 'imperial',
};

const out = process.argv[2] ?? '/tmp/seed-payload.json';
await Bun.write(out, JSON.stringify(payload));
console.log('events:', events.length, 'applied:', result.eventsApplied, 'anchor:', result.clockAnchor);
console.log('days:', result.state.dataset.days.length);
for (const [k, v] of Object.entries(result.state.dataset.series)) {
  console.log('series', k, (v as unknown[]).length);
}
console.log('tempNights:', result.state.tempNights.length, 'activityDays:', Object.keys(result.state.activityByDay).length);
console.log('written:', out);
