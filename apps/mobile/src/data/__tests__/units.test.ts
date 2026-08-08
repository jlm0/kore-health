import { describe, expect, test } from 'bun:test';
import { tempUnit, toDisplayTemp, toDisplayTempDelta } from '../units';

describe('toDisplayTemp — absolute temperature', () => {
  test('metric passes °C through, rounded to 1 decimal', () => {
    expect(toDisplayTemp(36.6, 'metric')).toBe(36.6);
    expect(toDisplayTemp(36.25, 'metric')).toBe(36.3);
  });

  test('imperial applies °F = °C × 9/5 + 32', () => {
    expect(toDisplayTemp(36.6, 'imperial')).toBe(97.9);
    expect(toDisplayTemp(37, 'imperial')).toBe(98.6);
  });

  test('zero and negative values', () => {
    expect(toDisplayTemp(0, 'imperial')).toBe(32);
    expect(toDisplayTemp(-10, 'imperial')).toBe(14);
    expect(toDisplayTemp(-40, 'imperial')).toBe(-40);
    expect(toDisplayTemp(-10, 'metric')).toBe(-10);
  });
});

describe('toDisplayTempDelta — deviation, NO +32 offset', () => {
  test('Δ°F = Δ°C × 9/5 only', () => {
    expect(toDisplayTempDelta(0.5, 'imperial')).toBe(0.9);
    expect(toDisplayTempDelta(1, 'imperial')).toBe(1.8);
    expect(toDisplayTempDelta(0.3, 'imperial')).toBe(0.5);
  });

  test('zero stays zero — never +32', () => {
    expect(toDisplayTempDelta(0, 'imperial')).toBe(0);
  });

  test('negative deltas keep their sign', () => {
    expect(toDisplayTempDelta(-0.5, 'imperial')).toBe(-0.9);
    expect(toDisplayTempDelta(-1, 'imperial')).toBe(-1.8);
  });

  test('metric passes the delta through unchanged', () => {
    expect(toDisplayTempDelta(0.5, 'metric')).toBe(0.5);
    expect(toDisplayTempDelta(-0.56, 'metric')).toBe(-0.6);
  });
});

describe('tempUnit', () => {
  test('unit label per system', () => {
    expect(tempUnit('imperial')).toBe('°F');
    expect(tempUnit('metric')).toBe('°C');
  });
});
