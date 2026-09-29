import React from 'react';
import { Text, View } from 'react-native';
import { palette, type, type IconTint } from '../tokens';
import { IconBadge, type IconBadgeName } from './IconBadge';

interface CardHeadingProps {
  children: string;
  icon?: IconBadgeName;
  tint?: IconTint;
  right?: React.ReactNode;
}

export function CardHeading({ children, icon, tint = 'mint', right }: CardHeadingProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {icon != null && <IconBadge name={icon} tint={tint} size={26} />}
      <Text numberOfLines={1} style={[type.heading, { flex: 1, color: palette.ink }]}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** "39 avg"-style figure for the right side of a CardHeading. */
export function HeadingAvg({ value, unit = 'avg' }: { value: string; unit?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
      <Text style={[type.label, { color: palette.ink, fontVariant: ['tabular-nums'] }]}>{value}</Text>
      <Text style={[type.micro, { color: palette.muted }]}>{unit}</Text>
    </View>
  );
}

/** Dot + short status word for the right side of a CardHeading. */
export function HeadingStatus({ label, color = palette.mint.base }: { label: string; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={[type.caption, { color: palette.faint }]}>{label}</Text>
    </View>
  );
}
