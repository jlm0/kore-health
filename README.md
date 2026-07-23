# Kore Health

A ring-wearable health companion app — an Expo / React Native implementation of the **Oura Glass** liquid-glass design concept. Frosted glass cards float over soft aura gradients, with animated Skia score rings, sparklines, a sleep hypnogram, movement bars and a readiness heatmap.

## Structure

Bun-workspace monorepo:

```
apps/mobile        Expo app (expo-router, SDK 57)
  src/app          Screens: home, sleep, readiness, activity, trends, metric/[id]
  src/data         Seeded mock-data generator, selectors, metric registry
  src/store        Zustand store with AsyncStorage persistence
packages/ui        @kore/ui design system
  src/tokens       Colors, typography, spacing, radii, shadows, aura presets
  src/components   GlassCard, ScoreRing, Sparkline, Hypnogram, BarChart,
                   HeatmapGrid, StageBar, ProgressBar, DotTrend, Pill,
                   AnimatedNumber, Screen, ScreenHeader, …
  src/charts       Skia path builders (smooth line / area)
```

## Design system

`@kore/ui` owns every visual primitive; screens only compose. Tokens extend the original design (ink `#333947`, mint/indigo/lavender/peach ramps, 22–28 pt radii) with a warmer art direction: Fraunces serif display type for numbers, titles and the home greeting (Sora stays on labels/body), saturated multi-stop aura backgrounds with a Skia fractal-noise grain, and per-card color tints. Glass cards use `expo-blur` + translucent white + a specular top sheen + hairline border + soft shadow. `IconBadge` chips (MaterialCommunityIcons on tinted gradients) mark each card's function — sleeping Zs, flame, heart-pulse. Charts are drawn directly with `@shopify/react-native-skia` and animated with Reanimated (path trims, clip reveals, count-up numbers, staggered card entrances).

## Data

`src/data/generator.ts` deterministically synthesizes 30 days of wearable data from a persisted seed: a sample every 3 minutes for heart rate, HRV, skin-temp deviation, SpO₂ and movement (~72k points), plus nightly sleep sessions with stage architecture and daily readiness / sleep / activity summaries. While the app is open, a live stream appends mean-reverting samples (accelerated to one every 15 s) so charts and "current" values keep moving.

The zustand store persists the seed and preferences via AsyncStorage, so the data personality survives restarts while the timeline regenerates up to "now" on each launch.

## Running

```bash
bun install
cd apps/mobile
bunx expo start          # add --port 8090 if 8081 is taken
```

Open on the iOS simulator via Expo Go (press `i`, or `exp://127.0.0.1:<port>`).

No authentication — the app boots straight into the home dashboard. Every card taps through to a detail screen (sleep, readiness, activity, or per-metric insights with 24 h and 30-day charts).
