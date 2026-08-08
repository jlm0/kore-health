import {
  fontFamily,
  GlassCard,
  IconBadge,
  Label,
  palette,
  type IconBadgeName,
  type IconTint,
} from '@kore/ui';
import React from 'react';
import { Text } from 'react-native';

interface EmptyDataCardProps {
  icon: IconBadgeName;
  tint: IconTint;
  title: string;
  message: string;
}

/** Graceful empty state for screens before the first ring sync. */
export function EmptyDataCard({ icon, tint, title, message }: EmptyDataCardProps) {
  return (
    <GlassCard radius={28} padding={24} tint={tint} contentStyle={{ alignItems: 'center', gap: 10 }}>
      <IconBadge name={icon} tint={tint} size={40} />
      <Label size={9} em={0.2}>{title}</Label>
      <Text
        style={{
          fontSize: 12,
          fontFamily: fontFamily.regular,
          color: palette.slate,
          textAlign: 'center',
          lineHeight: 18,
        }}>
        {message}
      </Text>
    </GlassCard>
  );
}
