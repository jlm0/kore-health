import React, { useEffect } from 'react';
import { TextInput, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { fontFamily, palette } from '../tokens';

Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  signed?: boolean;
  size: number;
  color?: string;
  weight?: keyof typeof fontFamily;
  delay?: number;
  duration?: number;
  style?: StyleProp<TextStyle>;
}

export function AnimatedNumber({
  value,
  decimals = 0,
  signed = false,
  size,
  color = palette.ink,
  weight = 'extraLight',
  delay = 0,
  duration = 1300,
  style,
}: AnimatedNumberProps) {
  const sv = useSharedValue(0);

  useEffect(() => {
    sv.value = withDelay(
      delay,
      withTiming(value, { duration, easing: Easing.out(Easing.cubic) }),
    );
  }, [value, delay, duration, sv]);

  const animatedProps = useAnimatedProps(() => {
    const v = sv.value;
    const sign = signed && v >= 0 ? '+' : '';
    const text = sign + v.toFixed(decimals);
    return { text, defaultValue: text } as never;
  });

  return (
    <AnimatedTextInput
      editable={false}
      pointerEvents="none"
      underlineColorAndroid="transparent"
      animatedProps={animatedProps}
      style={[
        {
          fontSize: size,
          fontFamily: fontFamily[weight],
          color,
          padding: 0,
          lineHeight: size * 1.05,
          fontVariant: ['tabular-nums'],
        },
        style,
      ]}
    />
  );
}
