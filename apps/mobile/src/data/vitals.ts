import type { LatestValues } from '../ring/client';
import type { LatestVitals } from '../store/health';

// Merge the per-feature featureLatest reads into one LatestVitals. The ring
// reports null for anything it has no current value for (off the finger,
// feature not run yet) — nulls propagate, never become 0. Returns null when
// neither feature produced anything, so callers keep the previous reading
// instead of blanking the readouts.
export function mergeLatestVitals(
  daytimeHr: LatestValues,
  spo2: LatestValues | null,
): LatestVitals | null {
  const bpm = daytimeHr.bpm ?? spo2?.bpm ?? null;
  const spo2Percent = daytimeHr.spo2Percent ?? spo2?.spo2Percent ?? null;
  if (bpm == null && spo2Percent == null) return null;
  return { bpm, spo2Percent };
}
