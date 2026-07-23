import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { radius, surfaces } from '../tokens';

interface ProgressBarProps {
  progress: number;
  colors: readonly [string, string] | readonly string[] | string;
  height?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

export function ProgressBar({ progress, colors, height = 6, delay = 0, style }: ProgressBarProps) {
  const [width, setWidth] = useState(0);
  const fill = useSharedValue(0);

  useEffect(() => {
    if (width === 0) return;
    fill.value = withDelay(
      delay,
      withTiming(Math.min(Math.max(progress, 0), 1) * width, {
        duration: 1000,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [progress, width, delay, fill]);

  const animatedStyle = useAnimatedStyle(() => ({ width: fill.value }));

  const isSolid = typeof colors === 'string';

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        {
          height,
          borderRadius: radius.pill,
          backgroundColor: surfaces.track,
          overflow: 'hidden',
        },
        style,
      ]}>
      <Animated.View style={[styles.fill, animatedStyle]}>
        {isSolid ? (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors as string }]} />
        ) : (
          <LinearGradient
            colors={[...(colors as readonly string[])] as [string, string, ...string[]]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
});
