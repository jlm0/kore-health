import {
  Canvas,
  Circle,
  Line,
  LinearGradient,
  Path,
  Skia,
  vec,
  type SkPath,
} from '@shopify/react-native-skia';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scalePoints, type ChartPoint } from '../charts/buildPath';
import { haptics } from '../haptics';
import { fontFamily, palette, surfaces } from '../tokens';

// --- range morph -------------------------------------------------------------
// When the data series changes (day ↔ week ↔ month, or a fresh sync), the line
// animates between the old and new shapes instead of swapping instantly. Both
// series are resampled onto a common MORPH_POINTS grid of DOMAIN FRACTIONS
// (0..1 within each series' own min/max), so the morph is a pure y-position
// lerp in the same x/y coordinate space — a single week bucket becomes a flat
// line, and day→week looks like the line sliding between positions rather than
// a crossfade of two pictures. The helpers below are worklet duplicates of
// charts/buildPath: the morph runs inside useDerivedValue on the UI thread,
// where only locally-workletized functions may be called.

const MORPH_POINTS = 64;
const MORPH_DURATION = 380;

/** Resample `data` to `n` points expressed as 0..1 fractions of its domain. */
function fracsOf(data: readonly number[], n: number, domain?: [number, number]): number[] {
  'worklet';
  if (data.length === 0) return [];
  const min = domain ? domain[0] : Math.min(...data);
  const max = domain ? domain[1] : Math.max(...data);
  const span = max - min || 1;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (data.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(data.length - 1, lo + 1);
    const v = data[lo] + (data[hi] - data[lo]) * (pos - lo);
    out[i] = (v - min) / span;
  }
  return out;
}

function pointsFromFracs(
  fracs: readonly number[],
  width: number,
  height: number,
  pad: number,
): ChartPoint[] {
  'worklet';
  const n = fracs.length;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return fracs.map((f, i) => ({
    x: pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW),
    y: pad + innerH - f * innerH,
  }));
}

/** Catmull-Rom smoothed path; pass closeTo to close it as an area at that y. */
function smoothPathW(points: ChartPoint[], closeTo?: number): SkPath {
  'worklet';
  const builder = Skia.PathBuilder.Make();
  if (points.length === 0) return builder.detach();
  builder.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    builder.cubicTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  if (closeTo != null) {
    builder.lineTo(points[points.length - 1].x, closeTo);
    builder.lineTo(points[0].x, closeTo);
    builder.close();
  }
  return builder.detach();
}

/** Fractions for the current morph frame: lerp from → target at t. */
function morphFracs(
  from: readonly number[] | null,
  data: readonly number[],
  t: number,
  domain?: [number, number],
): number[] {
  'worklet';
  const target = fracsOf(data, MORPH_POINTS, domain);
  if (from == null || from.length !== target.length) return target;
  return target.map((f, i) => from[i] + (f - from[i]) * t);
}

function dataEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6) return false;
  return true;
}

interface SparklineProps {
  data: readonly number[];
  height: number;
  color: string;
  strokeWidth?: number;
  dot?: 'end' | 'min' | 'max' | 'none';
  dotColor?: string;
  fillGradient?: readonly [string, string];
  domain?: [number, number];
  delay?: number;
  duration?: number;
  style?: StyleProp<ViewStyle>;
  /** Tick labels rendered in a row beneath the chart. */
  xLabels?: readonly string[];
  /** [min, max] value labels at the right edge of the chart. */
  yLabels?: readonly [string, string];
  /** Tap/drag scrubbing: guide line + dot on the nearest point, tooltip above. */
  interactive?: boolean;
  /** One label per data point, shown in the scrub tooltip. */
  xValues?: readonly string[];
  /** Formats the scrubbed point's value in the tooltip. */
  formatValue?: (v: number) => string;
}

