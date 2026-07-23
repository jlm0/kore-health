import { Canvas, Circle, LinearGradient, Path, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scalePoints, smoothAreaPath, smoothLinePath } from '../charts/buildPath';

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
}: SparklineProps) {
  const [width, setWidth] = useState(0);
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
    return { line, area, dotPoint };
  }, [width, height, data, strokeWidth, domain, fillGradient, dot]);

  return (
    <View style={[{ height }, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
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
        </Canvas>
      )}
    </View>
  );
}
