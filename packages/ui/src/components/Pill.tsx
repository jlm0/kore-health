import React from 'react';
import { Pressable, Text, View, type Insets, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../haptics';
import { iconTints, palette, radius, surfaces, tints, type } from '../tokens';
import { useCardTone } from './GlassCard';

const variants = {
  mint: { bg: tints.mint, color: iconTints.mint.fg },
  indigo: { bg: tints.indigo, color: iconTints.indigo.fg },
  lavender: { bg: tints.lavender, color: iconTints.lavender.fg },
  peach: { bg: tints.peach, color: iconTints.peach.fg },
  neutral: { bg: surfaces.chipNeutral, color: palette.muted },
  ink: { bg: palette.ink, color: palette.white },
} as const;

// Pills are ~26 pt tall; the slop lifts interactive ones to the 48 pt floor.
const DEFAULT_HIT_SLOP: Insets = { top: 11, bottom: 11, left: 8, right: 8 };

interface PillProps {
  children: string;
  variant?: keyof typeof variants;
  paddingH?: number;
  onPress?: () => void;
  disabled?: boolean;
  hitSlop?: Insets | number;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function Pill({
  children,
  variant = 'mint',
  paddingH = 14,
  onPress,
  disabled,
  hitSlop,
  accessibilityLabel,
  style,
}: PillProps) {
  const onBrand = useCardTone() != null;
  const hued = variant !== 'neutral' && variant !== 'ink';
  const v = onBrand && hued ? { bg: surfaces.circleFill, color: palette.ink } : variants[variant];
  const pill = (
    <View
      style={[
        {
          minHeight: 26,
          justifyContent: 'center',
          backgroundColor: v.bg,
          borderRadius: radius.pill,
          paddingHorizontal: paddingH,
          paddingVertical: 3,
          alignSelf: 'flex-start',
        },
        ...(onPress ? [] : [style]),
      ]}>
      <Text style={[type.caption, { fontFamily: type.label.fontFamily, color: v.color }]}>{children}</Text>
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={() => {
          haptics.select();
          onPress();
        }}
        disabled={disabled}
        hitSlop={hitSlop ?? DEFAULT_HIT_SLOP}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [style as ViewStyle, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
        {pill}
      </Pressable>
    );
  }

  return pill;
}
