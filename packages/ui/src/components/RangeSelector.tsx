import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Pill } from './Pill';

// Segmented Day/Week/Month-style picker: a row of Pills (the same control the
// units toggle uses), the active one a solid ink segment, the rest neutral —
// one dark pill on a quiet track, no hue in the chrome.
interface RangeSelectorProps<T extends string> {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  /** Pill variant for the active option — defaults to the neutral ink segment. */
  variant?: 'mint' | 'indigo' | 'lavender' | 'peach' | 'ink';
  style?: StyleProp<ViewStyle>;
}

export function RangeSelector<T extends string>({
  options,
  value,
  onChange,
  variant = 'ink',
  style,
}: RangeSelectorProps<T>) {
  return (
    <View style={[{ flexDirection: 'row', gap: 8 }, style]}>
      {options.map((o) => (
        <Pill
          key={o.id}
          variant={o.id === value ? variant : 'neutral'}
          em={0.1}
          paddingH={14}
          onPress={() => onChange(o.id)}
          accessibilityLabel={`Show ${o.label.toLowerCase()} range`}>
          {o.label}
        </Pill>
      ))}
    </View>
  );
}
