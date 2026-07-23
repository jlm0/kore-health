import React from 'react';
import { View } from 'react-native';
import { type IconTint } from '../tokens';
import { IconBadge, type IconBadgeName } from './IconBadge';
import { Label } from './Typo';

interface CardHeadingProps {
  children: string;
  icon?: IconBadgeName;
  tint?: IconTint;
  right?: React.ReactNode;
}

export function CardHeading({ children, icon, tint = 'mint', right }: CardHeadingProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon != null && <IconBadge name={icon} tint={tint} size={22} />}
      <Label size={9} em={0.18} style={{ flex: 1 }}>
        {children}
      </Label>
      {right}
    </View>
  );
}
