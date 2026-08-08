// Haptic feedback for touch interactions (react-native-pulsar presets).
// The native module is lazily required so environments without it (tests,
// web, SSR) keep working — a missing module simply disables haptics.
type Presets = typeof import('react-native-pulsar').Presets;

let presets: Presets | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  presets = (require('react-native-pulsar') as typeof import('react-native-pulsar')).Presets;
} catch {
  presets = null;
}

function play(effect: (p: Presets) => void): void {
  try {
    if (presets) effect(presets);
  } catch {
    // Haptics must never break an interaction.
  }
}

export const haptics = {
  /** Standard tap on any interactive element (cards, buttons). */
  tap: () => play((p) => p.peck()),
  /** Selection changed — toggles, option pills, tabs. */
  select: () => play((p) => p.snap()),
  /** Primary confirmation — sync now, pair, start live session. */
  confirm: () => play((p) => p.strike()),
  /** Light tick while scrubbing across a chart. */
  tick: () => play((p) => p.flick()),
};
