import type { ScreenKey } from './colors';

export interface AuraBlob {
  cx: number;
  cy: number;
  r: number;
  color: string;
}

const INDIGO = 'rgba(126,150,224,';
const MINT = 'rgba(99,184,168,';
const LAVENDER = 'rgba(167,147,221,';
const PEACH = 'rgba(239,181,140,';

export const auraPresets: Record<ScreenKey, AuraBlob[]> = {
  home: [
    { cx: 90, cy: 50, r: 180, color: `${INDIGO}0.30)` },
    { cx: 402 - 30, cy: 390, r: 170, color: `${MINT}0.26)` },
    { cx: 100, cy: 874 + 40, r: 160, color: `${LAVENDER}0.22)` },
  ],
  sleep: [
    { cx: 402 - 80, cy: 60, r: 180, color: `${INDIGO}0.32)` },
    { cx: 30, cy: 510, r: 170, color: `${LAVENDER}0.24)` },
  ],
  readiness: [
    { cx: 90, cy: 50, r: 180, color: `${MINT}0.30)` },
    { cx: 402 - 30, cy: 550, r: 170, color: `${INDIGO}0.22)` },
  ],
  activity: [
    { cx: 402 - 90, cy: 60, r: 180, color: `${PEACH}0.28)` },
    { cx: 30, cy: 570, r: 170, color: `${MINT}0.20)` },
  ],
  trends: [
    { cx: 80, cy: 60, r: 180, color: `${LAVENDER}0.26)` },
    { cx: 402 - 30, cy: 530, r: 170, color: `${MINT}0.22)` },
  ],
};
