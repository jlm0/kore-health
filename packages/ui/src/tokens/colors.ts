// Greyscale-first system: text and tracks are true neutrals (no blue cast),
// screens are near-white, and hue lives in charts/rings/accents only.
export const palette = {
  ink: '#23272F',
  slate: '#4A4F58',
  muted: '#5B6069',
  faint: '#7A7F89',
  ghost: '#A6AAB3',
  white: '#FFFFFF',
  mint: {
    light: '#7CCBB9',
    base: '#63B8A8',
    deep: '#4FA898',
  },
  indigo: {
    light: '#93AAEC',
    base: '#7E96E0',
    deep: '#6D87DC',
  },
  lavender: {
    light: '#C0B4EA',
    base: '#A793DD',
  },
  peach: {
    pale: '#F2CBAC',
    light: '#EFB58C',
    mid: '#E8A57E',
    deep: '#DE9468',
  },
} as const;

export const surfaces = {
  // A light veil over the iOS thin material — the blur material provides the
  // body of the glass; this just lifts it toward white. (Near-solid here
  // would smother the material and read as flat plastic again.)
  card: 'rgba(255,255,255,0.28)',
  cardBorder: 'rgba(255,255,255,0.9)',
  cardFallback: 'rgba(255,255,255,0.78)',
  cardSheen: ['rgba(255,255,255,0.5)', 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0)'],
  track: 'rgba(35,39,47,0.06)',
  trackStrong: 'rgba(35,39,47,0.08)',
  hairline: 'rgba(35,39,47,0.1)',
  gridline: 'rgba(35,39,47,0.045)',
  chipNeutral: 'rgba(35,39,47,0.05)',
} as const;

export const tints = {
  mint: 'rgba(99,184,168,0.13)',
  indigo: 'rgba(126,150,224,0.13)',
  lavender: 'rgba(167,147,221,0.14)',
  peach: 'rgba(239,181,140,0.16)',
} as const;

// Card tint gradients are dialed to a whisper: cards read as frosted white
// glass; the tint prop still differentiates a metric at a glance without
// painting the whole card.
export const cardTints = {
  mint: ['rgba(124,203,185,0.07)', 'rgba(124,203,185,0.01)'],
  indigo: ['rgba(147,170,236,0.07)', 'rgba(147,170,236,0.01)'],
  lavender: ['rgba(192,180,234,0.07)', 'rgba(192,180,234,0.01)'],
  peach: ['rgba(242,203,172,0.08)', 'rgba(242,203,172,0.015)'],
} as const;

export type CardTint = keyof typeof cardTints;

export const iconTints = {
  mint: { bg: ['#D5F1E8', '#AEE1D2'], fg: '#3E9484' },
  indigo: { bg: ['#E0E8FD', '#C2CFF7'], fg: '#5C77D6' },
  lavender: { bg: ['#EBE4FB', '#D4C8F0'], fg: '#8A72CE' },
  peach: { bg: ['#FCE6D1', '#F5C9A5'], fg: '#C97C4E' },
} as const;

export type IconTint = keyof typeof iconTints;

export const gradients = {
  readiness: [palette.mint.light, palette.mint.deep],
  sleep: [palette.indigo.light, palette.indigo.deep],
  activity: [palette.peach.light, palette.peach.deep],
  spo2: [palette.indigo.light, palette.mint.base],
} as const;

export const stageColors = {
  deep: '#6E86D8',
  rem: '#9FB8EC',
  light: '#C0B4EA',
  awake: '#E8B79E',
} as const;

export type StageKey = keyof typeof stageColors;

// One neutral backdrop for every screen — hue belongs to data, not chrome.
// Keys stay so screens can re-differentiate later without call-site changes.
export const screenBase = {
  home: '#F4F5F7',
  sleep: '#F4F5F7',
  readiness: '#F4F5F7',
  activity: '#F4F5F7',
  trends: '#F4F5F7',
} as const;

export type ScreenKey = keyof typeof screenBase;
