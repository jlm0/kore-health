import React from 'react';
import { StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import { fontFamily, fontSize, letterSpacing, palette } from '../tokens';

interface LabelProps {
  children: string;
  size?: number;
  em?: number;
  color?: string;
  weight?: keyof typeof fontFamily;
  align?: TextStyle['textAlign'];
  style?: TextStyle;
}

export function Label({
  children,
  size = fontSize.label,
  em = 0.18,
  color = palette.muted,
  weight = 'semiBold',
  align,
  style,
}: LabelProps) {
  return (
    <Text
      style={[
        {
          fontSize: size,
          fontFamily: fontFamily[weight],
          letterSpacing: letterSpacing(size, em),
          color,
          textAlign: align,
        },
        style,
      ]}>
      {children.toUpperCase()}
    </Text>
  );
}

interface MetricValueProps {
  value: string;
  unit?: string;
  size?: number;
  unitSize?: number;
  color?: string;
  unitColor?: string;
  weight?: keyof typeof fontFamily;
  style?: ViewStyle;
}

export function MetricValue({
  value,
  unit,
  size = fontSize.value,
  unitSize = 10,
  color = palette.ink,
  unitColor = palette.muted,
  weight = 'displayLight',
  style,
}: MetricValueProps) {
  return (
    <View style={[styles.valueRow, style]}>
      <Text style={{ fontSize: size, fontFamily: fontFamily[weight], color, lineHeight: size * 1.1 }}>
        {value}
      </Text>
      {unit != null && (
        <Text style={{ fontSize: unitSize, fontFamily: fontFamily.regular, color: unitColor }}>
          {unit}
        </Text>
      )}
    </View>
  );
}

interface StatBlockProps {
  value: string;
  label: string;
  size?: number;
  align?: 'flex-start' | 'center';
  style?: ViewStyle;
}

export function StatBlock({ value, label, size = fontSize.statMd, align = 'flex-start', style }: StatBlockProps) {
  return (
    <View style={[{ alignItems: align, gap: 2 }, style]}>
      <Text
        style={{
          fontSize: size,
          fontFamily: fontFamily.displayLight,
          color: palette.ink,
          lineHeight: size * 1.15,
        }}>
        {value}
      </Text>
      <Label size={8} em={0.16} color={palette.faint}>
        {label}
      </Label>
    </View>
  );
}

const styles = StyleSheet.create({
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
});
