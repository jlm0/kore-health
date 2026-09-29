import React from 'react';
import { StyleSheet, Text, type TextStyle, View, type ViewStyle } from 'react-native';
import { fontFamily, letterSpacing, palette, surfaces, type, type TypeRole } from '../tokens';

interface LabelProps {
  children: string;
  size?: number;
  em?: number;
  color?: string;
  weight?: keyof typeof fontFamily;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  style?: TextStyle;
}

export function Label({
  children,
  size = type.label.fontSize,
  em = 0,
  color = palette.muted,
  weight = 'medium',
  align,
  numberOfLines,
  style,
}: LabelProps) {
  return (
    <Text
      numberOfLines={numberOfLines}
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
      {children}
    </Text>
  );
}

interface TextRoleProps {
  role: TypeRole;
  children: React.ReactNode;
  color?: string;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  style?: TextStyle;
}

const ROLE_COLOR: Record<TypeRole, string> = {
  heroFigure: palette.ink,
  display: palette.ink,
  title: palette.ink,
  figure: palette.ink,
  heading: palette.ink,
  body: palette.slate,
  label: palette.muted,
  caption: palette.muted,
  micro: palette.faint,
};

export function Txt({ role, children, color, align, numberOfLines, style }: TextRoleProps) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[type[role], { color: color ?? ROLE_COLOR[role], textAlign: align }, style]}>
      {children}
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
  variant?: 'default' | 'compact' | 'hero';
  style?: ViewStyle;
}

const METRIC_SIZE = { default: 32, compact: 26, hero: 48 } as const;

export function MetricValue({
  value,
  unit,
  size,
  unitSize,
  color = palette.ink,
  unitColor = palette.muted,
  weight = 'light',
  variant = 'default',
  style,
}: MetricValueProps) {
  const s = size ?? METRIC_SIZE[variant];
  const u = unitSize ?? (variant === 'hero' ? type.body.fontSize : type.caption.fontSize);
  return (
    <View style={[styles.valueRow, { gap: variant === 'hero' ? 6 : 4 }, style]}>
      <Text
        style={{
          fontSize: s,
          fontFamily: fontFamily[weight],
          color,
          lineHeight: s * 1.15,
          letterSpacing: -0.02 * s,
          fontVariant: ['tabular-nums'],
        }}>
        {value}
      </Text>
      {unit != null && (
        <Text style={{ fontSize: u, fontFamily: fontFamily.regular, color: unitColor }}>{unit}</Text>
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

export function StatBlock({ value, label, size = 22, align = 'flex-start', style }: StatBlockProps) {
  return (
    <View style={[{ alignItems: align, gap: 2 }, style]}>
      <Text
        style={{
          fontSize: size,
          fontFamily: fontFamily.light,
          color: palette.ink,
          lineHeight: size * 1.2,
          letterSpacing: -0.02 * size,
          fontVariant: ['tabular-nums'],
        }}>
        {value}
      </Text>
      <Text style={[type.caption, { color: palette.muted, textAlign: align === 'center' ? 'center' : 'left' }]}>
        {label}
      </Text>
    </View>
  );
}

/** Horizontal row of equal-width stats under a hairline. */
export function StatRow({ children, divided = true }: { children: React.ReactNode; divided?: boolean }) {
  return (
    <View style={[styles.statRow, divided && styles.divided]}>
      {React.Children.map(children, (child) => (child == null ? null : <View style={styles.statCell}>{child}</View>))}
    </View>
  );
}

export function Hairline({ style }: { style?: ViewStyle }) {
  return <View style={[styles.hairline, style]} />;
}

const styles = StyleSheet.create({
  valueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  statRow: {
    flexDirection: 'row',
    gap: 16,
  },
  statCell: {
    flex: 1,
    minWidth: 0,
  },
  divided: {
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: surfaces.hairline,
  },
  hairline: {
    height: 1,
    backgroundColor: surfaces.hairline,
  },
});
