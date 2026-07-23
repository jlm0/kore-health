export const fontFamily = {
  extraLight: 'Sora_200ExtraLight',
  light: 'Sora_300Light',
  regular: 'Sora_400Regular',
  medium: 'Sora_500Medium',
  semiBold: 'Sora_600SemiBold',
  displayLight: 'Fraunces_300Light',
  display: 'Fraunces_400Regular',
  displayMedium: 'Fraunces_500Medium',
  displaySemiBold: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_400Regular_Italic',
} as const;

export const fontSize = {
  hero: 48,
  display: 44,
  stat: 36,
  score: 30,
  scoreSm: 28,
  value: 26,
  valueSm: 24,
  statMd: 22,
  statSm: 20,
  body: 13,
  caption: 10,
  label: 9,
  micro: 8,
} as const;

export const letterSpacing = (size: number, em: number) => size * em;
