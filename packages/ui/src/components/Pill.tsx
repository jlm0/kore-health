import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { palette, radius, surfaces, tints } from '../tokens';
import { Label } from './Typo';

const variants = {
  mint: { bg: tints.mint, color: palette.mint.deep },
  indigo: { bg: tints.indigo, color: palette.indigo.deep },
  peach: { bg: tints.peach, color: palette.peach.deep },
  neutral: { bg: surfaces.chipNeutral, color: palette.muted },
} as const;

interface PillProps {
  children: string;
  variant?: keyof typeof variants;
  em?: number;
  paddingH?: number;
  style?: StyleProp<ViewStyle>;
}

export function Pill({ children, variant = 'mint', em = 0.14, paddingH = 12, style }: PillProps) {
  const v = variants[variant];
  return (
    <View
      style={[
        {
          backgroundColor: v.bg,
          borderRadius: radius.pill,
          paddingHorizontal: paddingH,
          paddingVertical: 4,
          alignSelf: 'flex-start',
        },
        style,
      ]}>
      <Label size={9} em={em} color={v.color}>
        {children}
      </Label>
    </View>
  );
}
