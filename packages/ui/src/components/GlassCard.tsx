import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { radius as radiusTokens, shadow, surfaces } from '../tokens';
import { Chevron } from './Chevron';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface GlassCardProps {
  children: React.ReactNode;
  radius?: number;
  padding?: number | { horizontal?: number; vertical?: number };
  onPress?: () => void;
  chevron?: boolean;
  chevronOffset?: { top?: number; right?: number };
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

export function GlassCard({
  children,
  radius = radiusTokens.lg,
  padding = 16,
  onPress,
  chevron = false,
  chevronOffset,
  style,
  contentStyle,
}: GlassCardProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(pressed.value ? 0.975 : 1, { duration: 160 }) }],
  }));

  const paddingStyle: ViewStyle =
    typeof padding === 'number'
      ? { padding }
      : { paddingHorizontal: padding.horizontal, paddingVertical: padding.vertical };

  const body = (
    <View style={[styles.clip, { borderRadius: radius }]}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={36} tint="extraLight" style={StyleSheet.absoluteFill} />
      ) : null}
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: Platform.OS === 'ios' ? surfaces.card : surfaces.cardFallback,
            borderRadius: radius,
            borderWidth: 1,
            borderColor: surfaces.cardBorder,
          },
        ]}
      />
      <View style={[paddingStyle, contentStyle]}>{children}</View>
      {chevron && (
        <Chevron
          style={{
            position: 'absolute',
            top: chevronOffset?.top ?? 22,
            right: chevronOffset?.right ?? 18,
          }}
        />
      )}
    </View>
  );

  if (onPress) {
    return (
      <AnimatedPressable
        onPress={onPress}
        onPressIn={() => (pressed.value = 1)}
        onPressOut={() => (pressed.value = 0)}
        style={[shadow.card, animatedStyle, style]}>
        {body}
      </AnimatedPressable>
    );
  }

  return <View style={[shadow.card, style]}>{body}</View>;
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
