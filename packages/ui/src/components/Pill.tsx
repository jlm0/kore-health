import React from 'react';
import { Pressable, View, type Insets, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../haptics';
import { palette, iconTints, radius, surfaces, tints } from '../tokens';
import { Label } from './Typo';

const variants = {
  mint: { bg: tints.mint, color: palette.mint.deep },
  indigo: { bg: tints.indigo, color: palette.indigo.deep },
  lavender: { bg: tints.lavender, color: iconTints.lavender.fg },
  peach: { bg: tints.peach, color: palette.peach.deep },
  neutral: { bg: surfaces.chipNeutral, color: palette.muted },
} as const;

// A Pill is only ~20 pt tall. This hitSlop lifts every interactive Pill to
// the 48×48 pt touch-target floor (see touch.ts) without changing its
// visual size.
const DEFAULT_HIT_SLOP: Insets = { top: 14, bottom: 14, left: 14, right: 14 };

interface PillProps {
  children: string;
  variant?: keyof typeof variants;
  em?: number;
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
  em = 0.14,
  paddingH = 12,
  onPress,
  disabled,
  hitSlop,
  accessibilityLabel,
  style,
}: PillProps) {
  const v = variants[variant];
  const pill = (
    <View
      style={[
        {
          backgroundColor: v.bg,
          borderRadius: radius.pill,
          paddingHorizontal: paddingH,
          paddingVertical: 4,
          alignSelf: 'flex-start',
        },
        // In the interactive case `style` moves to the wrapper (see below) so
        // alignment props like alignSelf keep working on the touchable.
        ...(onPress ? [] : [style]),
      ]}>
      <Label size={9} em={em} color={v.color}>
        {children}
      </Label>
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
        style={({ pressed }) => [style as ViewStyle, pressed && { opacity: 0.7 }]}>
        {pill}
      </Pressable>
    );
  }

  return pill;
}
