import { Canvas, Group, Line, RoundedRect, rect, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, useDerivedValue, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { stageColors, surfaces, type StageKey } from '../tokens';

export interface HypnogramSegment {
  stage: StageKey;
  startFrac: number;
  endFrac: number;
}

const STAGE_LEVEL: Record<StageKey, number> = { awake: 0, rem: 1, light: 2, deep: 3 };

interface HypnogramProps {
  segments: readonly HypnogramSegment[];
  height: number;
  barHeight?: number;
  gridlines?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function Hypnogram({
  segments,
  height,
  barHeight = 10,
  gridlines = 3,
  delay = 0,
  style,
}: HypnogramProps) {
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }),
    );
  }, [segments, delay, progress]);

  const clipRect = useDerivedValue(() => rect(0, 0, width * progress.value, height));

  const bars = useMemo(() => {
    if (width === 0) return [];
    const rowSpan = (height - barHeight) / 3;
    return segments.map((s) => {
      const x = s.startFrac * width;
      const w = Math.max(6, (s.endFrac - s.startFrac) * width);
      return {
        x,
        y: STAGE_LEVEL[s.stage] * rowSpan,
        w,
        color: stageColors[s.stage],
      };
    });
  }, [segments, width, height, barHeight]);

  return (
    <View style={[{ height }, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Canvas style={{ width, height }}>
          {Array.from({ length: gridlines }, (_, i) => {
            const x = ((i + 1) / (gridlines + 1)) * width;
            return (
              <Line
                key={i}
                p1={vec(x, 0)}
                p2={vec(x, height)}
                strokeWidth={1}
                color={surfaces.gridline}
              />
            );
          })}
          <Group clip={clipRect}>
            {bars.map((b, i) => (
              <RoundedRect
                key={i}
                x={b.x}
                y={b.y}
                width={b.w}
                height={barHeight}
                r={barHeight / 2}
                color={b.color}
              />
            ))}
          </Group>
        </Canvas>
      )}
    </View>
  );
}
