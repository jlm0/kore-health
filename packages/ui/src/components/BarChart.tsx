import { Canvas, Group, RoundedRect, rect, rrect } from '@shopify/react-native-skia';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { fontFamily, palette, surfaces } from '../tokens';

// --- range morph -------------------------------------------------------------
// When the data changes (day ↔ week ↔ month), each bar animates from its old
// slot layout to the new one — x, width and height lerp in the same coordinate
// space, so switching ranges looks like the bars sliding/merging rather than
// an instant swap. Bars that exist on only one side grow from / shrink to zero
// height in place. Layouts are computed on the UI thread (worklets below).

const MORPH_DURATION = 380;

interface BarLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

function barLayout(
  v: number,
  i: number,
  count: number,
  width: number,
  height: number,
  gapFraction: number,
  minBarFraction: number,
): BarLayout {
  'worklet';
  const slot = width / count;
  const barW = slot * (1 - gapFraction);
  const frac = Math.max(minBarFraction, Math.min(v, 1));
  const h = frac * height;
  return {
    x: i * slot + (slot - barW) / 2,
    y: height - h,
    w: barW,
    h,
  };
}

function zeroLayout(
  v: number,
  i: number,
  count: number,
  width: number,
  height: number,
  gapFraction: number,
  minBarFraction: number,
): BarLayout {
  'worklet';
  const l = barLayout(v, i, count, width, height, gapFraction, minBarFraction);
  return { x: l.x, y: height, w: l.w, h: 0 };
}

function dataEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
}

interface MorphBarProps {
  index: number;
  /** Value in the previous series; null when the bar only exists in the new one. */
  prev: number | null;
  /** Value in the new series; null when the bar only existed in the old one. */
  next: number | null;
  prevCount: number;
  nextCount: number;
  width: number;
  height: number;
  minBarFraction: number;
  gapFraction: number;
  morph: SharedValue<number>;
  color: string;
}

function MorphBar({
  index,
  prev,
  next,
  prevCount,
  nextCount,
  width,
  height,
  minBarFraction,
  gapFraction,
  morph,
  color,
}: MorphBarProps) {
  const rr = useDerivedValue(() => {
    const t = morph.value;
    const from =
      prev != null
        ? barLayout(prev, index, prevCount, width, height, gapFraction, minBarFraction)
        : zeroLayout(next ?? 0, index, nextCount, width, height, gapFraction, minBarFraction);
    const to =
      next != null
        ? barLayout(next, index, nextCount, width, height, gapFraction, minBarFraction)
        : zeroLayout(prev ?? 0, index, prevCount, width, height, gapFraction, minBarFraction);
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const w = from.w + (to.w - from.w) * t;
    const h = Math.max(from.h + (to.h - from.h) * t, 0.01);
    return rrect(rect(x, y, w, h), w / 2, w / 2);
  }, [index, prev, next, prevCount, nextCount, width, height, minBarFraction, gapFraction]);
  return <RoundedRect rect={rr} color={color} />;
}

interface BarChartProps {
  data: readonly number[];
  height: number;
  colorFor: (value: number) => string | null;
  minBarFraction?: number;
  gapFraction?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  /** Tick labels rendered in a row beneath the chart. */
  xLabels?: readonly string[];
}

export function BarChart({
  data,
  height,
  colorFor,
  minBarFraction = 0.12,
  gapFraction = 0.45,
  delay = 0,
  style,
  xLabels,
}: BarChartProps) {
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);
  const morph = useSharedValue(1);

  // Callers often hand us a fresh array of the same values every render —
  // stabilize on content so the morph only fires on real changes.
  const dataKey = useMemo(() => data.map((v) => v.toFixed(4)).join(','), [data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableData = useMemo(() => data, [dataKey]);
  const lastDataRef = useRef(stableData);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layout effect: the morph must restart BEFORE the first paint of the new
  // data, or the final layout flashes for one frame.
  useLayoutEffect(() => {
    if (dataEqual(lastDataRef.current, stableData)) return;
    lastDataRef.current = stableData;
    morph.value = 0;
    morph.value = withTiming(1, {
      duration: MORPH_DURATION,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [stableData, morph]);

  // Render-time ref is still the PREVIOUS series on the first render after a
  // change (the effect above runs after) — exactly what the morph needs.
  const prevData = lastDataRef.current;
  const pool = Math.max(prevData.length, stableData.length);

  const clipRect = useDerivedValue(() =>
    rect(0, height * (1 - progress.value), width, height * progress.value),
  );

  return (
    <View style={style}>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && pool > 0 && (
          <Canvas style={{ width, height }}>
            <Group clip={clipRect}>
              {Array.from({ length: pool }, (_, i) => {
                const prev = i < prevData.length ? prevData[i] : null;
                const next = i < stableData.length ? stableData[i] : null;
                return (
                  <MorphBar
                    key={i}
                    index={i}
                    prev={prev}
                    next={next}
                    prevCount={Math.max(prevData.length, 1)}
                    nextCount={Math.max(stableData.length, 1)}
                    width={width}
                    height={height}
                    minBarFraction={minBarFraction}
                    gapFraction={gapFraction}
                    morph={morph}
                    color={colorFor(next ?? prev ?? 0) ?? surfaces.trackStrong}
                  />
                );
              })}
            </Group>
          </Canvas>
        )}
      </View>
      {xLabels && xLabels.length > 0 && (
        <Animated.View
          key={xLabels.join('|')}
          entering={FadeIn.duration(250)}
          style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          {xLabels.map((t, i) => (
            <Text
              key={i}
              style={{ fontSize: 8, fontFamily: fontFamily.regular, color: palette.faint }}>
              {t}
            </Text>
          ))}
        </Animated.View>
      )}
    </View>
  );
}
