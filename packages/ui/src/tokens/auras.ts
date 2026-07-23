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
const ROSE = 'rgba(233,164,180,';

export const auraPresets: Record<ScreenKey, AuraBlob[]> = {
  home: [
    { cx: 70, cy: 30, r: 210, color: `${INDIGO}0.42)` },
    { cx: 402 + 10, cy: 250, r: 190, color: `${ROSE}0.30)` },
    { cx: -20, cy: 480, r: 200, color: `${MINT}0.36)` },
    { cx: 402 - 40, cy: 660, r: 180, color: `${LAVENDER}0.32)` },
    { cx: 120, cy: 874 + 30, r: 190, color: `${PEACH}0.38)` },
  ],
  sleep: [
    { cx: 402 - 60, cy: 40, r: 220, color: `${INDIGO}0.46)` },
    { cx: -30, cy: 280, r: 190, color: `${LAVENDER}0.36)` },
    { cx: 402, cy: 560, r: 180, color: `${ROSE}0.26)` },
    { cx: 60, cy: 874, r: 200, color: `${INDIGO}0.30)` },
  ],
  readiness: [
    { cx: 80, cy: 30, r: 220, color: `${MINT}0.44)` },
    { cx: 402 + 20, cy: 300, r: 190, color: `${INDIGO}0.30)` },
    { cx: -20, cy: 590, r: 180, color: `${PEACH}0.28)` },
    { cx: 402 - 70, cy: 874, r: 200, color: `${MINT}0.30)` },
  ],
  activity: [
    { cx: 402 - 70, cy: 40, r: 220, color: `${PEACH}0.46)` },
    { cx: -20, cy: 300, r: 190, color: `${ROSE}0.28)` },
    { cx: 402 + 10, cy: 580, r: 180, color: `${MINT}0.30)` },
    { cx: 90, cy: 874, r: 200, color: `${INDIGO}0.28)` },
  ],
  trends: [
    { cx: 60, cy: 40, r: 220, color: `${LAVENDER}0.42)` },
    { cx: 402 + 10, cy: 290, r: 190, color: `${MINT}0.32)` },
    { cx: -20, cy: 590, r: 180, color: `${INDIGO}0.28)` },
    { cx: 402 - 80, cy: 874, r: 200, color: `${PEACH}0.32)` },
  ],
};