export function Sparkline({
  data,
  height,
  color,
  strokeWidth = 2,
  dot = 'none',
  dotColor,
  fillGradient,
  domain,
  delay = 0,
  duration = 1100,
  style,
  xLabels,
  yLabels,
  interactive = false,
  xValues,
  formatValue,
}: SparklineProps) {
  const [width, setWidth] = useState(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const scrollCancelled = useRef(false);
  const progress = useSharedValue(0);
  const dotOpacity = useSharedValue(0);
  const morph = useSharedValue(1);
  const prevFracs = useSharedValue<number[] | null>(null);
  const pad = strokeWidth + 3;

  // Callers often hand us a fresh array of the same values every render —
  // stabilize on content so the morph only fires on real changes.
  const dataKey = useMemo(() => data.map((v) => v.toFixed(4)).join(','), [data]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableData = useMemo(() => data, [dataKey]);
  const lastDataRef = useRef(stableData);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration, easing: Easing.out(Easing.cubic) }),
    );
    dotOpacity.value = withDelay(delay + duration - 150, withTiming(1, { duration: 300 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layout effect: the morph must restart BEFORE the first paint of the new
  // data, or the final shape flashes for one frame.
  useLayoutEffect(() => {
    const prev = lastDataRef.current;
    if (dataEqual(prev, stableData)) return;
    prevFracs.value = fracsOf(prev, MORPH_POINTS, domain);
    lastDataRef.current = stableData;
    morph.value = 0;
    morph.value = withTiming(1, {
      duration: MORPH_DURATION,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [stableData, domain, morph, prevFracs]);

  const linePath = useDerivedValue<SkPath>(() => {
    const fracs = morphFracs(prevFracs.value, stableData, morph.value, domain);
    return smoothPathW(pointsFromFracs(fracs, width, height, pad));
  }, [stableData, width, height, domain, pad]);

  const areaPath = useDerivedValue<SkPath>(() => {
    const fracs = morphFracs(prevFracs.value, stableData, morph.value, domain);
    return smoothPathW(pointsFromFracs(fracs, width, height, pad), height);
  }, [stableData, width, height, domain, pad]);

  const dotCenter = useDerivedValue(() => {
    const fracs = morphFracs(prevFracs.value, stableData, morph.value, domain);
    const pts = pointsFromFracs(fracs, width, height, pad);
    if (pts.length === 0) return { x: -10, y: -10 };
    if (dot === 'end') return pts[pts.length - 1];
    if (dot === 'min' || dot === 'max') {
      return pts.reduce((a, b) => (dot === 'min' ? (b.y > a.y ? b : a) : b.y < a.y ? b : a));
    }
    return { x: -10, y: -10 };
  }, [stableData, width, height, domain, pad, dot]);

  // JS-side points for scrubbing only — the drawn path lives on the UI thread.
  const pts = useMemo(
    () => (width === 0 || stableData.length === 0 ? [] : scalePoints(stableData, width, height, pad, domain)),
    [width, height, stableData, pad, domain],
  );

  const scrubPoint: ChartPoint | null =
    interactive && scrub != null ? (pts[scrub] ?? null) : null;

  const indexForX = (x: number): number => {
    if (width <= 0 || stableData.length < 2) return 0;
    return Math.max(
      0,
      Math.min(stableData.length - 1, Math.round((x / width) * (stableData.length - 1))),
    );
  };

  const applyScrub = (x: number) => {
    const next = indexForX(x);
    setScrub((prev) => {
      if (prev !== null && prev !== next) haptics.tick();
      return next;
    });
  };

  const onGrant = (e: GestureResponderEvent) => {
    touchStart.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
    scrollCancelled.current = false;
    applyScrub(e.nativeEvent.locationX);
  };

  const onMove = (e: GestureResponderEvent) => {
    if (scrollCancelled.current) return;
    const { locationX, locationY } = e.nativeEvent;
    const start = touchStart.current;
    if (start) {
      const dx = Math.abs(locationX - start.x);
      const dy = Math.abs(locationY - start.y);
      // Mostly-vertical drag means the user is scrolling — bail and let the
      // parent ScrollView take the gesture (it terminates our responder).
      if (dy > 10 && dx < 10) {
        scrollCancelled.current = true;
        setScrub(null);
        return;
      }
    }
    applyScrub(locationX);
  };

  const endScrub = () => setScrub(null);

  // Keep the tooltip fully inside the chart's horizontal bounds.
  const tooltipLeft = scrubPoint
    ? Math.max(40, Math.min(Math.max(width - 40, 40), scrubPoint.x))
    : 0;

  return (
    <View style={style}>
      <View
        style={{ height }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => interactive}
        onMoveShouldSetResponder={() => interactive}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={endScrub}
        onResponderTerminate={endScrub}>
        {width > 0 && stableData.length > 0 && (
          <Canvas style={{ width, height }}>
            {fillGradient && (
              <Path path={areaPath} style="fill" opacity={progress}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, height)}
                  colors={[...(fillGradient as readonly string[])]}
                />
              </Path>
            )}
            <Path
              path={linePath}
              style="stroke"
              strokeWidth={strokeWidth}
              strokeCap="round"
              strokeJoin="round"
              color={color}
              start={0}
              end={progress}
            />
            {dot !== 'none' && (
              <Circle c={dotCenter} r={3.5} color={dotColor ?? color} opacity={dotOpacity} />
            )}
            {scrubPoint && (
              <>
                <Line
                  p1={vec(scrubPoint.x, 0)}
                  p2={vec(scrubPoint.x, height)}
                  color={color}
                  strokeWidth={1}
                  opacity={0.35}
                />
                <Circle cx={scrubPoint.x} cy={scrubPoint.y} r={5.5} color="#FFFFFF" opacity={0.9} />
                <Circle cx={scrubPoint.x} cy={scrubPoint.y} r={3.5} color={dotColor ?? color} />
              </>
            )}
          </Canvas>
        )}
        {scrubPoint && scrub != null && (
          <View pointerEvents="none" style={[styles.tooltip, { left: tooltipLeft, top: -36 }]}>
            <Text style={styles.tooltipValue}>
              {formatValue ? formatValue(stableData[scrub]) : String(stableData[scrub])}
            </Text>
            {xValues?.[scrub] != null && (
              <Text style={styles.tooltipLabel}>{xValues[scrub]}</Text>
            )}
          </View>
        )}
        {yLabels && (
          <>
            <Text pointerEvents="none" style={[styles.axisLabel, styles.yMax]}>
              {yLabels[1]}
            </Text>
            <Text pointerEvents="none" style={[styles.axisLabel, styles.yMin]}>
              {yLabels[0]}
            </Text>
          </>
        )}
      </View>
      {xLabels && xLabels.length > 0 && (
        <Animated.View
          key={xLabels.join('|')}
          entering={FadeIn.duration(250)}
          style={styles.xRow}>
          {xLabels.map((t, i) => (
            <Text key={i} style={styles.axisLabel}>
              {t}
            </Text>
          ))}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  xRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  axisLabel: {
    fontSize: 8,
    fontFamily: fontFamily.regular,
    color: palette.faint,
  },
  yMax: {
    position: 'absolute',
    top: 0,
    right: 2,
  },
  yMin: {
    position: 'absolute',
    bottom: 0,
    right: 2,
  },
  tooltip: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: surfaces.cardBorder,
    transform: [{ translateX: '-50%' }],
  },
  tooltipValue: {
    fontSize: 10,
    fontFamily: fontFamily.medium,
    color: palette.ink,
  },
  tooltipLabel: {
    fontSize: 8,
    fontFamily: fontFamily.regular,
    color: palette.faint,
  },
});
