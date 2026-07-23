import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { iconTints, type IconTint } from '../tokens';

export type IconBadgeName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface IconBadgeProps {
  name: IconBadgeName;
  tint?: IconTint;
  size?: number;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function IconBadge({ name, tint = 'mint', size = 26, iconSize, style }: IconBadgeProps) {
  const t = iconTints[tint];
  return (
    <LinearGradient
      colors={[...t.bg] as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.36,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.7)',
        },
        style,
      ]}>
      <MaterialCommunityIcons name={name} size={iconSize ?? Math.round(size * 0.58)} color={t.fg} />
    </LinearGradient>
  );
}
