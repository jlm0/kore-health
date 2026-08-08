import { BlurView } from 'expo-blur';
import React from 'react';
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../haptics';
import { shadow, surfaces } from '../tokens';
import { touchSlop } from '../touch';

interface GlassCircleProps {
  size?: number;
  children?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function GlassCircle({ size = 32, children, onPress, accessibilityLabel, style }: GlassCircleProps) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={
        onPress
          ? () => {
              haptics.tap();
              onPress();
            }
          : undefined
      }
      hitSlop={touchSlop(size)}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[shadow.circle, { width: size, height: size }, style]}>
      <View style={[styles.clip, { width: size, height: size, borderRadius: size / 2 }]}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={30} tint="extraLight" style={StyleSheet.absoluteFill} />
        ) : null}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: 'rgba(255,255,255,0.55)',
              borderRadius: size / 2,
              borderWidth: 1,
              borderColor: surfaces.cardBorder,
            },
          ]}
        />
        <View style={styles.center}>{children}</View>
      </View>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
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
