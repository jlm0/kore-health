// All-sans system: Sora everywhere. The display* slots used to be Fraunces
// (serif); the health-app references this system follows (Neka / SuperPower /
// Soma) set every numeral and headline in a clean geometric grotesque — light
// weight, tight spacing — so the display scale maps onto Sora weights.
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
