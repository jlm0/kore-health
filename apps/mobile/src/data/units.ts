// Display-unit conversion. The store and data layer stay in °C (what the
// ring reports); conversion happens ONLY at display time via these helpers.
export type Units = 'imperial' | 'metric';

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Absolute temperature: °F = °C × 9/5 + 32, rounded to 1 decimal. */
export function toDisplayTemp(c: number, u: Units): number {
  return u === 'imperial' ? round1((c * 9) / 5 + 32) : round1(c);
}

/**
 * Deviation/delta: Δ°F = Δ°C × 9/5 — NO +32 offset (a +0.5 °C deviation is
 * +0.9 °F, not +32.9). Rounded to 1 decimal.
 */
export function toDisplayTempDelta(c: number, u: Units): number {
  return u === 'imperial' ? round1((c * 9) / 5) : round1(c);
}

export function tempUnit(u: Units): '°F' | '°C' {
  return u === 'imperial' ? '°F' : '°C';
}
