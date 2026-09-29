import { LinearGradient } from 'expo-linear-gradient';
import React, { createContext, useContext } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { haptics } from '../haptics';
import { cardTints, palette, radius as radiusTokens, shadow, spacing, surfaces, type CardTint } from '../tokens';
import { Chevron } from './Chevron';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const CardToneContext = createContext<CardTint | null>(null);

/** The brand hue of the enclosing filled card, or null on a white card. */
export function useCardTone(): CardTint | null {
  return useContext(CardToneContext);
}

interface GlassCardProps {
  children: React.ReactNode;
  radius?: number;
  padding?: number | { horizontal?: number; vertical?: number; top?: number; bottom?: number };
  /** Brand fill for summary cards; omit for a white chart/list card. */
  tint?: CardTint;
  onPress?: () => void;
  accessibilityLabel?: string;
  chevron?: boolean;
  chevronOffset?: { top?: number; right?: number };
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}

export function GlassCard({
  children,
  radius = radiusTokens.card,
  padding = spacing.card,
  tint,
  onPress,
  accessibilityLabel,
  chevron = false,
  chevronOffset,
  style,
  contentStyle,
}: GlassCardProps) {
  const pressed = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(pressed.value ? 0.98 : 1, { duration: 160 }) }],
  }));

  const paddingStyle: ViewStyle =
    typeof padding === 'number'
      ? { padding }
      : {
          paddingHorizontal: padding.horizontal,
          paddingVertical: padding.vertical,
          paddingTop: padding.top,
          paddingBottom: padding.bottom,
        };

  const brand = tint != null;
  const surfaceStyle: ViewStyle = brand
    ? { borderRadius: radius }
    : { borderRadius: radius, backgroundColor: surfaces.card };

  const body = (
    <View style={[styles.fill, surfaceStyle, styles.clip]}>
      {brand && (
        <>
          <LinearGradient
            colors={[...cardTints[tint]] as [string, string]}
            style={StyleSheet.absoluteFill}
          />
          <LinearGradient
            colors={[...surfaces.cardSheen] as [string, string]}
            locations={[0, 0.4]}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}
      <View style={[styles.fill, paddingStyle, contentStyle]}>{children}</View>
      {chevron && (
        <Chevron
          color={brand ? palette.slate : palette.faint}
          style={{
            position: 'absolute',
            top: chevronOffset?.top ?? spacing.card,
            right: chevronOffset?.right ?? spacing.card,
          }}
        />
      )}
    </View>
  );

  const content = <CardToneContext.Provider value={tint ?? null}>{body}</CardToneContext.Provider>;
  const elevation = brand ? null : shadow.card;

  if (onPress) {
    return (
      <AnimatedPressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        onPressIn={() => (pressed.value = 1)}
        onPressOut={() => (pressed.value = 0)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={[elevation, { borderRadius: radius }, animatedStyle, style]}>
        {content}
      </AnimatedPressable>
    );
  }

  return <View style={[elevation, { borderRadius: radius }, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  fill: {
    flexGrow: 1,
  },
});
