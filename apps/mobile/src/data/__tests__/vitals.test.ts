import { describe, expect, it } from 'bun:test';
import { mergeLatestVitals } from '../vitals';

// Covers ring-sync-data.feature @ux "Latest values are automatic on every
// sync": the per-feature featureLatest reads merge into one LatestVitals,
// empty readings stay null (never 0), and a fully empty read returns null so
// the caller keeps the previous reading.

describe('mergeLatestVitals', () => {
  it('takes bpm from daytime HR and spo2 from the SpO2 feature', () => {
    expect(
      mergeLatestVitals(
        { bpm: 62, spo2Percent: null },
        { bpm: 60, spo2Percent: 97 },
      ),
    ).toEqual({ bpm: 62, spo2Percent: 97 });
  });

  it('falls back to the SpO2 feature bpm when daytime HR has none', () => {
    expect(
      mergeLatestVitals(
        { bpm: null, spo2Percent: null },
        { bpm: 55, spo2Percent: 96 },
      ),
    ).toEqual({ bpm: 55, spo2Percent: 96 });
  });

  it('keeps nulls null — empty means no current value, not 0', () => {
    expect(
      mergeLatestVitals({ bpm: 70, spo2Percent: null }, null),
    ).toEqual({ bpm: 70, spo2Percent: null });
  });

  it('returns null when neither feature produced anything', () => {
    expect(mergeLatestVitals({ bpm: null, spo2Percent: null }, null)).toBeNull();
    expect(
      mergeLatestVitals({ bpm: null, spo2Percent: null }, { bpm: null, spo2Percent: null }),
    ).toBeNull();
  });
});
