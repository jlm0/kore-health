export const palette = {
  ink: '#333947',
  slate: '#5A6270',
  muted: '#61697A',
  faint: '#788093',
  ghost: '#A9B0BF',
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
  card: 'rgba(255,255,255,0.62)',
  cardBorder: 'rgba(255,255,255,0.8)',
  cardFallback: 'rgba(255,255,255,0.72)',
  cardSheen: ['rgba(255,255,255,0.4)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0)'],
  track: 'rgba(51,57,71,0.07)',
  trackStrong: 'rgba(51,57,71,0.08)',
  hairline: 'rgba(51,57,71,0.12)',
  gridline: 'rgba(51,57,71,0.05)',
  chipNeutral: 'rgba(51,57,71,0.05)',
} as const;

export const tints = {
  mint: 'rgba(99,184,168,0.13)',
  indigo: 'rgba(126,150,224,0.13)',
  peach: 'rgba(239,181,140,0.16)',
} as const;

export const cardTints = {
  mint: ['rgba(124,203,185,0.14)', 'rgba(124,203,185,0.02)'],
  indigo: ['rgba(147,170,236,0.14)', 'rgba(147,170,236,0.02)'],
  lavender: ['rgba(192,180,234,0.14)', 'rgba(192,180,234,0.02)'],
  peach: ['rgba(242,203,172,0.16)', 'rgba(242,203,172,0.03)'],
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

export const screenBase = {
  home: '#CBD3EE',
  sleep: '#BCC8EC',
  readiness: '#BFE7C9',
  activity: '#F6D8C5',
  trends: '#F5DBDE',
} as const;

export type ScreenKey = keyof typeof screenBase;
