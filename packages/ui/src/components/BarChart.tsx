import { Canvas, Group, RoundedRect, rect } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { fontFamily, palette, surfaces } from '../tokens';

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

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clipRect = useDerivedValue(() =>
    rect(0, height * (1 - progress.value), width, height * progress.value),
  );

  const bars = useMemo(() => {
    if (width === 0 || data.length === 0) return [];
    const slot = width / data.length;
    const barW = slot * (1 - gapFraction);
    return data.map((v, i) => {
      const frac = Math.max(minBarFraction, Math.min(v, 1));
      const h = frac * height;
      return {
        x: i * slot + (slot - barW) / 2,
        y: height - h,
        w: barW,
        h,
        color: colorFor(v) ?? surfaces.trackStrong,
      };
    });
  }, [width, height, data, colorFor, gapFraction, minBarFraction]);

  return (
    <View style={style}>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Canvas style={{ width, height }}>
            <Group clip={clipRect}>
              {bars.map((b, i) => (
                <RoundedRect
                  key={i}
                  x={b.x}
                  y={b.y}
                  width={b.w}
                  height={b.h}
                  r={b.w / 2}
                  color={b.color}
                />
              ))}
            </Group>
          </Canvas>
        )}
      </View>
      {xLabels && xLabels.length > 0 && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          {xLabels.map((t, i) => (
            <Text
              key={i}
              style={{ fontSize: 8, fontFamily: fontFamily.regular, color: palette.faint }}>
              {t}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}
