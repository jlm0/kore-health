import { Canvas, Circle, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Easing, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { surfaces } from '../tokens';

interface ScoreRingProps {
  size: number;
  value: number;
  max?: number;
  colors: readonly [string, string] | readonly string[];
  strokeWidth?: number;
  delay?: number;
  children?: React.ReactNode;
}

export function ScoreRing({
  size,
  value,
  max = 100,
  colors,
  strokeWidth = 8,
  delay = 0,
  children,
}: ScoreRingProps) {
  const progress = useSharedValue(0);
  const fraction = Math.max(0.02, Math.min(value / max, 1));

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withTiming(fraction, { duration: 1300, easing: Easing.out(Easing.cubic) }),
    );
  }, [fraction, delay, progress]);

  const path = useMemo(() => {
    const inset = strokeWidth / 2 + 1;
    return Skia.PathBuilder.Make()
      .addArc(
        { x: inset, y: inset, width: size - inset * 2, height: size - inset * 2 },
        -90,
        359.98,
      )
      .detach();
  }, [size, strokeWidth]);

  const r = size / 2 - strokeWidth / 2 - 1;

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          style="stroke"
          strokeWidth={strokeWidth}
          color={surfaces.track}
        />
        <Path
          path={path}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap="round"
          start={0}
          end={progress}>
          <LinearGradient start={vec(0, 0)} end={vec(size, size)} colors={[...colors]} />
        </Path>
      </Canvas>
      {children != null && <View style={styles.center}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
