import { Canvas, Circle, DashPathEffect, Line, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { palette, surfaces } from '../tokens';
import { scalePoints } from '../charts/buildPath';

interface DotTrendProps {
  data: readonly number[];
  height: number;
  highlightColor?: string;
  dotColor?: string;
  baseline?: boolean;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function DotTrend({
  data,
  height,
  highlightColor = palette.mint.base,
  dotColor = palette.ghost,
  baseline = true,
  delay = 0,
  style,
}: DotTrendProps) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(id);
  }, [delay]);

  const pts = useMemo(() => {
    if (width === 0 || data.length === 0) return [];
    return scalePoints(data, width, height, 6);
  }, [width, height, data]);

  return (
    <View style={[{ height }, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && visible && (
        <Animated.View entering={FadeIn.duration(500)}>
          <Canvas style={{ width, height }}>
            {baseline && (
              <Line
                p1={vec(4, height / 2)}
                p2={vec(width - 4, height / 2)}
                strokeWidth={1}
                color={surfaces.hairline}>
                <DashPathEffect intervals={[2, 4]} />
              </Line>
            )}
            {pts.map((p, i) => (
              <Circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={i === pts.length - 1 ? 3.5 : 3}
                color={i === pts.length - 1 ? highlightColor : dotColor}
              />
            ))}
          </Canvas>
        </Animated.View>
      )}
    </View>
  );
}
