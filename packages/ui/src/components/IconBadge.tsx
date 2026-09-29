import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { iconTints, palette, surfaces, type IconTint } from '../tokens';
import { useCardTone } from './GlassCard';

export type IconBadgeName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface IconBadgeProps {
  name: IconBadgeName;
  tint?: IconTint;
  size?: number;
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
}

export function IconBadge({ name, tint = 'mint', size = 30, iconSize, style }: IconBadgeProps) {
  const onBrand = useCardTone() != null;
  const t = iconTints[tint];
  const box: ViewStyle = {
    width: size,
    height: size,
    borderRadius: size * 0.36,
    alignItems: 'center',
    justifyContent: 'center',
  };
  const glyph = Math.round(iconSize ?? size * 0.52);

  if (onBrand) {
    return (
      <View style={[box, { backgroundColor: surfaces.circleFill }, style]}>
        <MaterialCommunityIcons name={name} size={glyph} color={palette.ink} />
      </View>
    );
  }

  return (
    <LinearGradient
      colors={[...t.bg] as [string, string]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={[box, { borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' }, style]}>
      <MaterialCommunityIcons name={name} size={glyph} color={t.fg} />
    </LinearGradient>
  );
}
