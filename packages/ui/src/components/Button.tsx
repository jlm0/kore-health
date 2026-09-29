import React from 'react';
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../haptics';
import { palette, radius, surfaces, type } from '../tokens';

const variants = {
  primary: { bg: palette.ink, fg: palette.white },
  secondary: { bg: surfaces.chipNeutral, fg: palette.muted },
  ghost: { bg: 'transparent', fg: palette.ink },
  destructive: { bg: palette.destructive, fg: palette.white },
} as const;

interface ButtonProps {
  children: string;
  onPress: () => void;
  variant?: keyof typeof variants;
  size?: 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  haptic?: 'tap' | 'confirm' | 'none';
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  haptic = 'tap',
  accessibilityLabel,
  style,
}: ButtonProps) {
  const v = variants[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={() => {
        if (haptic === 'confirm') haptics.confirm();
        else if (haptic === 'tap') haptics.tap();
        onPress();
      }}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        {
          minHeight: size === 'lg' ? 48 : 40,
          paddingHorizontal: size === 'lg' ? 24 : 14,
          borderRadius: radius.pill,
          backgroundColor: v.bg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}>
      <View style={{ opacity: loading ? 0 : 1 }}>
        <Text style={[type.body, { fontFamily: type.label.fontFamily, color: v.fg }]}>{children}</Text>
      </View>
      {loading ? <ActivityIndicator style={{ position: 'absolute' }} size="small" color={v.fg} /> : null}
    </Pressable>
  );
}
