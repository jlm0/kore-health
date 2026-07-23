export const palette = {
  ink: '#333947',
  slate: '#6B7280',
  muted: '#99A0B0',
  faint: '#B9BFCC',
  ghost: '#C6CBD6',
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
  card: 'rgba(255,255,255,0.52)',
  cardBorder: 'rgba(255,255,255,0.8)',
  cardFallback: 'rgba(255,255,255,0.78)',
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

export const screenGradients = {
  home: ['#F6F8FC', '#EEF1F8'],
  sleep: ['#F5F7FC', '#EEF0F8'],
  readiness: ['#F5F8FB', '#EEF2F6'],
  activity: ['#F8F7FA', '#F1F0F6'],
  trends: ['#F5F7FB', '#EFF1F7'],
} as const;

export type ScreenKey = keyof typeof screenGradients;
