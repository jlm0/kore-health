import { Canvas, Circle, Line, LinearGradient, Path, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Easing, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scalePoints, smoothAreaPath, smoothLinePath, type ChartPoint } from '../charts/buildPath';
import { haptics } from '../haptics';
import { fontFamily, palette, surfaces } from '../tokens';

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

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration, easing: Easing.out(Easing.cubic) }),
    );
    dotOpacity.value = withDelay(delay + duration - 150, withTiming(1, { duration: 300 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const built = useMemo(() => {
    if (width === 0 || data.length < 2) return null;
    const pts = scalePoints(data, width, height, strokeWidth + 3, domain);
    const line = smoothLinePath(pts);
    const area = fillGradient ? smoothAreaPath(pts, height) : null;
    let dotPoint = null;
    if (dot === 'end') dotPoint = pts[pts.length - 1];
    else if (dot === 'min') dotPoint = pts.reduce((a, b) => (b.y > a.y ? b : a));
    else if (dot === 'max') dotPoint = pts.reduce((a, b) => (b.y < a.y ? b : a));
    return { line, area, dotPoint, pts };
  }, [width, height, data, strokeWidth, domain, fillGradient, dot]);

  const scrubPoint: ChartPoint | null =
    interactive && scrub != null && built ? (built.pts[scrub] ?? null) : null;

  const indexForX = (x: number): number => {
    if (width <= 0 || data.length < 2) return 0;
    return Math.max(0, Math.min(data.length - 1, Math.round((x / width) * (data.length - 1))));
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
        {built && width > 0 && (
          <Canvas style={{ width, height }}>
            {built.area && (
              <Path path={built.area} style="fill" opacity={progress}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, height)}
                  colors={[...(fillGradient as readonly string[])]}
                />
              </Path>
            )}
            <Path
              path={built.line}
              style="stroke"
              strokeWidth={strokeWidth}
              strokeCap="round"
              strokeJoin="round"
              color={color}
              start={0}
              end={progress}
            />
            {built.dotPoint && (
              <Circle
                cx={built.dotPoint.x}
                cy={built.dotPoint.y}
                r={3.5}
                color={dotColor ?? color}
                opacity={dotOpacity}
              />
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
              {formatValue ? formatValue(data[scrub]) : String(data[scrub])}
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
        <View style={styles.xRow}>
          {xLabels.map((t, i) => (
            <Text key={i} style={styles.axisLabel}>
              {t}
            </Text>
          ))}
        </View>
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
