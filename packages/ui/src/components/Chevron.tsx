import React from 'react';
import { View, type ViewStyle } from 'react-native';
import { palette } from '../tokens';

interface ChevronProps {
  size?: number;
  color?: string;
  thickness?: number;
  direction?: 'right' | 'left';
  style?: ViewStyle;
}

export function Chevron({
  size = 8,
  color = palette.faint,
  thickness = 1.8,
  direction = 'right',
  style,
}: ChevronProps) {
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderTopWidth: thickness,
          borderRightWidth: thickness,
          borderColor: color,
          transform: [{ rotate: direction === 'right' ? '45deg' : '225deg' }],
        },
        style,
      ]}
    />
  );
}
