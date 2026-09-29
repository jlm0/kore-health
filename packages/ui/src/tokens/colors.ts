// Brand palette: French Porcelain base, Umbra ink, and four brand hues
// (Farmer's Market sage, Penna blue, periwinkle, Hudson blush). Summary cards
// take a flat brand fill with ink content; chart and list cards stay white.
export const palette = {
  ink: '#1F1F1F',
  slate: '#3A3840',
  muted: '#4D4A54',
  faint: '#5F5C67',
  ghost: '#B4B1BA',
  white: '#FFFFFF',
  porcelain: '#F5F4F7',
  success: '#6B6D58',
  warning: '#C9735C',
  destructive: '#B0552A',
  mint: {
    light: '#B4B6A0',
    base: '#7C7F66',
    deep: '#5E6049',
  },
  indigo: {
    light: '#B9C7E0',
    base: '#6A82B8',
    deep: '#4F6699',
  },
  lavender: {
    light: '#C9CDF5',
    base: '#7F88D6',
  },
  peach: {
    pale: '#EBDBD3',
    light: '#E3B4A2',
    mid: '#D08770',
    deep: '#B96650',
  },
  rubble: '#D0BEA3',
} as const;

export const surfaces = {
  card: '#FFFFFF',
  well: '#F5F4F7',
  cardBorder: 'rgba(255,255,255,0.6)',
  cardSheen: ['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)'],
  circleFill: 'rgba(255,255,255,0.6)',
  track: 'rgba(31,31,31,0.07)',
  trackStrong: 'rgba(31,31,31,0.1)',
  hairline: 'rgba(31,31,31,0.08)',
  gridline: 'rgba(31,31,31,0.06)',
  chipNeutral: 'rgba(31,31,31,0.06)',
} as const;

export const tints = {
  mint: 'rgba(94,96,73,0.14)',
  indigo: 'rgba(79,102,153,0.13)',
  lavender: 'rgba(127,136,214,0.16)',
  peach: 'rgba(185,102,80,0.13)',
} as const;

export const cardTints = {
  mint: ['#DEE0D3', '#D3D5C5'],
  indigo: ['#C9D3E8', '#B9C7E0'],
  lavender: ['#D8DBFA', '#C9CDF5'],
  peach: ['#F1E5DF', '#EBDBD3'],
} as const;

export type CardTint = keyof typeof cardTints;

export const iconTints = {
  mint: { bg: ['#ECEDE4', '#D9DBCC'], fg: '#4A4C38' },
  indigo: { bg: ['#E8EDF6', '#CBD5EA'], fg: '#3F5585' },
  lavender: { bg: ['#EEEFFD', '#D6D9F9'], fg: '#474FA3' },
  peach: { bg: ['#F7EFEB', '#EBDBD3'], fg: '#8E4632' },
} as const;

export type IconTint = keyof typeof iconTints;

// Chart ink on a brand-filled card: the deep tone of the card's own hue.
export const brandInk: Record<CardTint, string> = {
  mint: palette.mint.deep,
  indigo: palette.indigo.deep,
  lavender: palette.indigo.deep,
  peach: palette.peach.deep,
};

export const gradients = {
  readiness: [palette.mint.base, palette.mint.deep],
  sleep: [palette.indigo.base, palette.indigo.deep],
  activity: [palette.peach.mid, palette.peach.deep],
  spo2: [palette.indigo.light, palette.mint.base],
} as const;

export const progressGradients = {
  readiness: [palette.mint.light, palette.mint.deep],
  activity: [palette.peach.light, palette.peach.deep],
} as const;

export const stageColors = {
  deep: '#4F6699',
  rem: '#8F97E0',
  light: '#B9C7E0',
  awake: '#D0BEA3',
} as const;

export type StageKey = keyof typeof stageColors;

export const screenBase = {
  home: palette.porcelain,
  sleep: palette.porcelain,
  readiness: palette.porcelain,
  activity: palette.porcelain,
  trends: palette.porcelain,
} as const;

export type ScreenKey = keyof typeof screenBase;
