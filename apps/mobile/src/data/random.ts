export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: Rng, mean = 0, stdDev = 1): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function pickWeighted<T>(rng: Rng, entries: [T, number][]): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

export function smoothNoise(rng: Rng, length: number, octaveLength: number): number[] {
  const anchors: number[] = [];
  const anchorCount = Math.ceil(length / octaveLength) + 2;
  for (let i = 0; i < anchorCount; i++) anchors.push(rng() * 2 - 1);
  const out: number[] = [];
  for (let i = 0; i < length; i++) {
    const pos = i / octaveLength;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const eased = frac * frac * (3 - 2 * frac);
    out.push(anchors[idx] * (1 - eased) + anchors[idx + 1] * eased);
  }
  return out;
}
