import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { haptics } from '../haptics';
import { fontFamily, letterSpacing, palette, radius, surfaces } from '../tokens';

// Segmented Day/Week/Month-style picker as one capsule TRACK with a sliding
// ink capsule for the active segment (the Soma convention): equal-width
// segments, greyscale chrome, the capsule glides on change instead of pills
// swapping color in place.
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
      style={[styles.track, style]}
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
            accessibilityLabel={`Show ${o.label.toLowerCase()} range`}
            style={styles.segment}>
            <Text
              style={[
                styles.text,
                { color: active ? palette.white : palette.muted },
              ]}>
              {o.label.toUpperCase()}
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
    backgroundColor: surfaces.chipNeutral,
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
    paddingVertical: 6,
  },
  text: {
    fontSize: 9,
    fontFamily: fontFamily.semiBold,
    letterSpacing: letterSpacing(9, 0.12),
  },
});
