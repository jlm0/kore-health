import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Pill } from './Pill';

// Segmented Day/Week/Month-style picker: a row of Pills (the same control the
// units/sensor toggles use), the active one tinted, the rest neutral.
interface RangeSelectorProps<T extends string> {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** Pill variant for the active option — match the surrounding card tint. */
  variant?: 'mint' | 'indigo' | 'lavender' | 'peach';
  style?: StyleProp<ViewStyle>;
}

export function RangeSelector<T extends string>({
  options,
  value,
  onChange,
  variant = 'mint',
  style,
}: RangeSelectorProps<T>) {
  return (
    <View style={[{ flexDirection: 'row', gap: 8 }, style]}>
      {options.map((o) => (
        <Pill
          key={o.id}
          variant={o.id === value ? variant : 'neutral'}
          em={0.1}
          onPress={() => onChange(o.id)}
          accessibilityLabel={`Show ${o.label.toLowerCase()} range`}>
          {o.label}
        </Pill>
      ))}
    </View>
  );
}
