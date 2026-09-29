import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { haptics } from '../haptics';
import { palette, radius, surfaces, type } from '../tokens';
import { useCardTone } from './GlassCard';

// One capsule track with a sliding ink capsule for the active segment.
interface RangeSelectorProps<T extends string> {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  style?: StyleProp<ViewStyle>;
}

export function RangeSelector<T extends string>({
  options,
  value,
  onChange,
  style,
}: RangeSelectorProps<T>) {
  const onBrand = useCardTone() != null;
  const [trackWidth, setTrackWidth] = useState(0);
  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  const segmentWidth = (trackWidth - 6) / Math.max(options.length, 1);

  const capsuleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(activeIndex * segmentWidth, { duration: 220 }) }],
  }), [activeIndex, segmentWidth]);

  return (
    <View
      style={[styles.track, { backgroundColor: onBrand ? surfaces.circleFill : surfaces.chipNeutral }, style]}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
      {trackWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.capsule,
            { width: segmentWidth },
            capsuleStyle,
          ]}
        />
      )}
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            onPress={() => {
              haptics.select();
              onChange(o.id);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Show ${o.label.toLowerCase()} range`}
            style={styles.segment}>
            <Text style={[type.label, { color: active ? palette.white : palette.muted }]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    padding: 3,
  },
  capsule: {
    position: 'absolute',
    top: 3,
    left: 3,
    bottom: 3,
    backgroundColor: palette.ink,
    borderRadius: radius.pill,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
});
