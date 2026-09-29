import type { TextStyle } from 'react-native';

export const fontFamily = {
  extraLight: 'Sora_200ExtraLight',
  light: 'Sora_300Light',
  regular: 'Sora_400Regular',
  medium: 'Sora_500Medium',
  semiBold: 'Sora_600SemiBold',
  displayLight: 'Sora_300Light',
  display: 'Sora_400Regular',
  displayMedium: 'Sora_500Medium',
  displaySemiBold: 'Sora_600SemiBold',
  displayItalic: 'Sora_400Regular',
} as const;

export const fontSize = {
  hero: 68,
  display: 34,
  stat: 40,
  score: 30,
  scoreSm: 28,
  value: 32,
  valueSm: 26,
  statMd: 22,
  statSm: 20,
  title: 18,
  heading: 15,
  body: 14,
  label: 13,
  caption: 12,
  micro: 11,
} as const;

export const type = {
  heroFigure: { fontFamily: fontFamily.light, fontSize: 68, lineHeight: 75, letterSpacing: -2 },
  display: { fontFamily: fontFamily.light, fontSize: 34, lineHeight: 39, letterSpacing: -1 },
  title: { fontFamily: fontFamily.semiBold, fontSize: 18, lineHeight: 23, letterSpacing: -0.2 },
  figure: { fontFamily: fontFamily.light, fontSize: 32, lineHeight: 37, letterSpacing: -0.6 },
  heading: { fontFamily: fontFamily.semiBold, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 21 },
  label: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 17 },
  caption: { fontFamily: fontFamily.regular, fontSize: 12, lineHeight: 17 },
  micro: { fontFamily: fontFamily.regular, fontSize: 11, lineHeight: 14 },
} as const satisfies Record<string, TextStyle>;

export type TypeRole = keyof typeof type;

export const letterSpacing = (size: number, em: number) => size * em;
