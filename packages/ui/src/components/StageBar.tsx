import React, { useEffect } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { radius } from '../tokens';

export interface StageBarSegment {
  weight: number;
  color: string;
}

interface StageBarProps {
  segments: readonly StageBarSegment[];
  height?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}

function Segment({ weight, color, delay }: { weight: number; color: string; delay: number }) {
  const flex = useSharedValue(0.0001);

  useEffect(() => {
    flex.value = withDelay(
      delay,
      withTiming(weight, { duration: 900, easing: Easing.out(Easing.cubic) }),
    );
  }, [weight, delay, flex]);

  const animatedStyle = useAnimatedStyle(() => ({ flex: flex.value }));

  return (
    <Animated.View
      style={[{ backgroundColor: color, borderRadius: radius.pill }, animatedStyle]}
    />
  );
}

export function StageBar({ segments, height = 10, delay = 0, style }: StageBarProps) {
  return (
    <View style={[{ flexDirection: 'row', height, gap: 2 }, style]}>
      {segments.map((s, i) => (
        <Segment key={i} weight={s.weight} color={s.color} delay={delay} />
      ))}
    </View>
  );
}
